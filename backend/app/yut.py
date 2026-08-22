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
        self.pending_rolls: List[dict] = []
        self.must_roll = False
        self.pending_capture: Optional[dict] = None
        self.pending_card: Optional[dict] = None
        self.hands: Dict[str, List[dict]] = {}
        self.last_move: Optional[dict] = None
        self.roll_serial = 0
        self.move_serial = 0
        self.card_chain_count = 0
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
        self.hands[player.public_id] = []
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
        self.pending_rolls = []
        self.must_roll = True
        self.pending_capture = None
        self.pending_card = None
        self.last_move = None
        self.card_chain_count = 0
        self.hands = {self.players[token].public_id: [] for token in self.player_order}
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

    @property
    def current_owner(self) -> Optional[str]:
        player = self.players.get(self.current_token) if self.current_token else None
        return player.public_id if player else None

    def _block_pending_interaction(self) -> None:
        if self.pending_capture:
            raise GameError("confirm_capture", "먼저 잡기를 확인해 주세요.")
        if self.pending_card:
            raise GameError("resolve_card", "먼저 운빨카드를 사용하거나 KEEP해 주세요.")

    def roll(self, token: str, forced_name: Optional[str] = None) -> dict:
        self._assert_turn(token)
        self._block_pending_interaction()
        if not self.must_roll:
            raise GameError("choose_roll", "모아 둔 윷 결과 중 사용할 결과를 골라 주세요.")
        if forced_name is None:
            outcomes, weights = zip(*[(name, weight) for name, _, weight in ROLLS])
            forced_name = random.SystemRandom().choices(outcomes, weights=weights, k=1)[0]
        if forced_name not in {name for name, _, _ in ROLLS}:
            raise GameError("invalid_roll", "윷 결과를 다시 확인해 주세요.")
        steps = next(steps for key, steps, _ in ROLLS if key == forced_name)
        self.roll_serial += 1
        result = {"id": self.roll_serial, "name": forced_name, "steps": steps}
        self.pending_rolls.append(result)
        self.must_roll = forced_name in {"yut", "mo"}
        self.last_event = {"type": "roll", "roll": result, "mustRollAgain": self.must_roll}
        return result

    def _piece(self, owner_id: str, piece_id: int) -> Piece:
        piece = next((p for p in self.pieces if p.owner_id == owner_id and p.id == piece_id), None)
        if piece is None:
            raise GameError("invalid_piece", "움직일 말을 다시 골라 주세요.")
        if piece.finished:
            raise GameError("piece_finished", "이미 완주한 말이에요.")
        return piece

    def _roll_result(self, roll_id: int) -> dict:
        result = next((roll for roll in self.pending_rolls if roll["id"] == roll_id), None)
        if result is None:
            raise GameError("invalid_roll", "사용할 윷 결과를 다시 골라 주세요.")
        return result

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

    def _preview_path(self, piece: Piece, steps: int) -> List[str]:
        route = ROUTES[piece.route]
        new_index = piece.index + steps
        if new_index <= 0:
            return [*reversed(route[1 : piece.index + 1]), "S"][: abs(steps)] or ["S"]
        if new_index >= len(route) - 1:
            return route[piece.index + 1 : -1] + ["F"]
        if steps > 0:
            return route[piece.index + 1 : new_index + 1]
        return list(reversed(route[new_index : piece.index]))

    def _move_piece_steps(self, piece: Piece, steps: int) -> List[str]:
        path = self._preview_path(piece, steps)
        route = ROUTES[piece.route]
        new_index = piece.index + steps
        if new_index <= 0:
            piece.route = "outer"
            piece.index = 0
            piece.finished = False
        elif new_index >= len(route) - 1:
            piece.index = len(route) - 1
            piece.finished = True
        else:
            piece.index = new_index
            self._switch_route_if_needed(piece)
        return path

    def _move_stack_steps(self, piece: Piece, steps: int, reason: str) -> List[Piece]:
        stack = self._same_stack(piece)
        origin = piece.location
        path = self._move_piece_steps(piece, steps)
        for mate in stack:
            if mate is piece:
                continue
            mate.route = piece.route
            mate.index = piece.index
            mate.finished = piece.finished
        self._record_move({
            "reason": reason,
            "ownerId": piece.owner_id,
            "pieceIds": [mate.id for mate in stack],
            "from": origin,
            "path": path,
            "to": piece.location,
        })
        return stack

    def _record_move(self, presentation: dict) -> None:
        self.move_serial += 1
        self.last_move = {"id": self.move_serial, **presentation}

    def _capture_candidates(self, moving: Piece) -> List[Piece]:
        if moving.finished or moving.location in {"S", "F"}:
            return []
        candidates = []
        for other in self.pieces:
            if other.owner_id == moving.owner_id or other.finished or other.location != moving.location:
                continue
            if other.shielded:
                other.shielded = False
                continue
            candidates.append(other)
        return candidates

    def _set_capture_prompt(self, owner_id: str, moving: Piece, targets: List[Piece], *, draw_card_after: bool) -> None:
        self.pending_capture = {
            "ownerId": owner_id,
            "movingPieceId": moving.id,
            "targetPieceIds": [target.id for target in targets],
            "location": moving.location,
            "drawCardAfter": draw_card_after,
        }
        self.last_event = {"type": "capture_prompt", **self.pending_capture}

    def move(self, token: str, piece_id: int, roll_id: int) -> None:
        self._assert_turn(token)
        self._block_pending_interaction()
        if self.must_roll:
            raise GameError("roll_again_first", "윷/모가 나왔어요. 추가 윷을 먼저 모두 던져 주세요.")
        owner_id = self.players[token].public_id
        piece = self._piece(owner_id, piece_id)
        roll = self._roll_result(roll_id)
        self.pending_rolls = [item for item in self.pending_rolls if item["id"] != roll_id]
        if piece.frozen:
            piece.frozen = False
            self.last_event = {"type": "frozen_skip", "pieceId": piece.id, "message": "얼어붙은 말은 이번 결과를 쉬어요."}
            self._finish_action(owner_id)
            return
        if piece.location == "S" and roll["steps"] < 0:
            self.last_event = {"type": "backdo_no_move", "rollId": roll_id, "message": "출발할 말이 없어 빽도 결과를 사용했어요."}
            self._finish_action(owner_id)
            return

        self._move_stack_steps(piece, int(roll["steps"]), f"roll:{roll['name']}")
        targets = self._capture_candidates(piece)
        if targets:
            self._set_capture_prompt(owner_id, piece, targets, draw_card_after=True)
            return
        if self._maybe_draw_card(owner_id, piece):
            return
        self._finish_action(owner_id)

    def confirm_capture(self, token: str) -> None:
        self._assert_turn(token)
        if not self.pending_capture:
            raise GameError("no_capture", "잡을 말이 없어요.")
        owner_id = self.players[token].public_id
        if self.pending_capture["ownerId"] != owner_id:
            raise GameError("not_your_capture", "상대가 잡기를 확인하는 중이에요.")
        moving = self._piece(owner_id, int(self.pending_capture["movingPieceId"]))
        target_ids = set(self.pending_capture["targetPieceIds"])
        captured_ids = []
        for target in self.pieces:
            if target.owner_id == owner_id or target.id not in target_ids or target.location != moving.location:
                continue
            target.route = "outer"
            target.index = 0
            target.finished = False
            target.frozen = False
            target.shielded = False
            captured_ids.append(target.id)
        draw_card_after = bool(self.pending_capture.get("drawCardAfter"))
        self.pending_capture = None
        self.must_roll = True
        self.last_event = {
            "type": "capture_confirmed",
            "ownerId": owner_id,
            "capturedPieceIds": captured_ids,
            "message": "잡았습니다!",
        }
        if draw_card_after:
            self._maybe_draw_card(owner_id, moving, emit_event=False)
        self._finish_action(owner_id)

    def _advance_turn(self) -> None:
        self.turn_index = (self.turn_index + 1) % max(1, len(self.player_order))
        self.pending_rolls = []
        self.must_roll = True
        self.pending_capture = None
        self.pending_card = None
        self.card_chain_count = 0
        next_owner = self.players[self.current_token].public_id if self.current_token else None
        for p in self.pieces:
            if p.owner_id == next_owner and p.shielded:
                p.shielded = False

    def _random_piece(self, owner_id: str, *, board_only: bool = False) -> Optional[Piece]:
        candidates = [p for p in self.pieces if p.owner_id == owner_id and not p.finished]
        if board_only:
            candidates = [p for p in candidates if p.location not in {"S", "F"}]
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

    def _maybe_draw_card(self, owner_id: str, piece: Piece, *, emit_event: bool = True, forced_card_id: Optional[str] = None) -> bool:
        locations = LUCKY_LOCATIONS | JACKPOT_LOCATIONS | DANGER_LOCATIONS
        if self.mode != "lucky" or piece.finished or piece.location not in locations or self.card_chain_count >= MAX_CARD_CHAIN:
            return False
        card = CARD_BY_ID[forced_card_id] if forced_card_id else self._weighted_card(piece.location)
        self.card_chain_count += 1
        self.pending_card = {
            "instanceId": uuid.uuid4().hex[:12],
            "cardId": card.id,
            "ownerId": owner_id,
            "sourcePieceId": piece.id,
            "sourceLocation": piece.location,
        }
        if emit_event:
            self.last_event = {
                "type": "card_drawn",
                **self.pending_card,
                "code": card.id,
                "label": card.label,
                "tier": card.tier,
                "effect": card.effect,
                "probability": card.weight / CARD_TIER_WEIGHTS[card.tier],
            }
        return True

    def force_card_draw_for_test(self, owner_id: str, piece_id: int, card_id: str) -> bool:
        return self._maybe_draw_card(owner_id, self._piece(owner_id, piece_id), forced_card_id=card_id)

    def _opponent_piece(self, owner_id: str, piece_id: Optional[int], *, board_only: bool = False) -> Piece:
        if piece_id is None:
            raise GameError("select_opponent_piece", "상대 말을 선택해 주세요.")
        opponent_id = self._opponent_id(owner_id)
        if opponent_id is None:
            raise GameError("opponent_missing", "상대가 아직 입장하지 않았어요.")
        target = self._piece(opponent_id, piece_id)
        if board_only and target.location in {"S", "F"}:
            raise GameError("select_board_piece", "판 위에 있는 상대 말을 선택해 주세요.")
        return target

    def _apply_card(self, owner_id: str, card_id: str, piece_id: Optional[int], target_piece_id: Optional[int]) -> Optional[Piece]:
        if card_id not in CARD_BY_ID:
            raise GameError("invalid_card", "카드를 다시 확인해 주세요.")
        own = self._piece(owner_id, piece_id) if piece_id is not None else None

        def need_own() -> Piece:
            if own is None:
                raise GameError("select_piece", "카드를 적용할 내 말을 선택해 주세요.")
            return own

        moved: Optional[Piece] = None
        grant_roll = False
        if card_id in {"plus_one", "plus_two", "minus_one", "plus_four", "teleport", "golden_yut", "minus_three"}:
            moved = need_own()
            steps = {"plus_one": 1, "plus_two": 2, "minus_one": -1, "plus_four": 4, "teleport": 4, "golden_yut": 1, "minus_three": -3}[card_id]
            self._move_stack_steps(moved, steps, f"card:{card_id}")
            grant_roll = card_id == "golden_yut"
        elif card_id == "shield":
            need_own().shielded = True
        elif card_id in {"reroll", "extra_turn"}:
            grant_roll = True
        elif card_id == "opponent_back":
            target = self._opponent_piece(owner_id, target_piece_id, board_only=True)
            self._move_stack_steps(target, -2, f"card:{card_id}")
        elif card_id == "merge":
            source = need_own()
            if target_piece_id is None:
                raise GameError("select_piece", "합칠 내 말을 하나 더 선택해 주세요.")
            target = self._piece(owner_id, target_piece_id)
            if target.id == source.id:
                raise GameError("same_piece", "다른 말을 선택해 주세요.")
            origin = target.location
            target.route, target.index, target.finished = source.route, source.index, source.finished
            self._record_move({"reason": "card:merge", "ownerId": owner_id, "pieceIds": [target.id], "from": origin, "path": [source.location], "to": source.location})
        elif card_id == "split":
            target = self._opponent_piece(owner_id, target_piece_id, board_only=True)
            stack = self._same_stack(target)
            if len(stack) < 2:
                raise GameError("stack_required", "업혀 있는 상대 말을 선택해 주세요.")
            for offset, mate in enumerate(stack[1:], start=1):
                self._move_piece_steps(mate, -offset)
            self._record_move({"reason": "card:split", "ownerId": target.owner_id, "pieceIds": [p.id for p in stack[1:]], "from": target.location, "path": [], "to": None})
        elif card_id == "swap":
            source = need_own()
            target = self._opponent_piece(owner_id, target_piece_id, board_only=True)
            if source.location in {"S", "F"}:
                raise GameError("swap_board_only", "판 위에 있는 내 말을 선택해 주세요.")
            source_from, target_from = source.location, target.location
            source.route, target.route = target.route, source.route
            source.index, target.index = target.index, source.index
            self._record_move({
                "reason": "card:swap",
                "swap": [
                    {"ownerId": source.owner_id, "pieceId": source.id, "from": source_from, "to": source.location},
                    {"ownerId": target.owner_id, "pieceId": target.id, "from": target_from, "to": target.location},
                ],
            })
            moved = source
        elif card_id == "last_place_boost":
            candidates = [p for p in self.pieces if p.owner_id == owner_id and not p.finished]
            if candidates:
                moved = min(candidates, key=lambda p: (p.index, p.id))
                self._move_stack_steps(moved, 5, f"card:{card_id}")
        elif card_id == "forced_split":
            source = need_own()
            stack = self._same_stack(source)
            if len(stack) < 2:
                raise GameError("stack_required", "업혀 있는 내 말을 선택해 주세요.")
            for offset, mate in enumerate(stack[1:], start=1):
                self._move_piece_steps(mate, -offset)
            self._record_move({"reason": "card:forced_split", "ownerId": owner_id, "pieceIds": [p.id for p in stack[1:]], "from": source.location, "path": [], "to": None})
        elif card_id == "chaos_swap":
            mine = self._random_piece(owner_id, board_only=True)
            opponent_id = self._opponent_id(owner_id)
            theirs = self._random_piece(opponent_id, board_only=True) if opponent_id else None
            if mine and theirs:
                mine_from, theirs_from = mine.location, theirs.location
                mine.route, theirs.route = theirs.route, mine.route
                mine.index, theirs.index = theirs.index, mine.index
                self._record_move({"reason": "card:chaos_swap", "swap": [{"ownerId": mine.owner_id, "pieceId": mine.id, "from": mine_from, "to": mine.location}, {"ownerId": theirs.owner_id, "pieceId": theirs.id, "from": theirs_from, "to": theirs.location}]})
                moved = mine
        if grant_roll:
            self.must_roll = True
        self.last_event = {"type": "card_used", "cardId": card_id, "pieceId": piece_id, "targetPieceId": target_piece_id, "grantReroll": grant_roll}
        return moved

    def _after_card_effect(self, owner_id: str, moved: Optional[Piece]) -> None:
        if moved and moved.owner_id == owner_id:
            targets = self._capture_candidates(moved)
            if targets:
                self._set_capture_prompt(owner_id, moved, targets, draw_card_after=True)
                return
            if self._maybe_draw_card(owner_id, moved):
                return
        self._finish_action(owner_id)

    def card_choice(self, token: str, choice: str, piece_id: Optional[int] = None, target_piece_id: Optional[int] = None) -> None:
        self._assert_turn(token)
        if not self.pending_card:
            raise GameError("no_pending_card", "선택할 카드가 없어요.")
        owner_id = self.players[token].public_id
        if self.pending_card["ownerId"] != owner_id:
            raise GameError("not_your_card", "상대가 카드를 고르는 중이에요.")
        instance = self.pending_card
        if choice == "keep":
            self.pending_card = None
            self.hands[owner_id].append({"instanceId": instance["instanceId"], "cardId": instance["cardId"]})
            self.last_event = {"type": "card_kept", **instance}
            self._finish_action(owner_id)
            return
        if choice != "use":
            raise GameError("invalid_card_choice", "카드를 지금 사용하거나 KEEP해 주세요.")
        moved = self._apply_card(owner_id, instance["cardId"], piece_id, target_piece_id)
        self.pending_card = None
        self._after_card_effect(owner_id, moved)

    def use_kept_card(self, token: str, instance_id: str, piece_id: Optional[int] = None, target_piece_id: Optional[int] = None) -> None:
        self._assert_turn(token)
        self._block_pending_interaction()
        if self.must_roll:
            raise GameError("finish_rolls_first", "추가 윷을 먼저 모두 던져 주세요.")
        owner_id = self.players[token].public_id
        hand = self.hands.setdefault(owner_id, [])
        instance = next((card for card in hand if card["instanceId"] == instance_id), None)
        if instance is None:
            raise GameError("card_not_found", "KEEP한 카드를 찾을 수 없어요.")
        moved = self._apply_card(owner_id, instance["cardId"], piece_id, target_piece_id)
        hand.remove(instance)
        self._after_card_effect(owner_id, moved)

    def _finish_action(self, owner_id: str) -> None:
        if self.pending_capture or self.pending_card:
            return
        if self._check_win(owner_id):
            self.status = "finished"
            self.winner_id = owner_id
            player = self._player_by_public(owner_id)
            if player:
                player.score += 1
            self.last_event = {"type": "win", "playerId": owner_id}
            return
        if self.must_roll or self.pending_rolls:
            return
        self._advance_turn()

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
            "pendingRolls": list(self.pending_rolls),
            "mustRoll": self.must_roll,
            "pendingCapture": self.pending_capture,
            "pendingCard": self.pending_card,
            "hands": {owner_id: list(cards) for owner_id, cards in self.hands.items()},
            "lastMove": self.last_move,
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
