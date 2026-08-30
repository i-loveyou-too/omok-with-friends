from __future__ import annotations

import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from .game import CHARACTERS, GameError


TARGET_SCORE = 100
TURN_MS = 12_000
RESULT_BEAT_MS = 1_100
BURST_MIN = 30
BURST_MAX = 60


def epoch_ms() -> int:
    return int(time.time() * 1000)


def choose_burst_at() -> int:
    values = list(range(BURST_MIN, BURST_MAX + 1))
    # Low/mid 40s are the peak, while the whole 30-60 range remains possible.
    weights = [max(1, 18 - abs(value - 44)) for value in values]
    return random.SystemRandom().choices(values, weights=weights, k=1)[0]


@dataclass
class BalloonPlayer:
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
class Balloon:
    balloon_id: str
    burst_at: int
    pump_count: int = 0


@dataclass
class BalloonTurn:
    turn_id: str
    player_token: str
    turn_score: int = 0
    deadline_at: Optional[int] = None
    resolved: bool = False


@dataclass
class BalloonState:
    room_code: str
    players: Dict[str, BalloonPlayer] = field(default_factory=dict)
    player_order: List[str] = field(default_factory=list)
    scores: Dict[str, int] = field(default_factory=dict)
    status: str = "waiting"
    turn_number: int = 0
    current_balloon: Optional[Balloon] = None
    current_turn: Optional[BalloonTurn] = None
    winner_token: Optional[str] = None
    rematch_ready: Set[str] = field(default_factory=set)
    last_outcome: Optional[dict] = None
    next_turn_at: Optional[int] = None
    paused: bool = False
    paused_remaining_ms: int = 0
    starting_index: Optional[int] = None
    last_active: float = field(default_factory=time.monotonic)

    def join(self, nickname: str, character: str, token: Optional[str] = None) -> BalloonPlayer:
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
        player = BalloonPlayer(
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
            self.starting_index = secrets.randbelow(2)
            self._new_balloon()
            self._start_turn(self.starting_index)
        self.last_active = time.monotonic()
        return player

    def disconnect(self, token: str) -> None:
        player = self.players.get(token)
        if not player:
            return
        player.connected = False
        current = self.current_turn
        if (
            self.status == "playing"
            and current
            and not current.resolved
            and not self.paused
            and current.deadline_at is not None
        ):
            self.paused_remaining_ms = max(0, current.deadline_at - epoch_ms())
            current.deadline_at = None
            self.paused = True
        self.last_active = time.monotonic()

    def resume_if_possible(self) -> bool:
        if self.status != "playing" or not self.paused or not self._all_connected():
            return False
        current = self.current_turn
        if current and not current.resolved:
            current.deadline_at = epoch_ms() + self.paused_remaining_ms
        self.paused = False
        self.paused_remaining_ms = 0
        self.last_active = time.monotonic()
        return True

    def snapshot(self) -> dict:
        balloon = self.current_balloon
        current = self.current_turn
        balloon_public = None
        if balloon:
            balloon_public = {
                "balloonId": balloon.balloon_id,
                "pumpCount": balloon.pump_count,
            }
        current_public = None
        if current:
            current_public = {
                "turnId": current.turn_id,
                "playerId": self.players[current.player_token].public_id,
                "turnScore": current.turn_score,
                "deadlineAt": current.deadline_at,
                "resolved": current.resolved,
            }
        return {
            "roomCode": self.room_code,
            "gameType": "balloon",
            "targetScore": TARGET_SCORE,
            "turnMs": TURN_MS,
            "status": self.status,
            "turnNumber": self.turn_number,
            "players": [self.players[token].public(self.scores.get(token, 0)) for token in self.player_order],
            "balloon": balloon_public,
            "turn": current_public,
            "winnerId": self.players[self.winner_token].public_id if self.winner_token else None,
            "lastOutcome": self.last_outcome,
            "nextTurnAt": self.next_turn_at,
            "paused": self.paused,
            "rematchReadyIds": [self.players[token].public_id for token in self.rematch_ready if token in self.players],
            "serverNow": epoch_ms(),
        }

    def pump(self, token: str, turn_id: str) -> dict:
        player, current = self._active_turn(token, turn_id)
        balloon = self._balloon()
        balloon.pump_count += 1
        current.turn_score += 1
        if balloon.pump_count >= balloon.burst_at:
            outcome = self._resolve_turn("pop", bank_points=False)
            self._new_balloon()
            return {"popped": True, "playerId": player.public_id, **outcome}
        self.last_active = time.monotonic()
        return {
            "popped": False,
            "playerId": player.public_id,
            "turnId": current.turn_id,
            "balloonId": balloon.balloon_id,
            "pumpCount": balloon.pump_count,
            "turnScore": current.turn_score,
        }

    def bank(self, token: str, turn_id: str) -> dict:
        _, current = self._active_turn(token, turn_id)
        if current.turn_score <= 0:
            raise GameError("nothing_to_bank", "한 번 이상 펌프한 뒤 점수를 챙길 수 있어요.")
        return self._resolve_turn("bank", bank_points=True)

    def expire_turn(self) -> Optional[dict]:
        current = self.current_turn
        if (
            self.status != "playing"
            or self.paused
            or not current
            or current.resolved
            or current.deadline_at is None
            or epoch_ms() < current.deadline_at
        ):
            return None
        return self._resolve_turn("timeout", bank_points=True)

    def advance(self) -> bool:
        if self.status != "playing" or self.paused or not self._all_connected():
            return False
        current = self.current_turn
        if not current or not current.resolved or self.next_turn_at is None or epoch_ms() < self.next_turn_at:
            return False
        index = self.player_order.index(current.player_token)
        self._start_turn(1 - index)
        return True

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
        self.turn_number = 0
        self.current_balloon = None
        self.current_turn = None
        self.last_outcome = None
        self.next_turn_at = None
        self.paused = False
        self.paused_remaining_ms = 0
        self.rematch_ready.clear()
        self.status = "playing"
        self.starting_index = 1 - (self.starting_index or 0)
        self._new_balloon()
        self._start_turn(self.starting_index)
        return True

    def _active_turn(self, token: str, turn_id: str) -> tuple[BalloonPlayer, BalloonTurn]:
        player = self._player(token)
        current = self.current_turn
        if current and current.turn_id != turn_id:
            raise GameError("stale_turn", "이전 턴의 입력은 사용할 수 없어요.")
        if self.status != "playing" or not current or current.resolved:
            raise GameError("turn_closed", "이미 끝난 턴이에요.")
        if self.paused:
            raise GameError("game_paused", "친구가 다시 연결되면 이어서 할 수 있어요.")
        if current.player_token != token:
            raise GameError("not_your_turn", "지금은 친구 차례예요.")
        if current.deadline_at is not None and epoch_ms() >= current.deadline_at:
            raise GameError("turn_expired", "시간이 끝났어요.")
        return player, current

    def _resolve_turn(self, kind: str, bank_points: bool) -> dict:
        current = self.current_turn
        if not current or current.resolved:
            raise GameError("turn_closed", "이미 끝난 턴이에요.")
        current.resolved = True
        current.deadline_at = None
        points = current.turn_score if bank_points else 0
        if points:
            self.scores[current.player_token] += points
        outcome = {
            "turnId": current.turn_id,
            "playerId": self.players[current.player_token].public_id,
            "kind": kind,
            "points": points,
            "turnScore": current.turn_score,
            "pumpCount": self._balloon().pump_count,
            "at": epoch_ms(),
        }
        self.last_outcome = outcome
        if self.scores[current.player_token] >= TARGET_SCORE:
            self.status = "finished"
            self.winner_token = current.player_token
            self.next_turn_at = None
        else:
            self.next_turn_at = epoch_ms() + RESULT_BEAT_MS
        self.last_active = time.monotonic()
        return outcome

    def _start_turn(self, index: int) -> None:
        token = self.player_order[index]
        self.turn_number += 1
        self.current_turn = BalloonTurn(
            turn_id=secrets.token_hex(8),
            player_token=token,
            deadline_at=epoch_ms() + TURN_MS if self._all_connected() else None,
        )
        self.next_turn_at = None
        self.paused = not self._all_connected()
        self.paused_remaining_ms = TURN_MS if self.paused else 0
        self.last_active = time.monotonic()

    def _new_balloon(self) -> None:
        self.current_balloon = Balloon(
            balloon_id=secrets.token_hex(8),
            burst_at=choose_burst_at(),
        )

    def _balloon(self) -> Balloon:
        if not self.current_balloon:
            raise GameError("balloon_not_ready", "풍선을 준비하고 있어요.")
        return self.current_balloon

    def _all_connected(self) -> bool:
        return len(self.player_order) == 2 and all(self.players[token].connected for token in self.player_order)

    def _player(self, token: str) -> BalloonPlayer:
        player = self.players.get(token)
        if not player:
            raise GameError("player_not_found", "플레이어 정보를 찾을 수 없어요.")
        return player
