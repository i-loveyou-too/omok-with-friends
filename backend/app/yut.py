from __future__ import annotations

import asyncio
import random
import string
import time
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional

from fastapi import WebSocket

from .game import GameError
from .rooms import ConnectionManager

ROOM_ALPHABET = string.ascii_uppercase + string.digits
CHARACTERS = {"chiikawa", "hachiware", "momonga", "usagi"}
ROLLS = [
    ("backdo", -1, 1),
    ("do", 1, 3),
    ("gae", 2, 6),
    ("geol", 3, 4),
    ("yut", 4, 1),
    ("mo", 5, 1),
]

OUTER = ["S", *[f"O{i}" for i in range(1, 21)], "F"]
SHORT_A = ["S", *[f"O{i}" for i in range(1, 6)], "A1", "A2", "C", "A3", "A4", *[f"O{i}" for i in range(15, 21)], "F"]
SHORT_B = ["S", *[f"O{i}" for i in range(1, 11)], "B1", "B2", "C", "B3", "B4", "O20", "F"]
ROUTES = {"outer": OUTER, "a": SHORT_A, "b": SHORT_B}

LUCKY_LOCATIONS = {"O2", "O4", "O7", "O9", "O12", "O14", "O17", "O19", "A1", "A3", "B1", "B3", "C"}
JACKPOT_LOCATIONS = {"O5", "O15", "A2", "B2"}
DANGER_LOCATIONS = {"O10", "O18", "A4", "B4"}
MAX_CARD_CHAIN = 4


@dataclass(frozen=True)
class LuckyCard:
    id: str
    label: str
    tier: str
    weight: int
    effect: str
    image: str


CARD_DEFINITIONS = (
    LuckyCard("plus_one", "한 칸만 더!", "🍀", 12, "선택한 말이 1칸 더 이동", "01-plus-one.png"),
    LuckyCard("plus_two", "쌩쌩!", "🍀", 10, "선택한 말이 2칸 더 이동", "02-plus-two.png"),
    LuckyCard("minus_one", "앗, 미끄덩!", "🍀", 8, "선택한 말이 1칸 뒤로 이동", "03-minus-one.png"),
    LuckyCard("opponent_back", "뒤로 가랏!", "🍀", 7, "상대의 완주하지 않은 말 하나가 2칸 뒤로 이동", "04-opponent-back.png"),
    LuckyCard("reroll", "다시 던지기!", "🍀", 8, "윷을 다시 던질 기회 획득", "05-reroll.png"),
    LuckyCard("shield", "보호막!", "🍀", 7, "다음 내 차례 전까지 선택한 말을 잡기에서 보호", "06-shield.png"),
    LuckyCard("merge", "같이 가자!", "🍀", 5, "내 다른 말 하나를 선택한 말과 합체", "07-merge.png"),
    LuckyCard("split", "흩어져!", "🍀", 5, "상대의 업힌 말 한 무리를 해산", "08-split-opponent.png"),
    LuckyCard("extra_turn", "한 번 더!", "🍀", 8, "추가 턴 획득", "09-extra-turn.png"),
    LuckyCard("nothing", "꽝!", "🍀", 8, "아무 효과 없음", "10-nothing.png"),
    LuckyCard("plus_four", "초고속!", "✨", 4, "선택한 말이 4칸 더 이동", "11-plus-four.png"),
    LuckyCard("teleport", "순간이동!", "✨", 6, "선택한 말이 4칸 순간이동", "12-teleport.png"),
    LuckyCard("golden_yut", "황금윷!", "✨", 4, "선택한 말이 1칸 이동하고 추가 턴 획득", "13-golden-yut.png"),
    LuckyCard("last_place_boost", "꼴찌의 반란!", "✨", 4, "내 가장 뒤처진 말이 5칸 이동", "14-last-place-boost.png"),
    LuckyCard("swap", "자리 바꾸기!", "✨", 5, "선택한 말과 상대 말 하나의 위치 교환", "15-swap.png"),
    LuckyCard("minus_three", "털썩…", "💀", 4, "선택한 말이 3칸 뒤로 이동", "16-minus-three.png"),
    LuckyCard("forced_split", "우리도 해산!", "💀", 3, "선택한 말과 함께 업힌 내 말 해산", "17-forced-split.png"),
    LuckyCard("chaos_swap", "대환장!", "💀", 3, "양쪽의 완주하지 않은 말 위치를 무작위 교환", "18-chaos-swap.png"),
)
CARD_BY_ID = {card.id: card for card in CARD_DEFINITIONS}
CARD_TIER_WEIGHTS = {
    tier: sum(card.weight for card in CARD_DEFINITIONS if card.tier == tier)
    for tier in {card.tier for card in CARD_DEFINITIONS}
}


