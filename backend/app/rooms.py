from __future__ import annotations

import asyncio
import random
import string
import time
from typing import Dict, Optional

from fastapi import WebSocket

from .game import GameError, GameState


ROOM_ALPHABET = string.ascii_uppercase + string.digits


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, room_code: str, token: str, websocket: WebSocket) -> None:
        old = self.connections.setdefault(room_code, {}).get(token)
        if old and old is not websocket:
            try:
                await old.close(code=4001, reason="A newer connection replaced this one")
            except Exception:
                pass
        self.connections[room_code][token] = websocket

    def disconnect(self, room_code: str, token: str, websocket: WebSocket) -> None:
        room = self.connections.get(room_code)
        if room and room.get(token) is websocket:
            room.pop(token, None)
        if room == {}:
            self.connections.pop(room_code, None)

    async def send(self, websocket: WebSocket, payload: dict) -> None:
        await websocket.send_json(payload)

    async def broadcast(self, room_code: str, payload: dict) -> None:
        dead = []
        for token, socket in list(self.connections.get(room_code, {}).items()):
            try:
                await socket.send_json(payload)
            except Exception:
                dead.append(token)
        for token in dead:
            self.connections.get(room_code, {}).pop(token, None)


class RoomManager:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self.rooms: Dict[str, GameState] = {}
        self.connections = ConnectionManager()
        self.ttl_seconds = ttl_seconds
        self._lock = asyncio.Lock()

    async def create(self) -> GameState:
        async with self._lock:
            self.cleanup()
            while True:
                code = "".join(random.SystemRandom().choices(ROOM_ALPHABET, k=5))
                if code not in self.rooms:
                    room = GameState(code)
                    self.rooms[code] = room
                    return room

    def get(self, code: str) -> GameState:
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


room_manager = RoomManager()

