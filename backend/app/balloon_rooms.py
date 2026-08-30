from __future__ import annotations

import asyncio
import random
import string
import time
from typing import Dict

from .balloon import BalloonState
from .game import GameError
from .rooms import ConnectionManager


ROOM_ALPHABET = string.ascii_uppercase + string.digits


class BalloonRoomManager:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self.rooms: Dict[str, BalloonState] = {}
        self.connections = ConnectionManager()
        self.ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    async def create(self) -> BalloonState:
        async with self._lock:
            self.cleanup()
            while True:
                code = "".join(random.SystemRandom().choices(ROOM_ALPHABET, k=5))
                if code not in self.rooms:
                    room = BalloonState(code)
                    self.rooms[code] = room
                    return room

    def get(self, code: str) -> BalloonState:
        room = self.rooms.get(code.upper())
        if not room:
            raise GameError("room_not_found", "터질까 말까! 방을 찾을 수 없어요.")
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


balloon_room_manager = BalloonRoomManager()
