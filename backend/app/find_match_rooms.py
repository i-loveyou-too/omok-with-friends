from __future__ import annotations

import asyncio
import random
import string
import time
from typing import Dict

from .find_match import FindMatchState
from .game import GameError
from .rooms import ConnectionManager


ROOM_ALPHABET = string.ascii_uppercase + string.digits


class FindMatchRoomManager:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self.rooms: Dict[str, FindMatchState] = {}
        self.connections = ConnectionManager()
        self.ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    async def create(self, difficulty: str = "medium", win_target: int = 10) -> FindMatchState:
        async with self._lock:
            self.cleanup()
            while True:
                code = "".join(random.SystemRandom().choices(ROOM_ALPHABET, k=5))
                if code not in self.rooms:
                    room = FindMatchState(code, difficulty=difficulty, win_target=win_target)
                    self.rooms[code] = room
                    return room

    def get(self, code: str) -> FindMatchState:
        room = self.rooms.get(code.upper())
        if not room:
            raise GameError("room_not_found", "눈 크게 떠! 방을 찾을 수 없어요.")
        room.last_active = time.monotonic()
        return room

    def cleanup(self) -> None:
        now = time.monotonic()
        stale = [
            code for code, room in self.rooms.items()
            if now - room.last_active > self.ttl_seconds
            and not any(player.connected for player in room.players.values())
        ]
        for code in stale:
            self.rooms.pop(code, None)
            self.connections.connections.pop(code, None)


find_match_room_manager = FindMatchRoomManager()
