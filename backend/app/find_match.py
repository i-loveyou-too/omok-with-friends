from __future__ import annotations

import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .game import CHARACTERS, GameError


DIFFICULTY_COUNTS = {"easy": 8, "medium": 10, "hard": 12}
WIN_TARGETS = {7, 10, 15}
WRONG_GUESS_LOCK_MS = 1200
REVEAL_DELAY_MS = 900

# Every id in this list has a matching, approved PNG in the implementation package.
SYMBOL_IDS = [
    "pudding", "strawberry_cake", "cream_soda", "ice_cream", "donut", "hotcake",
    "melon_bread", "roll_cake", "star_candy", "rice_ball", "omurice", "curry",
    "spicy_curry", "ramen", "udon", "dumpling", "takoyaki", "fried_egg",
    "octopus_sausage", "sandwich", "hamburger", "fries", "pizza", "cupcake",
    "sweet_potato", "corn", "gimbap", "cheese", "milk", "juice", "macaron",
    "camera", "subjugation_fork", "teddy_bear", "star", "pink_bear_pochette",
    "acorn", "ribbon", "heart", "clover", "flower", "mushroom", "umbrella",
    "teacup", "mug", "gift_box", "bell", "hat", "pencil", "notebook",
    "binoculars", "doll", "chocolate", "magnifier",
    "chiikawa_01", "chiikawa_02", "chiikawa_03", "chiikawa_04",
    "hachiware_01", "hachiware_02", "hachiware_03", "hachiware_04",
    "usagi_01", "usagi_02", "usagi_03", "usagi_04",
    "momonga_01", "momonga_02", "momonga_03", "momonga_04",
]

TRAP_FAMILIES: List[Tuple[str, str, str]] = [
    ("pudding", "trap_pudding_plain", "trap_pudding_cherry"),
    ("star", "trap_star_round", "trap_star_pointy"),
    ("camera", "trap_camera_left_lens", "trap_camera_right_lens"),
    ("acorn", "trap_acorn_short_cap", "trap_acorn_tall_cap"),
    ("pink_bear_pochette", "trap_pochette_round_ear", "trap_pochette_pointed_ear"),
    ("umbrella", "trap_umbrella_blue", "trap_umbrella_pink"),
    ("mushroom", "trap_mushroom_five_spots", "trap_mushroom_six_spots"),
    ("ribbon", "trap_ribbon_round", "trap_ribbon_square"),
    ("mug", "trap_mug_plain", "trap_mug_straw"),
    ("melon_bread", "trap_melon_bread_grid_a", "trap_melon_bread_grid_b"),
    ("cream_soda", "trap_cream_soda_cherry_left", "trap_cream_soda_cherry_right"),
    ("roll_cake", "trap_roll_cake_swirl_left", "trap_roll_cake_swirl_right"),
    ("heart", "trap_heart_plain", "trap_heart_sparkle"),
    ("flower", "trap_flower_white", "trap_flower_pink"),
    ("chocolate", "trap_chocolate_plain", "trap_chocolate_wrapped"),
]


def epoch_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class FindMatchPlayer:
    token: str
    public_id: str
    nickname: str
    character: str
    connected: bool = True

    def public(self, score: int) -> dict:
        return {
            "id": self.public_id,
            "nickname": self.nickname,
            "character": self.character,
            "connected": self.connected,
            "score": score,
        }


@dataclass
class FindMatchRound:
    round_id: str
    left: List[str]
    right: List[str]
    answer: str
    trap_pairs: List[List[str]]
    phase: str
    ready: Set[str] = field(default_factory=set)
    revealed_at: Optional[int] = None
    resolved: bool = False

    def public(self) -> dict:
        # Cards are sent before reveal so both clients can preload every approved asset.
        # Guessing remains server-locked until revealed_at.
        return {
            "roundId": self.round_id,
            "left": self.left,
            "right": self.right,
            "trapPairs": self.trap_pairs,
            "phase": self.phase,
            "revealedAt": self.revealed_at,
            "resolved": self.resolved,
        }


