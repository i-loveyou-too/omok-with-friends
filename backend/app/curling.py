from __future__ import annotations

import asyncio
import math
import random
import string
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .game import GameError
from .rooms import ConnectionManager

ROOM_ALPHABET = string.ascii_uppercase + string.digits
CHARACTERS = {"chiikawa", "hachiware", "momonga", "usagi"}

RINK_WIDTH = 1000.0
RINK_HEIGHT = 1600.0
HOUSE_X = 500.0
HOUSE_Y = 270.0
HOUSE_RADIUS = 190.0
STONE_RADIUS = 34.0
START_X = 500.0
START_Y = 1420.0

MAX_ENDS = 3
STONES_PER_PLAYER = 3
MIN_POWER = 0.16
MAX_POWER = 1.0
MAX_ANGLE_DEG = 28.0
MAX_SPEED = 700.0
FRICTION = 162.0
SWEEP_FRICTION_FACTOR = 0.88
SWEEP_CURL_FACTOR = 0.65
RESTITUTION = 0.90
SIDE_WALL_RESTITUTION = 0.72
DT = 1.0 / 60.0
MAX_STEPS = 360
SLEEP_SPEED = 9.0
SCORE_EPSILON = 1.0
TRANSITION_SECONDS = 2.8
TURN_DURATION_SECONDS = 20
RECONNECT_GRACE_SECONDS = 20
CURL_RATE_DEG_PER_SECOND = 20.0
CURL_MIN_RATE_FACTOR = 0.15
CURL_SPEED_CURVE_EXPONENT = 1.5
SCORE_RINGS = ((45.0, 50), (100.0, 30), (150.0, 20), (190.0, 10))
CURL_DIRECTIONS = {"left": -1, "straight": 0, "right": 1}


@dataclass
class ActiveCurlingShot:
    id: int
    token: str
    player_id: str
    stone_id: str
    angle: float
    power: float
    curl: str
    velocities: Dict[str, List[float]]
    impact_count: int = 0
    max_impact_speed: float = 0.0
    step: int = 0
    settled_ticks: int = 0
    sweeping: bool = False
    preexisting_stone_ids: set[str] = field(default_factory=set)
    knocked_out_stone_ids: set[str] = field(default_factory=set)
    opponent_takeout_ids: set[str] = field(default_factory=set)


@dataclass
class CurlingPlayer:
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
class CurlingStone:
    id: str
    owner_id: str
    number: int
    x: float
    y: float
    in_play: bool = True

    def public(self) -> dict:
        return {
            "id": self.id,
            "ownerId": self.owner_id,
            "number": self.number,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "inPlay": self.in_play,
        }