def public_card(card: LuckyCard) -> dict:
    return {
        "id": card.id,
        "label": card.label,
        "tier": card.tier,
        "weight": card.weight,
        "probability": card.weight / CARD_TIER_WEIGHTS[card.tier],
        "effect": card.effect,
        "image": card.image,
    }


@dataclass
class YutPlayer:
    token: str
    public_id: str
    nickname: str
    character: str
    connected: bool = True
    score: int = 0

    def public(self) -> dict:
        return {
            "id": self.public_id,
            "nickname": self.nickname,
            "character": self.character,
            "connected": self.connected,
            "score": self.score,
        }


@dataclass
class Piece:
    id: int
    owner_id: str
    route: str = "outer"
    index: int = 0
    finished: bool = False
    shielded: bool = False
    frozen: bool = False

    @property
    def location(self) -> str:
        if self.finished:
            return "F"
        return ROUTES[self.route][self.index]

    def public(self) -> dict:
        return {
            "id": self.id,
            "ownerId": self.owner_id,
            "route": self.route,
            "index": self.index,
            "location": self.location,
            "finished": self.finished,
            "shielded": self.shielded,
            "frozen": self.frozen,
        }


class YutRoom:
    def __init__(self, room_code: str, mode: str = "lucky") -> None:
        self.room_code = room_code
        self.mode = mode if mode in {"classic", "lucky"} else "lucky"
        self.players: Dict[str, YutPlayer] = {}
        self.player_order: List[str] = []
        self.pieces: List[Piece] = []
        self.status = "waiting"
        self.turn_index = 0
        self.pending_roll: Optional[dict] = None
        self.extra_roll = False
        self.winner_id: Optional[str] = None
        self.last_event: Optional[dict] = None
        self.game_number = 1
        self.rematch_ready: set[str] = set()
        self.last_active = time.monotonic()

    def _player_by_public(self, public_id: str) -> Optional[YutPlayer]:
        return next((p for p in self.players.values() if p.public_id == public_id), None)

    def join(self, nickname: str, character: str, token: Optional[str]) -> YutPlayer:
        self.last_active = time.monotonic()
        if token and token in self.players:
            player = self.players[token]
            player.connected = True
            return player
        if len(self.players) >= 2:
            raise GameError("room_full", "이미 두 명이 플레이 중이에요.")
        if character not in CHARACTERS:
            raise GameError("invalid_character", "캐릭터를 다시 골라 주세요.")
        token = uuid.uuid4().hex
        player = YutPlayer(token, uuid.uuid4().hex[:10], nickname[:12], character)
        self.players[token] = player
        self.player_order.append(token)
        if len(self.players) == 2:
            self._start_game()
        return player

    def disconnect(self, token: str) -> None:
        if token in self.players:
            self.players[token].connected = False
        self.last_active = time.monotonic()

    def _start_game(self) -> None:
        self.status = "playing"
        self.turn_index = 0
        self.pending_roll = None
        self.extra_roll = False
        self.winner_id = None
        self.last_event = None
        self.rematch_ready.clear()
        self.pieces = []
        for token in self.player_order:
            owner = self.players[token].public_id
            self.pieces.extend(Piece(i, owner) for i in range(4))

    @property
    def current_token(self) -> Optional[str]:
        if not self.player_order:
            return None
        return self.player_order[self.turn_index % len(self.player_order)]

    def _assert_turn(self, token: str) -> None:
        if self.status != "playing":
            raise GameError("not_playing", "지금은 플레이 중이 아니에요.")
        if token != self.current_token:
            raise GameError("not_your_turn", "상대 차례예요.")

    def roll(self, token: str) -> dict:
        self._assert_turn(token)
        if self.pending_roll is not None:
            raise GameError("choose_piece", "먼저 움직일 말을 골라 주세요.")
        outcomes, weights = zip(*[(name, weight) for name, _, weight in ROLLS])
        name = random.SystemRandom().choices(outcomes, weights=weights, k=1)[0]
        steps = next(steps for key, steps, _ in ROLLS if key == name)
        self.pending_roll = {"name": name, "steps": steps}
        self.last_event = {"type": "roll", "name": name, "steps": steps}
        return self.pending_roll

    def _same_stack(self, piece: Piece) -> List[Piece]:
        if piece.location in {"S", "F"}:
            return [piece]
        return [p for p in self.pieces if p.owner_id == piece.owner_id and not p.finished and p.location == piece.location]

    def _switch_route_if_needed(self, piece: Piece) -> None:
        if piece.route != "outer":
            return
        loc = piece.location
        if loc == "O5":
            piece.route = "a"
            piece.index = SHORT_A.index("O5")
        elif loc == "O10":
            piece.route = "b"
            piece.index = SHORT_B.index("O10")

    def _move_piece_steps(self, piece: Piece, steps: int) -> None:
        route = ROUTES[piece.route]
        new_index = piece.index + steps
        if new_index <= 0:
            piece.route = "outer"
            piece.index = 0
            piece.finished = False
            return
        if new_index >= len(route) - 1:
            piece.index = len(route) - 1
            piece.finished = True
            return
        piece.index = new_index
        self._switch_route_if_needed(piece)

    def _move_stack_steps(self, piece: Piece, steps: int) -> None:
        stack = self._same_stack(piece)
        self._move_piece_steps(piece, steps)
        for mate in stack:
            if mate is piece:
                continue
            mate.route = piece.route
            mate.index = piece.index
            mate.finished = piece.finished

    def _capture_at(self, moving: Piece) -> bool:
        if moving.finished or moving.location in {"S", "F"}:
            return False
        captured = False
        for other in self.pieces:
            if other.owner_id == moving.owner_id or other.finished or other.location != moving.location:
                continue
            if other.shielded:
                other.shielded = False
                continue
            other.route = "outer"
            other.index = 0
            other.finished = False
            other.frozen = False
            captured = True
        return captured

    def move(self, token: str, piece_id: int) -> None:
        self._assert_turn(token)
        if self.pending_roll is None:
            raise GameError("roll_first", "먼저 윷을 던져 주세요.")
        owner_id = self.players[token].public_id
        piece = next((p for p in self.pieces if p.owner_id == owner_id and p.id == piece_id), None)
        if piece is None:
            raise GameError("invalid_piece", "움직일 말을 다시 골라 주세요.")
        if piece.finished:
            raise GameError("piece_finished", "이미 완주한 말이에요.")
        if piece.frozen:
            piece.frozen = False
            self.pending_roll = None
            self.last_event = {"type": "frozen_skip", "message": "얼어붙은 말은 이번 턴 쉬어요."}
            self._advance_turn()
            return
        steps = int(self.pending_roll["steps"])
        if piece.location == "S" and steps < 0:
            self.pending_roll = None
            self._advance_turn()
            self.last_event = {"type": "backdo_no_move", "message": "출발할 말이 없어 빽도는 턴 종료!"}
            return

        self._move_stack_steps(piece, steps)

        captured = self._capture_at(piece)
        roll_name = self.pending_roll["name"]
        self.pending_roll = None
        if self.mode == "lucky" and not piece.finished:
            captured = self._trigger_lucky(piece) or captured

        if self._check_win(owner_id):
            self.status = "finished"
            self.winner_id = owner_id
            self.players[token].score += 1
            self.last_event = {"type": "win", "playerId": owner_id}
            return

        self.extra_roll = captured or roll_name in {"yut", "mo"} or bool(self.last_event and self.last_event.get("grantReroll"))
        if not self.extra_roll:
            self._advance_turn()

    def _advance_turn(self) -> None:
        self.extra_roll = False
        self.turn_index = (self.turn_index + 1) % max(1, len(self.player_order))
        next_owner = self.players[self.current_token].public_id if self.current_token else None
        for p in self.pieces:
            if p.owner_id == next_owner and p.shielded:
                p.shielded = False

    def _random_piece(self, owner_id: str, *, movable_only: bool = True) -> Optional[Piece]:
        candidates = [p for p in self.pieces if p.owner_id == owner_id and not p.finished]
        if movable_only:
            candidates = [p for p in candidates if p.location != "S"] or candidates
        return random.SystemRandom().choice(candidates) if candidates else None

    def _opponent_id(self, owner_id: str) -> Optional[str]:
        return next((p.public_id for p in self.players.values() if p.public_id != owner_id), None)

    def _weighted_card(self, location: str) -> LuckyCard:
        pool = CARD_DEFINITIONS
        if location in JACKPOT_LOCATIONS:
            pool = tuple(card for card in CARD_DEFINITIONS if card.tier == "✨")
        elif location in DANGER_LOCATIONS:
            pool = tuple(card for card in CARD_DEFINITIONS if card.tier == "💀")
        else:
            pool = tuple(card for card in CARD_DEFINITIONS if card.tier == "🍀")
        return random.SystemRandom().choices(pool, weights=[card.weight for card in pool], k=1)[0]

    def _trigger_lucky(self, piece: Piece) -> bool:
        captured, events = self._resolve_lucky_chain(piece, 0)
        if events:
            self.last_event = events[0]
            if any(event.get("grantReroll") for event in events):
                self.last_event["grantReroll"] = True
            if len(events) > 1:
                self.last_event["chain"] = events[1:]
        return captured

    def _resolve_lucky_chain(self, piece: Piece, depth: int) -> tuple[bool, List[dict]]:
        loc = piece.location
        if loc not in LUCKY_LOCATIONS | JACKPOT_LOCATIONS | DANGER_LOCATIONS:
            return False, []
        card = self._weighted_card(loc)
        code = card.id
        owner_id = piece.owner_id
        opponent_id = self._opponent_id(owner_id)
        event = {
            "type": "lucky_card",
            "code": code,
            "label": card.label,
            "tier": card.tier,
            "location": loc,
            "effect": card.effect,
            "probability": card.weight / CARD_TIER_WEIGHTS[card.tier],
        }
        chain_target: Optional[Piece] = None
        chain_origin: Optional[str] = None

        if code == "plus_one":
            chain_origin = piece.location
            self._move_stack_steps(piece, 1)
            chain_target = piece
        elif code == "plus_two":
            chain_origin = piece.location
            self._move_stack_steps(piece, 2)
            chain_target = piece
        elif code == "minus_one":
            chain_origin = piece.location
            self._move_stack_steps(piece, -1)
            chain_target = piece
        elif code in {"reroll", "extra_turn"}:
            event["grantReroll"] = True
        elif code == "shield":
            piece.shielded = True
        elif code == "opponent_back" and opponent_id:
            target = self._random_piece(opponent_id)
            if target:
                self._move_piece_steps(target, -2)
        elif code == "merge":
            target = next(
                (
                    p
                    for p in self.pieces
                    if p.owner_id == owner_id
                    and p.id != piece.id
                    and not p.finished
                    and p.location != piece.location
                ),
                None,
            )
            if target:
                target.route, target.index, target.finished = piece.route, piece.index, piece.finished
        elif code == "split" and opponent_id:
            stacks = [p for p in self.pieces if p.owner_id == opponent_id and p.location not in {"S", "F"}]
            if stacks:
                loc0 = random.SystemRandom().choice(stacks).location
                same = [p for p in stacks if p.location == loc0]
                for offset, target in enumerate(same[1:], start=1):
                    self._move_piece_steps(target, -offset)
        elif code == "teleport":
            chain_origin = piece.location
            self._move_stack_steps(piece, 4)
            chain_target = piece
        elif code == "swap" and opponent_id:
            target = self._random_piece(opponent_id)
            if target and target.location not in {"S", "F"} and piece.location not in {"S", "F"}:
                piece.route, target.route = target.route, piece.route
                piece.index, target.index = target.index, piece.index
        elif code == "golden_yut":
            chain_origin = piece.location
            self._move_stack_steps(piece, 1)
            chain_target = piece
            event["grantReroll"] = True
        elif code == "plus_four":
            chain_origin = piece.location
            self._move_stack_steps(piece, 4)
            chain_target = piece
        elif code == "last_place_boost":
            target = min((p for p in self.pieces if p.owner_id == owner_id and not p.finished), key=lambda p: p.index, default=None)
            if target:
                chain_origin = target.location
                self._move_stack_steps(target, 5)
                chain_target = target
        elif code == "minus_three":
            chain_origin = piece.location
            self._move_stack_steps(piece, -3)
            chain_target = piece
        elif code == "forced_split":
            same = self._same_stack(piece)
            for offset, target in enumerate(same[1:], start=1):
                self._move_piece_steps(target, -offset)
        elif code == "chaos_swap" and opponent_id:
            mine = self._random_piece(owner_id)
            theirs = self._random_piece(opponent_id)
            if mine and theirs and mine.location not in {"S", "F"} and theirs.location not in {"S", "F"}:
                mine.route, theirs.route = theirs.route, mine.route
                mine.index, theirs.index = theirs.index, mine.index
        captured = self._capture_at(chain_target) if chain_target else False
        events = [event]
        if chain_target and depth + 1 < MAX_CARD_CHAIN and not chain_target.finished and chain_target.location != chain_origin:
            chained_capture, chained_events = self._resolve_lucky_chain(chain_target, depth + 1)
            captured = captured or chained_capture
            events.extend(chained_events)
        return captured, events

    def _check_win(self, owner_id: str) -> bool:
        return all(p.finished for p in self.pieces if p.owner_id == owner_id)

    def request_rematch(self, token: str) -> None:
        if self.status != "finished":
            raise GameError("not_finished", "게임이 끝난 뒤 다시 할 수 있어요.")
        self.rematch_ready.add(token)
        if len(self.rematch_ready) == 2:
            self.game_number += 1
            self.player_order.reverse()
            self._start_game()

    def snapshot(self) -> dict:
        turn_player = self.players.get(self.current_token) if self.current_token else None
        return {
            "roomCode": self.room_code,
            "mode": self.mode,
            "status": self.status,
            "gameNumber": self.game_number,
            "turnPlayerId": turn_player.public_id if turn_player else None,
            "players": [self.players[token].public() for token in self.player_order],
            "pieces": [p.public() for p in self.pieces],
            "pendingRoll": self.pending_roll,
            "extraRoll": self.extra_roll,
            "winnerId": self.winner_id,
            "lastEvent": self.last_event,
            "rematchReady": [self.players[t].public_id for t in self.rematch_ready if t in self.players],
            "lucky": {
                "normal": sorted(LUCKY_LOCATIONS),
                "jackpot": sorted(JACKPOT_LOCATIONS),
                "danger": sorted(DANGER_LOCATIONS),
            },
            "cards": [public_card(card) for card in CARD_DEFINITIONS],
        }


class YutRoomManager:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self.rooms: Dict[str, YutRoom] = {}
        self.connections = ConnectionManager()
        self.ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    async def create(self, mode: str = "lucky") -> YutRoom:
        async with self._lock:
            self.cleanup()
            while True:
                code = "".join(random.SystemRandom().choices(ROOM_ALPHABET, k=5))
                if code not in self.rooms:
                    room = YutRoom(code, mode)
                    self.rooms[code] = room
                    return room

    def get(self, code: str) -> YutRoom:
        room = self.rooms.get(code.upper())
        if not room:
            raise GameError("room_not_found", "앗! 존재하지 않는 윷놀이 방이에요.")
        room.last_active = time.monotonic()
        return room

    def cleanup(self) -> None:
        now = time.monotonic()
        stale = [code for code, room in self.rooms.items() if now - room.last_active > self.ttl_seconds and not any(p.connected for p in room.players.values())]
        for code in stale:
            self.rooms.pop(code, None)
            self.connections.connections.pop(code, None)


yut_room_manager = YutRoomManager()