@dataclass
class FindMatchState:
    room_code: str
    difficulty: str = "medium"
    win_target: int = 10
    players: Dict[str, FindMatchPlayer] = field(default_factory=dict)
    player_order: List[str] = field(default_factory=list)
    scores: Dict[str, int] = field(default_factory=dict)
    status: str = "waiting"
    round_number: int = 0
    current_round: Optional[FindMatchRound] = None
    winner_token: Optional[str] = None
    combo_owner: Optional[str] = None
    combo_count: int = 0
    rematch_ready: Set[str] = field(default_factory=set)
    pending_difficulty: Optional[dict] = None
    next_round_at: Optional[int] = None
    locked_until: Dict[str, int] = field(default_factory=dict)
    last_active: float = field(default_factory=time.monotonic)

    def __post_init__(self) -> None:
        self._validate_settings(self.difficulty, self.win_target)

    @staticmethod
    def _validate_settings(difficulty: str, win_target: int) -> None:
        if difficulty not in DIFFICULTY_COUNTS:
            raise GameError("invalid_difficulty", "난이도 선택이 올바르지 않아요.")
        if win_target not in WIN_TARGETS:
            raise GameError("invalid_win_target", "승리 점수는 7, 10, 15점 중에서 골라 주세요.")

    def join(self, nickname: str, character: str, token: Optional[str] = None) -> FindMatchPlayer:
        nickname = nickname.strip()
        if not nickname or len(nickname) > 12:
            raise GameError("invalid_nickname", "닉네임은 1~12자로 입력해 주세요.")
        if character not in CHARACTERS:
            raise GameError("invalid_character", "캐릭터 선택이 올바르지 않아요.")
        if token and token in self.players:
            player = self.players[token]
            player.connected = True
            self.last_active = time.monotonic()
            return player
        if len(self.player_order) >= 2:
            raise GameError("room_full", "이미 두 명이 있는 방이에요.")
        player_token = secrets.token_urlsafe(24)
        player = FindMatchPlayer(
            token=player_token,
            public_id=secrets.token_hex(4),
            nickname=nickname,
            character=character,
        )
        self.players[player_token] = player
        self.player_order.append(player_token)
        self.scores[player_token] = 0
        if len(self.player_order) == 2:
            self.status = "playing"
            self._new_round()
        self.last_active = time.monotonic()
        return player

    def disconnect(self, token: str) -> None:
        if token in self.players:
            self.players[token].connected = False
            self.last_active = time.monotonic()

    def snapshot(self) -> dict:
        now = epoch_ms()
        return {
            "roomCode": self.room_code,
            "gameType": "find_match",
            "difficulty": self.difficulty,
            "symbolCount": DIFFICULTY_COUNTS[self.difficulty],
            "winTarget": self.win_target,
            "status": self.status,
            "roundNumber": self.round_number,
            "players": [self.players[token].public(self.scores.get(token, 0)) for token in self.player_order],
            "winnerId": self.players[self.winner_token].public_id if self.winner_token else None,
            "combo": {
                "playerId": self.players[self.combo_owner].public_id if self.combo_owner else None,
                "count": self.combo_count,
            },
            "round": self.current_round.public() if self.current_round else None,
            "pendingDifficulty": self.pending_difficulty,
            "rematchReadyIds": [self.players[token].public_id for token in self.rematch_ready if token in self.players],
            "nextRoundAt": self.next_round_at,
            "serverNow": now,
        }

    def ready_round(self, token: str, round_id: str) -> dict:
        self._player(token)
        current = self._current_round(round_id)
        if self.status != "playing" or current.resolved:
            raise GameError("round_not_ready", "지금은 카드를 준비할 수 없어요.")
        current.ready.add(token)
        self.last_active = time.monotonic()
        if len(current.ready) == 2 and current.revealed_at is None:
            current.revealed_at = epoch_ms() + REVEAL_DELAY_MS
            return {"revealed": True, "revealedAt": current.revealed_at}
        return {"revealed": False}

    def guess(self, token: str, symbol_id: str, round_id: str) -> dict:
        player = self._player(token)
        current = self._current_round(round_id)
        now = epoch_ms()
        if self.status != "playing" or current.resolved:
            raise GameError("round_closed", "이미 끝난 라운드예요.")
        if current.revealed_at is None or now < current.revealed_at:
            raise GameError("round_hidden", "카드가 아직 공개되지 않았어요.")
        if now < self.locked_until.get(token, 0):
            raise GameError("guess_locked", "오답 잠금이 끝난 뒤 다시 골라 주세요.")
        if symbol_id not in current.left and symbol_id not in current.right:
            raise GameError("invalid_symbol", "카드에 없는 그림이에요.")
        if symbol_id != current.answer:
            lock_until = now + WRONG_GUESS_LOCK_MS
            self.locked_until[token] = lock_until
            self.last_active = time.monotonic()
            return {
                "correct": False,
                "playerId": player.public_id,
                "lockMs": WRONG_GUESS_LOCK_MS,
                "lockedUntil": lock_until,
            }

        current.resolved = True
        self.scores[token] += 1
        if self.combo_owner == token:
            self.combo_count += 1
        else:
            self.combo_owner = token
            self.combo_count = 1
        score = self.scores[token]
        finished = score >= self.win_target
        event = {
            "correct": True,
            "playerId": player.public_id,
            "symbolId": symbol_id,
            "score": score,
            "combo": self.combo_count,
            "finished": finished,
        }
        if finished:
            self.status = "finished"
            self.winner_token = token
            self.next_round_at = None
        else:
            # Leave a visible result beat and enough time to request a between-round
            # difficulty change. A request pauses this timer until the opponent answers.
            self.next_round_at = now + 1600
        self.last_active = time.monotonic()
        return event

    def advance(self) -> bool:
        if self.status == "playing" and self.next_round_at and epoch_ms() >= self.next_round_at:
            self.next_round_at = None
            self._new_round()
            return True
        return False

    def request_difficulty(self, token: str, difficulty: str) -> dict:
        requester = self._player(token)
        if difficulty not in DIFFICULTY_COUNTS:
            raise GameError("invalid_difficulty", "난이도 선택이 올바르지 않아요.")
        if difficulty == self.difficulty:
            raise GameError("same_difficulty", "이미 선택된 난이도예요.")
        if self.pending_difficulty:
            raise GameError("difficulty_pending", "이미 난이도 변경 응답을 기다리고 있어요.")
        if self.status != "playing" or not self.current_round or not self.current_round.resolved:
            raise GameError("between_rounds_only", "난이도는 라운드 사이에만 바꿀 수 있어요.")
        self.pending_difficulty = {"requestedBy": requester.public_id, "difficulty": difficulty}
        self.next_round_at = None
        self.last_active = time.monotonic()
        return self.pending_difficulty

    def respond_difficulty(self, token: str, accept: bool) -> dict:
        responder = self._player(token)
        pending = self.pending_difficulty
        if not pending:
            raise GameError("no_difficulty_request", "대기 중인 난이도 변경 요청이 없어요.")
        if pending["requestedBy"] == responder.public_id:
            raise GameError("self_response", "상대방이 응답해야 해요.")
        if accept:
            self.difficulty = pending["difficulty"]
        requested = pending["difficulty"]
        self.pending_difficulty = None
        if self.status == "playing" and self.current_round and self.current_round.resolved:
            self._new_round()
        self.last_active = time.monotonic()
        return {"accepted": accept, "difficulty": requested}

    def request_rematch(self, token: str) -> bool:
        self._player(token)
        if self.status != "finished":
            raise GameError("game_not_finished", "게임이 끝난 뒤 재대결할 수 있어요.")
        self.rematch_ready.add(token)
        self.last_active = time.monotonic()
        if len(self.rematch_ready) < 2:
            return False
        self.scores = {player_token: 0 for player_token in self.player_order}
        self.winner_token = None
        self.combo_owner = None
        self.combo_count = 0
        self.round_number = 0
        self.rematch_ready.clear()
        self.pending_difficulty = None
        self.next_round_at = None
        self.locked_until.clear()
        self.status = "playing"
        self._new_round()
        return True

    def _progress(self) -> float:
        return max(self.scores.values(), default=0) / self.win_target

    def _trap_count(self) -> int:
        progress = self._progress()
        if progress < 0.40:
            return 0
        if progress < 0.70:
            return random.randint(1, 2)
        return random.randint(2, 3)

    def _new_round(self) -> None:
        count = DIFFICULTY_COUNTS[self.difficulty]
        answer = random.choice(SYMBOL_IDS)
        trap_count = min(self._trap_count(), count - 1)
        eligible_traps = [family for family in TRAP_FAMILIES if family[0] != answer]
        selected_traps = random.sample(eligible_traps, k=trap_count) if trap_count else []
        excluded = {answer}
        for family in selected_traps:
            excluded.update(family)
        base_pool = [symbol for symbol in SYMBOL_IDS if symbol not in excluded]
        split = count - 1 - trap_count
        distractors = random.sample(base_pool, k=split * 2)
        left = [answer, *(family[1] for family in selected_traps), *distractors[:split]]
        right = [answer, *(family[2] for family in selected_traps), *distractors[split:]]
        random.shuffle(left)
        random.shuffle(right)
        progress = self._progress()
        phase = "early" if progress < 0.40 else "mid" if progress < 0.70 else "late"
        self.round_number += 1
        self.current_round = FindMatchRound(
            round_id=secrets.token_hex(6),
            left=left,
            right=right,
            answer=answer,
            trap_pairs=[[family[1], family[2]] for family in selected_traps],
            phase=phase,
        )

    def _current_round(self, round_id: str) -> FindMatchRound:
        if not self.current_round or not round_id or self.current_round.round_id != round_id:
            raise GameError("stale_round", "새 라운드가 시작됐어요. 현재 카드를 확인해 주세요.")
        return self.current_round

    def _player(self, token: str) -> FindMatchPlayer:
        player = self.players.get(token)
        if not player:
            raise GameError("player_not_found", "플레이어 정보를 찾을 수 없어요.")
        return player