class CurlingRoom:
    def __init__(self, room_code: str) -> None:
        self.room_code = room_code
        self.players: Dict[str, CurlingPlayer] = {}
        self.player_order: List[str] = []
        self.status = "waiting"
        self.game_number = 1
        self.end_number = 1
        self.throw_number = 0
        self.end_start_index = 0
        self.shootout_round = 0
        self.shootout_start_index = 0
        self.shootout_attempts: Dict[str, float] = {}
        self.stones: List[CurlingStone] = []
        self.last_end_result: Optional[dict] = None
        self.end_history: List[dict] = []
        self.last_event: Optional[dict] = None
        self.transition_deadline: Optional[float] = None
        self.transition_kind: Optional[str] = None
        self.winner_id: Optional[str] = None
        self.rematch_ready: set[str] = set()
        self.shot_serial = 0
        self.active_shot: Optional[ActiveCurlingShot] = None
        self.turn_started_at: Optional[float] = None
        self.turn_deadline: Optional[float] = None
        self.turn_serial = 0
        self.reconnect_deadlines: Dict[str, float] = {}
        self.paused_turn_remaining: Optional[float] = None
        self.last_active = time.monotonic()

    def join(self, nickname: str, character: str, token: Optional[str]) -> CurlingPlayer:
        self.last_active = time.monotonic()
        if token and token in self.players:
            now = time.monotonic()
            # Close the reconnect race: arriving after the grace deadline does
            # not beat a timeout task that simply has not been scheduled yet.
            self.expire_reconnect(token, now)
            player = self.players[token]
            player.connected = True
            self.reconnect_deadlines.pop(token, None)
            self.last_active = now
            if self.status == "finished" and len(self.rematch_ready) == 2 and self._all_players_connected():
                self.game_number += 1
                self._start_match()
            elif self._all_players_connected() and self.status in {"playing", "shootout"} and self.active_shot is None:
                self._start_turn_timer(now)
            return player
        if len(self.players) >= 2:
            raise GameError("room_full", "이미 두 명이 플레이 중이에요.")
        if character not in CHARACTERS:
            raise GameError("invalid_character", "캐릭터를 다시 골라 주세요.")
        if not nickname.strip():
            raise GameError("invalid_nickname", "닉네임을 입력해 주세요.")

        player_token = uuid.uuid4().hex
        player = CurlingPlayer(
            token=player_token,
            public_id=uuid.uuid4().hex[:10],
            nickname=nickname.strip()[:12],
            character=character,
        )
        self.players[player_token] = player
        self.player_order.append(player_token)
        if len(self.player_order) == 2:
            self._start_match()
        return player

    def disconnect(self, token: str) -> None:
        player = self.players.get(token)
        if not player:
            return
        now = time.monotonic()
        if not player.connected:
            self.last_active = now
            return
        player.connected = False
        if self.status in {"playing", "shootout", "end_finished"}:
            self.reconnect_deadlines[token] = now + RECONNECT_GRACE_SECONDS
            if self.active_shot is None and self.status in {"playing", "shootout"}:
                self._pause_turn_for_reconnect(now)
        self.last_active = now

    def _all_players_connected(self) -> bool:
        return len(self.player_order) == 2 and all(self.players[token].connected for token in self.player_order)

    def _pause_turn_for_reconnect(self, now: Optional[float] = None) -> None:
        now = time.monotonic() if now is None else now
        if self.turn_deadline is not None:
            self.paused_turn_remaining = max(0.5, self.turn_deadline - now)
        elif self.paused_turn_remaining is None:
            self.paused_turn_remaining = float(TURN_DURATION_SECONDS)
        self._stop_turn_timer()

    def expire_reconnect(self, token: str, now: Optional[float] = None) -> Optional[dict]:
        if token not in self.players:
            return None
        deadline = self.reconnect_deadlines.get(token)
        now = time.monotonic() if now is None else now
        if deadline is None or now < deadline or self.players[token].connected:
            return None
        opponent_token = next((item for item in self.player_order if item != token), None)
        if opponent_token is None or not self.players[opponent_token].connected:
            return None
        self.reconnect_deadlines.pop(token, None)
        if self.status not in {"playing", "shootout", "end_finished"}:
            return None
        winner_id = self.players[opponent_token].public_id
        loser_id = self.players[token].public_id
        self.active_shot = None
        self._finish_match(winner_id)
        event = {
            "type": "reconnect_timeout",
            "playerId": loser_id,
            "winnerId": winner_id,
        }
        self.last_event = event
        return event

    def expire_reconnects(self, now: Optional[float] = None) -> List[dict]:
        events: List[dict] = []
        for token in list(self.reconnect_deadlines):
            event = self.expire_reconnect(token, now)
            if event:
                events.append(event)
                break
        return events

    def _start_match(self) -> None:
        for player in self.players.values():
            player.score = 0
        self.status = "playing"
        self.end_number = 1
        self.throw_number = 0
        self.end_start_index = random.SystemRandom().randrange(2)
        self.shootout_round = 0
        self.shootout_start_index = 0
        self.shootout_attempts = {}
        self.stones = []
        self.last_end_result = None
        self.end_history = []
        self.last_event = {"type": "match_started", "gameNumber": self.game_number}
        self.transition_deadline = None
        self.transition_kind = None
        self.winner_id = None
        self.rematch_ready.clear()
        self.active_shot = None
        self.reconnect_deadlines = {}
        self.paused_turn_remaining = None
        now = time.monotonic()
        for token in self.player_order:
            if not self.players[token].connected:
                self.reconnect_deadlines[token] = now + RECONNECT_GRACE_SECONDS
        self._start_turn_timer(now)

    def _start_turn_timer(self, now: Optional[float] = None) -> None:
        if self.status not in {"playing", "shootout"} or self.active_shot is not None:
            self._stop_turn_timer()
            return
        now = time.monotonic() if now is None else now
        if not self._all_players_connected():
            if self.paused_turn_remaining is None:
                self.paused_turn_remaining = float(TURN_DURATION_SECONDS)
            self._stop_turn_timer()
            return
        duration = self.paused_turn_remaining if self.paused_turn_remaining is not None else float(TURN_DURATION_SECONDS)
        self.paused_turn_remaining = None
        self.turn_started_at = now
        self.turn_deadline = now + max(0.5, duration)
        self.turn_serial += 1

    def _stop_turn_timer(self) -> None:
        self.turn_started_at = None
        self.turn_deadline = None

    def expire_turn(self, now: Optional[float] = None) -> Optional[dict]:
        if (
            self.status not in {"playing", "shootout"}
            or self.active_shot is not None
            or self.turn_deadline is None
            or not self._all_players_connected()
        ):
            return None
        now = time.monotonic() if now is None else now
        if now < self.turn_deadline:
            return None
        expired_token = self.current_token
        if expired_token is None:
            return None
        expired_player_id = self.players[expired_token].public_id
        self._stop_turn_timer()
        self.throw_number += 1
        if self.status == "shootout":
            self.shootout_attempts[expired_player_id] = math.inf
            if self.throw_number < 2:
                # Shootout attempts are independent draw shots. The second
                # player never gets to knock away the first player's attempt.
                self.stones = []
        event = {
            "type": "turn_timeout",
            "playerId": expired_player_id,
            "throwNumber": self.throw_number,
            "shootoutMiss": self.status == "shootout",
        }
        self.last_event = event
        self.last_active = time.monotonic()
        if self.status == "playing" and self.throw_number >= STONES_PER_PLAYER * 2:
            self._finish_end()
        elif self.status == "shootout" and self.throw_number >= 2:
            self._finish_shootout_round()
        else:
            self._start_turn_timer(now)
        return event

    @property
    def current_token(self) -> Optional[str]:
        if len(self.player_order) != 2 or self.status not in {"playing", "shootout"}:
            return None
        start = self.shootout_start_index if self.status == "shootout" else self.end_start_index
        return self.player_order[(start + self.throw_number) % 2]

    @property
    def current_player_id(self) -> Optional[str]:
        token = self.current_token
        return self.players[token].public_id if token and token in self.players else None

    def _assert_turn(self, token: str) -> None:
        if self.status not in {"playing", "shootout"}:
            raise GameError("not_playing", "지금은 스톤을 던질 수 없어요.")
        if not self._all_players_connected():
            raise GameError("opponent_reconnecting", "상대가 다시 연결될 때까지 잠깐 기다려 주세요.")
        if token != self.current_token:
            raise GameError("not_your_turn", "상대 차례예요.")

    def _next_stone_number(self, owner_id: str) -> int:
        return 1 + sum(1 for stone in self.stones if stone.owner_id == owner_id)

    def _new_stone(self, owner_id: str) -> CurlingStone:
        number = self._next_stone_number(owner_id)
        self.shot_serial += 1
        stone = CurlingStone(
            id=f"g{self.game_number}-e{self.end_number}-s{self.shot_serial}",
            owner_id=owner_id,
            number=number,
            x=START_X,
            y=START_Y,
        )
        self.stones.append(stone)
        return stone

    @staticmethod
    def _speed(vx: float, vy: float) -> float:
        return math.hypot(vx, vy)

    @staticmethod
    def _apply_friction(vx: float, vy: float, friction: Optional[float] = None) -> tuple[float, float]:
        friction = FRICTION if friction is None else friction
        speed = math.hypot(vx, vy)
        if speed <= SLEEP_SPEED:
            return 0.0, 0.0
        new_speed = max(0.0, speed - friction * DT)
        if new_speed <= SLEEP_SPEED:
            return 0.0, 0.0
        scale = new_speed / speed
        return vx * scale, vy * scale

    @staticmethod
    def _curl_rate(speed: float, sweeping: bool = False) -> float:
        speed_ratio = min(1.0, speed / MAX_SPEED)
        slowdown = max(0.0, 1.0 - speed_ratio)
        ramp = CURL_MIN_RATE_FACTOR + (1.0 - CURL_MIN_RATE_FACTOR) * (
            slowdown ** CURL_SPEED_CURVE_EXPONENT
        )
        rate = CURL_RATE_DEG_PER_SECOND * ramp
        return rate * SWEEP_CURL_FACTOR if sweeping else rate

    @staticmethod
    def _out_of_bounds(stone: CurlingStone) -> bool:
        # The side rails keep stones live; only fully clearing the open top or
        # bottom edge removes a stone from play.
        return (
            stone.y + STONE_RADIUS <= 0.0
            or stone.y - STONE_RADIUS >= RINK_HEIGHT
        )

    @staticmethod
    def _reflect_side_wall(stone: CurlingStone, vx: float) -> float:
        left = STONE_RADIUS
        right = RINK_WIDTH - STONE_RADIUS
        if stone.x < left:
            stone.x = left + (left - stone.x)
            return abs(vx) * SIDE_WALL_RESTITUTION
        if stone.x > right:
            stone.x = right - (stone.x - right)
            return -abs(vx) * SIDE_WALL_RESTITUTION
        return vx

    def _frame(self) -> list[dict]:
        return [stone.public() for stone in self.stones]

    def _validate_shot(self, token: str, angle: float, power: float, curl: str) -> None:
        self._assert_turn(token)
        if self.turn_deadline is not None and time.monotonic() >= self.turn_deadline:
            raise GameError("turn_expired", "제한시간이 지나 차례가 넘어가고 있어요.")
        if self.active_shot is not None:
            raise GameError("shot_in_progress", "스톤이 멈출 때까지 기다려 주세요.")
        if not math.isfinite(angle) or not math.isfinite(power):
            raise GameError("invalid_shot", "조준 값을 다시 확인해 주세요.")
        if abs(angle) > MAX_ANGLE_DEG:
            raise GameError("invalid_angle", "조준 각도가 너무 커요.")
        if power < MIN_POWER or power > MAX_POWER:
            raise GameError("invalid_power", "파워를 다시 조절해 주세요.")
        if curl not in CURL_DIRECTIONS:
            raise GameError("invalid_curl", "회전 방향을 다시 골라 주세요.")

    def begin_live_shot(self, token: str, angle: float, power: float, curl: str = "straight") -> dict:
        self._validate_shot(token, angle, power, curl)
        self._stop_turn_timer()
        player = self.players[token]
        preexisting_stone_ids = {item.id for item in self.stones if item.in_play}
        stone = self._new_stone(player.public_id)
        angle_rad = math.radians(angle)
        speed = MAX_SPEED * power
        velocities: Dict[str, List[float]] = {
            item.id: [0.0, 0.0]
            for item in self.stones
            if item.in_play
        }
        velocities[stone.id] = [math.sin(angle_rad) * speed, -math.cos(angle_rad) * speed]
        self.active_shot = ActiveCurlingShot(
            id=self.shot_serial,
            token=token,
            player_id=player.public_id,
            stone_id=stone.id,
            angle=angle,
            power=power,
            curl=curl,
            velocities=velocities,
            preexisting_stone_ids=preexisting_stone_ids,
        )
        self.last_event = {
            "type": "shot_started",
            "shotId": self.shot_serial,
            "playerId": player.public_id,
            "stoneId": stone.id,
        }
        self.last_active = time.monotonic()
        return {
            "id": self.shot_serial,
            "playerId": player.public_id,
            "stoneId": stone.id,
            "angle": round(angle, 3),
            "power": round(power, 3),
            "curl": curl,
            "frame": self._frame(),
        }

    def set_sweeping(self, token: str, active: bool) -> dict:
        shot = self.active_shot
        if shot is None:
            if not active and token in self.players:
                return {
                    "shotId": None,
                    "playerId": self.players[token].public_id,
                    "active": False,
                }
            raise GameError("no_active_shot", "지금은 쓸어 줄 스톤이 없어요.")
        if shot.token != token:
            raise GameError("not_your_stone", "내가 던진 스톤만 쓸어 줄 수 있어요.")
        launched = next((stone for stone in self.stones if stone.id == shot.stone_id), None)
        shot.sweeping = bool(active and launched is not None and launched.in_play)
        self.last_active = time.monotonic()
        return {
            "shotId": shot.id,
            "playerId": shot.player_id,
            "active": shot.sweeping,
        }

    def step_live_shot(self) -> bool:
        shot = self.active_shot
        if shot is None:
            return True
        velocities = shot.velocities
        launched = next((stone for stone in self.stones if stone.id == shot.stone_id), None)
        if launched is None:
            return True

        moving = False
        for stone in self.stones:
            if not stone.in_play:
                continue
            vx, vy = velocities.setdefault(stone.id, [0.0, 0.0])
            if vx or vy:
                moving = True
                stone.x += vx * DT
                stone.y += vy * DT
                vx = self._reflect_side_wall(stone, vx)
                velocities[stone.id] = [vx, vy]
                if self._out_of_bounds(stone):
                    stone.in_play = False
                    velocities[stone.id] = [0.0, 0.0]
                    if stone.id == shot.stone_id:
                        shot.sweeping = False
                    elif stone.id in shot.preexisting_stone_ids:
                        shot.knocked_out_stone_ids.add(stone.id)
                        if stone.owner_id != shot.player_id:
                            shot.opponent_takeout_ids.add(stone.id)

        active_stones = [stone for stone in self.stones if stone.in_play]
        for index, first in enumerate(active_stones):
            for second in active_stones[index + 1 :]:
                dx = second.x - first.x
                dy = second.y - first.y
                distance = math.hypot(dx, dy)
                min_distance = STONE_RADIUS * 2.0
                if distance >= min_distance:
                    continue
                if distance < 1e-6:
                    nx, ny = 1.0, 0.0
                    distance = 1.0
                else:
                    nx, ny = dx / distance, dy / distance
                overlap = min_distance - distance
                correction = overlap / 2.0 + 0.01
                first.x -= nx * correction
                first.y -= ny * correction
                second.x += nx * correction
                second.y += ny * correction

                avx, avy = velocities.setdefault(first.id, [0.0, 0.0])
                bvx, bvy = velocities.setdefault(second.id, [0.0, 0.0])
                rvx = bvx - avx
                rvy = bvy - avy
                velocity_along_normal = rvx * nx + rvy * ny
                if velocity_along_normal >= 0:
                    continue
                impact_speed = abs(velocity_along_normal)
                impulse = -(1.0 + RESTITUTION) * velocity_along_normal / 2.0
                ix, iy = impulse * nx, impulse * ny
                velocities[first.id] = [avx - ix, avy - iy]
                velocities[second.id] = [bvx + ix, bvy + iy]
                shot.impact_count += 1
                shot.max_impact_speed = max(shot.max_impact_speed, impact_speed)

        curl_sign = CURL_DIRECTIONS[shot.curl]
        for stone in self.stones:
            if not stone.in_play:
                continue
            vx, vy = velocities.setdefault(stone.id, [0.0, 0.0])
            if stone.id == shot.stone_id and curl_sign and (vx or vy):
                current_speed = self._speed(vx, vy)
                rate = self._curl_rate(current_speed, shot.sweeping)
                # Sweeping intentionally makes the delivered stone travel
                # farther *and* hold a straighter line.
                theta = math.radians(rate * DT * curl_sign)
                cos_t, sin_t = math.cos(theta), math.sin(theta)
                vx, vy = vx * cos_t - vy * sin_t, vx * sin_t + vy * cos_t
            friction = FRICTION
            if stone.id == shot.stone_id and shot.sweeping:
                friction *= SWEEP_FRICTION_FACTOR
            velocities[stone.id] = list(self._apply_friction(vx, vy, friction))
            if stone.id == shot.stone_id and self._speed(*velocities[stone.id]) <= SLEEP_SPEED:
                shot.sweeping = False

        any_moving = any(
            self._speed(vx, vy) > SLEEP_SPEED
            for stone_id, (vx, vy) in velocities.items()
            if next((s for s in self.stones if s.id == stone_id and s.in_play), None)
        )
        shot.settled_ticks = 0 if any_moving else shot.settled_ticks + 1
        shot.step += 1
        return shot.step >= MAX_STEPS or ((not moving and shot.step > 1) or shot.settled_ticks >= 4)

    def finish_live_shot(self) -> dict:
        shot = self.active_shot
        if shot is None:
            raise GameError("no_active_shot", "진행 중인 스톤이 없어요.")
        self.active_shot = None
        self.throw_number += 1
        self.last_active = time.monotonic()
        launched = next((stone for stone in self.stones if stone.id == shot.stone_id), None)
        landing_points = self._stone_target_points(launched) if launched else 0
        distance_to_button = (
            round(self._distance_to_button(launched), 2)
            if launched is not None and launched.in_play
            else None
        )
        out = launched is None or not launched.in_play
        resolved = {
            "id": shot.id,
            "playerId": shot.player_id,
            "stoneId": shot.stone_id,
            "angle": round(shot.angle, 3),
            "power": round(shot.power, 3),
            "curl": shot.curl,
            "frames": [],
            "impactCount": shot.impact_count,
            "maxImpactSpeed": round(shot.max_impact_speed, 2),
            "landingPoints": landing_points,
            "distanceToButton": distance_to_button,
            "out": out,
            "perfect": landing_points == 50,
            "knockedOutStoneIds": sorted(shot.knocked_out_stone_ids),
            "opponentTakeoutCount": len(shot.opponent_takeout_ids),
        }
        self.last_event = {
            "type": "shot",
            "shotId": shot.id,
            "playerId": shot.player_id,
            "stoneId": shot.stone_id,
            "landingPoints": landing_points,
            "out": out,
            "opponentTakeoutCount": len(shot.opponent_takeout_ids),
        }
        if self.status == "shootout":
            self.shootout_attempts[shot.player_id] = (
                self._distance_to_button(launched)
                if launched is not None and launched.in_play
                else math.inf
            )
            if self.throw_number < 2:
                self.stones = []

        if self.status == "playing" and self.throw_number >= STONES_PER_PLAYER * 2:
            self._finish_end()
        elif self.status == "shootout" and self.throw_number >= 2:
            self._finish_shootout_round()
        else:
            self._start_turn_timer()
        return resolved

    def _simulate(self, launched: CurlingStone, angle_deg: float, power: float, curl: str = "straight") -> dict:
        angle_rad = math.radians(angle_deg)
        speed = MAX_SPEED * power
        velocities: Dict[str, List[float]] = {
            stone.id: [0.0, 0.0]
            for stone in self.stones
            if stone.in_play
        }
        velocities[launched.id] = [math.sin(angle_rad) * speed, -math.cos(angle_rad) * speed]
        curl_sign = CURL_DIRECTIONS[curl]

        frames: List[list[dict]] = [self._frame()]
        preexisting_stone_ids = {stone.id for stone in self.stones if stone.id != launched.id and stone.in_play}
        knocked_out_stone_ids: set[str] = set()
        opponent_takeout_ids: set[str] = set()
        impact_count = 0
        max_impact_speed = 0.0
        settled_ticks = 0

        for step in range(MAX_STEPS):
            moving = False
            for stone in self.stones:
                if not stone.in_play:
                    continue
                vx, vy = velocities.setdefault(stone.id, [0.0, 0.0])
                if vx or vy:
                    moving = True
                    stone.x += vx * DT
                    stone.y += vy * DT
                    vx = self._reflect_side_wall(stone, vx)
                    velocities[stone.id] = [vx, vy]
                    if self._out_of_bounds(stone):
                        stone.in_play = False
                        velocities[stone.id] = [0.0, 0.0]
                        if stone.id in preexisting_stone_ids:
                            knocked_out_stone_ids.add(stone.id)
                            if stone.owner_id != launched.owner_id:
                                opponent_takeout_ids.add(stone.id)

            active = [stone for stone in self.stones if stone.in_play]
            for index, first in enumerate(active):
                for second in active[index + 1 :]:
                    dx = second.x - first.x
                    dy = second.y - first.y
                    distance = math.hypot(dx, dy)
                    min_distance = STONE_RADIUS * 2.0
                    if distance >= min_distance:
                        continue

                    if distance < 1e-6:
                        nx, ny = 1.0, 0.0
                        distance = 1.0
                    else:
                        nx, ny = dx / distance, dy / distance

                    overlap = min_distance - distance
                    correction = overlap / 2.0 + 0.01
                    first.x -= nx * correction
                    first.y -= ny * correction
                    second.x += nx * correction
                    second.y += ny * correction

                    avx, avy = velocities.setdefault(first.id, [0.0, 0.0])
                    bvx, bvy = velocities.setdefault(second.id, [0.0, 0.0])
                    rvx = bvx - avx
                    rvy = bvy - avy
                    velocity_along_normal = rvx * nx + rvy * ny
                    if velocity_along_normal >= 0:
                        continue

                    impact_speed = abs(velocity_along_normal)
                    impulse = -(1.0 + RESTITUTION) * velocity_along_normal / 2.0
                    ix, iy = impulse * nx, impulse * ny
                    velocities[first.id] = [avx - ix, avy - iy]
                    velocities[second.id] = [bvx + ix, bvy + iy]
                    impact_count += 1
                    max_impact_speed = max(max_impact_speed, impact_speed)

            for stone in self.stones:
                if not stone.in_play:
                    continue
                vx, vy = velocities.setdefault(stone.id, [0.0, 0.0])
                # Curl is applied only to the launched stone. It starts subtle and
                # becomes a little more visible as the stone slows, which keeps
                # aiming predictable while still enabling guards and draw shots.
                if stone.id == launched.id and curl_sign and (vx or vy):
                    current_speed = self._speed(vx, vy)
                    rate = self._curl_rate(current_speed)
                    theta = math.radians(rate * DT * curl_sign)
                    cos_t, sin_t = math.cos(theta), math.sin(theta)
                    vx, vy = vx * cos_t - vy * sin_t, vx * sin_t + vy * cos_t
                velocities[stone.id] = list(self._apply_friction(vx, vy))

            any_moving = any(
                self._speed(vx, vy) > SLEEP_SPEED
                for stone_id, (vx, vy) in velocities.items()
                if next((s for s in self.stones if s.id == stone_id and s.in_play), None)
            )
            settled_ticks = 0 if any_moving else settled_ticks + 1

            if step % 3 == 2:
                frames.append(self._frame())
            if (not moving and step > 0) or settled_ticks >= 4:
                break

        frames.append(self._frame())
        return {
            "frames": frames,
            "impactCount": impact_count,
            "maxImpactSpeed": round(max_impact_speed, 2),
            "knockedOutStoneIds": sorted(knocked_out_stone_ids),
            "opponentTakeoutCount": len(opponent_takeout_ids),
        }

    def shoot(self, token: str, angle: float, power: float, curl: str = "straight") -> dict:
        self._validate_shot(token, angle, power, curl)
        self._stop_turn_timer()
        player = self.players[token]
        stone = self._new_stone(player.public_id)
        animation = self._simulate(stone, angle, power, curl)
        self.throw_number += 1
        self.last_active = time.monotonic()

        landing_points = self._stone_target_points(stone)
        distance_to_button = round(self._distance_to_button(stone), 2) if stone.in_play else None
        shot = {
            "id": self.shot_serial,
            "playerId": player.public_id,
            "stoneId": stone.id,
            "angle": round(angle, 3),
            "power": round(power, 3),
            "curl": curl,
            "frames": animation["frames"],
            "impactCount": animation["impactCount"],
            "maxImpactSpeed": animation["maxImpactSpeed"],
            "landingPoints": landing_points,
            "distanceToButton": distance_to_button,
            "out": not stone.in_play,
            "perfect": landing_points == 50,
            "knockedOutStoneIds": animation["knockedOutStoneIds"],
            "opponentTakeoutCount": animation["opponentTakeoutCount"],
        }
        self.last_event = {
            "type": "shot",
            "shotId": self.shot_serial,
            "playerId": player.public_id,
            "stoneId": stone.id,
            "landingPoints": landing_points,
            "out": not stone.in_play,
            "opponentTakeoutCount": animation["opponentTakeoutCount"],
        }

        if self.status == "shootout":
            self.shootout_attempts[player.public_id] = (
                self._distance_to_button(stone) if stone.in_play else math.inf
            )
            if self.throw_number < 2:
                self.stones = []

        if self.status == "playing" and self.throw_number >= STONES_PER_PLAYER * 2:
            self._finish_end()
        elif self.status == "shootout" and self.throw_number >= 2:
            self._finish_shootout_round()
        else:
            self._start_turn_timer()

        return shot

    @staticmethod
    def _distance_to_button(stone: CurlingStone) -> float:
        return math.hypot(stone.x - HOUSE_X, stone.y - HOUSE_Y)

    @staticmethod
    def _stone_target_points(stone: CurlingStone) -> int:
        if not stone.in_play:
            return 0
        distance = math.hypot(stone.x - HOUSE_X, stone.y - HOUSE_Y)
        for radius, points in SCORE_RINGS:
            if distance <= radius:
                return points
        return 0

    def calculate_end_score(self) -> dict:
        player_points = {player.public_id: 0 for player in self.players.values()}
        stone_points: dict[str, int] = {}
        scoring_ids: list[str] = []
        for stone in self.stones:
            points = self._stone_target_points(stone)
            stone_points[stone.id] = points
            if points:
                player_points[stone.owner_id] = player_points.get(stone.owner_id, 0) + points
                scoring_ids.append(stone.id)

        player_ids = [self.players[token].public_id for token in self.player_order]
        first = player_points.get(player_ids[0], 0)
        second = player_points.get(player_ids[1], 0)
        winner_id = player_ids[0] if first > second else player_ids[1] if second > first else None
        return {
            "winnerId": winner_id,
            "points": max(first, second),
            "playerPoints": player_points,
            "stonePoints": stone_points,
            "scoringStoneIds": scoring_ids,
        }

    def _next_regular_starter_index(self, result: dict) -> int:
        winner_id = result.get("winnerId")
        if winner_id:
            winner_index = next(
                index for index, token in enumerate(self.player_order)
                if self.players[token].public_id == winner_id
            )
            return 1 - winner_index
        return 1 - self.end_start_index

    def _finish_end(self) -> None:
        self._stop_turn_timer()
        result = self.calculate_end_score()
        for player in self.players.values():
            player.score += result["playerPoints"].get(player.public_id, 0)
        next_starter_index = self._next_regular_starter_index(result)
        next_starter_id = (
            self.players[self.player_order[next_starter_index]].public_id
            if self.end_number < MAX_ENDS
            else None
        )
        self.last_end_result = {
            "kind": "end",
            "endNumber": self.end_number,
            "nextStarterId": next_starter_id,
            **result,
        }
        self.end_history.append({
            "endNumber": self.end_number,
            "winnerId": result["winnerId"],
            "playerPoints": dict(result["playerPoints"]),
        })
        self.status = "end_finished"
        self.transition_deadline = time.monotonic() + TRANSITION_SECONDS
        self.transition_kind = "after_end"
        self.last_event = {"type": "end_finished", **self.last_end_result}

    @staticmethod
    def _public_distance(distance: float) -> Optional[float]:
        return None if math.isinf(distance) else round(distance, 2)

    def _shootout_distances(self) -> dict[str, float]:
        player_ids = [self.players[token].public_id for token in self.player_order]
        return {
            player_id: self.shootout_attempts.get(player_id, math.inf)
            for player_id in player_ids
        }

    def _finish_shootout_round(self) -> None:
        self._stop_turn_timer()
        distances = self._shootout_distances()
        player_ids = [self.players[token].public_id for token in self.player_order]
        first_distance = distances[player_ids[0]]
        second_distance = distances[player_ids[1]]
        public_distances = {
            player_id: self._public_distance(distance)
            for player_id, distance in distances.items()
        }

        if abs(first_distance - second_distance) <= SCORE_EPSILON or (
            math.isinf(first_distance) and math.isinf(second_distance)
        ):
            self.last_end_result = {
                "kind": "shootout",
                "round": self.shootout_round,
                "winnerId": None,
                "points": 0,
                "distances": public_distances,
                "tie": True,
            }
            self.status = "end_finished"
            self.transition_deadline = time.monotonic() + TRANSITION_SECONDS
            self.transition_kind = "shootout_retry"
            self.last_event = {
                "type": "shootout_tied",
                "round": self.shootout_round,
                "distances": public_distances,
            }
            return

        winner_id = player_ids[0] if first_distance < second_distance else player_ids[1]
        self.last_end_result = {
            "kind": "shootout",
            "round": self.shootout_round,
            "winnerId": winner_id,
            "points": 0,
            "distances": public_distances,
            "tie": False,
        }
        self._finish_match(winner_id)

    def _start_regular_end(self) -> None:
        self.status = "playing"
        self.throw_number = 0
        # The lower-scoring player opens the next end. A tie flips the
        # previous starter. The result snapshot also exposes this decision.
        if self.last_end_result and self.last_end_result.get("nextStarterId"):
            next_starter_id = self.last_end_result["nextStarterId"]
            self.end_start_index = next(
                index for index, token in enumerate(self.player_order)
                if self.players[token].public_id == next_starter_id
            )
        elif self.last_end_result:
            self.end_start_index = self._next_regular_starter_index(self.last_end_result)
        self.stones = []
        self.transition_deadline = None
        self.transition_kind = None
        self.last_event = {"type": "end_started", "endNumber": self.end_number}
        self._start_turn_timer()

    def _start_shootout(self) -> None:
        self.status = "shootout"
        self.shootout_round += 1
        self.throw_number = 0
        self.shootout_start_index = (self.shootout_round + self.game_number - 2) % 2
        self.shootout_attempts = {}
        self.stones = []
        self.transition_deadline = None
        self.transition_kind = None
        self.last_event = {"type": "shootout_started", "round": self.shootout_round}
        self._start_turn_timer()

    def _finish_match(self, winner_id: str) -> None:
        self._stop_turn_timer()
        self.status = "finished"
        self.winner_id = winner_id
        self.transition_deadline = None
        self.transition_kind = None
        self.reconnect_deadlines.clear()
        self.paused_turn_remaining = None
        self.last_event = {"type": "match_finished", "winnerId": winner_id}

    def advance(self, now: Optional[float] = None) -> Optional[dict]:
        if self.status != "end_finished" or self.transition_deadline is None:
            return None
        now = time.monotonic() if now is None else now
        if now < self.transition_deadline:
            return None

        kind = self.transition_kind
        if kind == "shootout_retry":
            self._start_shootout()
            return {"type": "shootout_started", "round": self.shootout_round}

        if self.end_number < MAX_ENDS:
            self.end_number += 1
            self._start_regular_end()
            return {"type": "end_started", "endNumber": self.end_number}

        scores = sorted((player.score, player.public_id) for player in self.players.values())
        if scores[0][0] == scores[1][0]:
            self._start_shootout()
            return {"type": "shootout_started", "round": self.shootout_round}

        winner_id = max(self.players.values(), key=lambda player: player.score).public_id
        self._finish_match(winner_id)
        return {"type": "match_finished", "winnerId": winner_id}

    def leave(self, token: str) -> Optional[dict]:
        if token not in self.players:
            return None
        if self.status == "waiting":
            player_id = self.players[token].public_id
            self.players.pop(token, None)
            self.player_order = [item for item in self.player_order if item != token]
            self.reconnect_deadlines.pop(token, None)
            self.last_active = time.monotonic()
            self.last_event = {"type": "player_left", "playerId": player_id}
            return None
        if self.status in {"playing", "shootout", "end_finished"}:
            return self.forfeit(token)
        self.disconnect(token)
        return None

    def forfeit(self, token: str) -> Optional[dict]:
        if token not in self.players:
            raise GameError("not_in_room", "방에 다시 들어와 주세요.")
        if self.status not in {"playing", "shootout", "end_finished"}:
            return None
        opponent_token = next((item for item in self.player_order if item != token), None)
        if opponent_token is None:
            return None
        winner_id = self.players[opponent_token].public_id
        loser_id = self.players[token].public_id
        self.active_shot = None
        self._finish_match(winner_id)
        event = {
            "type": "forfeit",
            "playerId": loser_id,
            "winnerId": winner_id,
        }
        self.last_event = event
        return event

    def _in_shootout_context(self) -> bool:
        return self.status == "shootout" or bool(
            self.last_end_result and self.last_end_result.get("kind") == "shootout"
        )

    def _throws_used_by_player(self) -> dict[str, int]:
        counts = {self.players[token].public_id: 0 for token in self.player_order}
        if len(self.player_order) != 2:
            return counts
        if self._in_shootout_context():
            start = self.shootout_start_index
            total = min(self.throw_number, 2)
        else:
            start = self.end_start_index
            total = min(self.throw_number, STONES_PER_PLAYER * 2)
        for index in range(total):
            token = self.player_order[(start + index) % 2]
            counts[self.players[token].public_id] += 1
        return counts

    def request_rematch(self, token: str) -> None:
        if self.status != "finished":
            raise GameError("match_not_finished", "경기가 끝난 뒤 재대결할 수 있어요.")
        if token not in self.players:
            raise GameError("not_in_room", "방에 다시 들어와 주세요.")
        self.rematch_ready.add(self.players[token].public_id)
        if len(self.rematch_ready) == 2 and self._all_players_connected():
            self.game_number += 1
            self._start_match()

    def snapshot(self) -> dict:
        now_monotonic = time.monotonic()
        now_epoch_ms = int(time.time() * 1000)
        transition_deadline_ms = None
        if self.transition_deadline is not None:
            remaining = max(0.0, self.transition_deadline - now_monotonic)
            transition_deadline_ms = int(now_epoch_ms + remaining * 1000)
        public_reconnect_deadlines: dict[str, int] = {}
        for token, deadline in self.reconnect_deadlines.items():
            if token not in self.players or self.players[token].connected:
                continue
            remaining = max(0.0, deadline - now_monotonic)
            public_reconnect_deadlines[self.players[token].public_id] = int(now_epoch_ms + remaining * 1000)
        turn_started_at_ms = None
        turn_deadline_ms = None
        if self.turn_started_at is not None and self.turn_deadline is not None:
            elapsed = max(0.0, now_monotonic - self.turn_started_at)
            remaining = max(0.0, self.turn_deadline - now_monotonic)
            turn_started_at_ms = int(now_epoch_ms - elapsed * 1000)
            turn_deadline_ms = int(now_epoch_ms + remaining * 1000)
        throws_used = self._throws_used_by_player()
        shootout_context = self._in_shootout_context()
        throws_limit = 1 if shootout_context else STONES_PER_PLAYER
        throws_remaining = {
            player_id: max(0, throws_limit - used)
            for player_id, used in throws_used.items()
        }
        current_starter_index = self.shootout_start_index if shootout_context else self.end_start_index
        starter_id = (
            self.players[self.player_order[current_starter_index]].public_id
            if len(self.player_order) == 2
            else None
        )
        public_shootout_attempts = {
            player_id: self._public_distance(distance)
            for player_id, distance in self._shootout_distances().items()
        } if len(self.player_order) == 2 else {}

        return {
            "roomCode": self.room_code,
            "gameType": "curling",
            "gameNumber": self.game_number,
            "status": self.status,
            "endNumber": self.end_number,
            "maxEnds": MAX_ENDS,
            "stonesPerPlayer": STONES_PER_PLAYER,
            "players": [self.players[token].public() for token in self.player_order],
            "turnPlayerId": self.current_player_id,
            "starterPlayerId": starter_id,
            "throwNumber": self.throw_number,
            "throwsUsedByPlayer": throws_used,
            "throwsRemainingByPlayer": throws_remaining,
            "shotInProgress": self.active_shot is not None,
            "activeShotPlayerId": self.active_shot.player_id if self.active_shot else None,
            "sweeping": bool(self.active_shot and self.active_shot.sweeping),
            "stones": [stone.public() for stone in self.stones],
            "house": {
                "x": HOUSE_X,
                "y": HOUSE_Y,
                "radius": HOUSE_RADIUS,
                "stoneRadius": STONE_RADIUS,
                "rinkWidth": RINK_WIDTH,
                "rinkHeight": RINK_HEIGHT,
                "startX": START_X,
                "startY": START_Y,
                "scoreRings": [{"radius": radius, "points": points} for radius, points in SCORE_RINGS],
            },
            "curlOptions": ["left", "straight", "right"],
            "lastEndResult": self.last_end_result,
            "endHistory": self.end_history,
            "lastEvent": self.last_event,
            "shootoutRound": self.shootout_round,
            "shootoutAttempts": public_shootout_attempts,
            "shootoutAttemptedPlayerIds": sorted(self.shootout_attempts.keys()),
            "winnerId": self.winner_id,
            "rematchReady": sorted(self.rematch_ready),
            "transitionDeadline": transition_deadline_ms,
            "turnDurationSeconds": TURN_DURATION_SECONDS,
            "turnStartedAt": turn_started_at_ms,
            "turnDeadline": turn_deadline_ms,
            "turnSerial": self.turn_serial,
            "pausedForReconnect": bool(public_reconnect_deadlines),
            "reconnectGraceSeconds": RECONNECT_GRACE_SECONDS,
            "reconnectDeadlines": public_reconnect_deadlines,
            "activeShot": ({
                "id": self.active_shot.id,
                "playerId": self.active_shot.player_id,
                "stoneId": self.active_shot.stone_id,
                "curl": self.active_shot.curl,
                "power": round(self.active_shot.power, 3),
                "angle": round(self.active_shot.angle, 3),
            } if self.active_shot else None),
            "serverNow": now_epoch_ms,
        }


class CurlingRoomManager:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self.rooms: Dict[str, CurlingRoom] = {}
        self.connections = ConnectionManager()
        self.ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    async def create(self) -> CurlingRoom:
        async with self._lock:
            self.cleanup()
            while True:
                code = "".join(random.SystemRandom().choices(ROOM_ALPHABET, k=5))
                if code not in self.rooms:
                    room = CurlingRoom(code)
                    self.rooms[code] = room
                    return room

    def get(self, code: str) -> CurlingRoom:
        room = self.rooms.get(code.upper())
        if not room:
            raise GameError("room_not_found", "방을 찾을 수 없어요.")
        room.last_active = time.monotonic()
        return room

    def cleanup(self) -> None:
        now = time.monotonic()
        stale = [
            code
            for code, room in self.rooms.items()
            if now - room.last_active > self.ttl_seconds
            and not any(player.connected for player in room.players.values())
        ]
        for code in stale:
            self.rooms.pop(code, None)
            self.connections.connections.pop(code, None)


curling_room_manager = CurlingRoomManager()
