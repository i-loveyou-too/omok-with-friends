from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from contextlib import suppress

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .game import GameError
from .protocol import (
    JoinMessage,
    MoveMessage,
    ReactionMessage,
    SimpleMessage,
    UndoResponseMessage,
    client_message_adapter,
)
from .rooms import room_manager


@asynccontextmanager
async def lifespan(_: FastAPI):
    async def cleanup_rooms() -> None:
        while True:
            await asyncio.sleep(60)
            room_manager.cleanup()

    cleanup_task = asyncio.create_task(cleanup_rooms())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(title="오목 한 판?", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(GameError)
async def game_error_handler(_: Request, exc: GameError) -> JSONResponse:
    status_code = 404 if exc.code == "room_not_found" else 400
    return JSONResponse(status_code=status_code, content={"code": exc.code, "message": exc.message})


@app.get("/omokwithfriend/api/health")
async def health() -> dict:
    return {"ok": True, "rooms": len(room_manager.rooms)}


@app.post("/omokwithfriend/api/rooms", status_code=201)
async def create_room() -> dict:
    room = await room_manager.create()
    return {"roomCode": room.room_code}


@app.get("/omokwithfriend/api/rooms/{room_code}")
async def room_status(room_code: str) -> dict:
    room = room_manager.get(room_code)
    return {"roomCode": room.room_code, "available": len(room.players) < 2}


@app.websocket("/omokwithfriend/ws/rooms/{room_code}")
async def room_socket(websocket: WebSocket, room_code: str) -> None:
    await websocket.accept()
    token = None
    room = None
    try:
        room = room_manager.get(room_code)
        raw = await websocket.receive_json()
        first = client_message_adapter.validate_python(raw)
        if not isinstance(first, JoinMessage):
            raise GameError("join_required", "먼저 방에 입장해 주세요.")

        player = room.join(first.nickname, first.character, first.token)
        token = player.token
        reconnected = bool(first.token and first.token == token)
        await room_manager.connections.connect(room.room_code, token, websocket)
        await room_manager.connections.send(
            websocket,
            {
                "type": "joined",
                "token": token,
                "playerId": player.public_id,
                "reconnected": reconnected,
            },
        )
        await room_manager.connections.broadcast(
            room.room_code,
            {"type": "game_state", "state": room.snapshot()},
        )
        if reconnected:
            await room_manager.connections.broadcast(
                room.room_code,
                {"type": "presence", "playerId": player.public_id, "status": "reconnected"},
            )

        while True:
            raw = await websocket.receive_json()
            try:
                message = client_message_adapter.validate_python(raw)
                if isinstance(message, JoinMessage):
                    raise GameError("already_joined", "이미 입장했어요.")
                if isinstance(message, MoveMessage):
                    room.make_move(token, message.row, message.col)
                elif isinstance(message, ReactionMessage):
                    reaction = room.reaction(token, message.value)
                    await room_manager.connections.broadcast(
                        room.room_code, {"type": "reaction", **reaction}
                    )
                    continue
                elif isinstance(message, UndoResponseMessage):
                    room.respond_undo(token, message.accept)
                elif isinstance(message, SimpleMessage):
                    if message.type == "undo_request":
                        room.request_undo(token)
                    elif message.type == "rematch_request":
                        room.request_rematch(token)
                    elif message.type == "resign":
                        room.resign(token)
                    elif message.type == "leave":
                        if room.status == "playing" and len(room.players) == 2:
                            room.resign(token)
                        room.disconnect(token)
                        await room_manager.connections.broadcast(
                            room.room_code, {"type": "game_state", "state": room.snapshot()}
                        )
                        await websocket.close(code=1000)
                        return
                    elif message.type == "ping":
                        await room_manager.connections.send(websocket, {"type": "pong"})
                        continue

                await room_manager.connections.broadcast(
                    room.room_code, {"type": "game_state", "state": room.snapshot()}
                )
            except (GameError, ValidationError) as exc:
                if isinstance(exc, GameError):
                    code, detail = exc.code, exc.message
                else:
                    code, detail = "invalid_message", "메시지 형식이 올바르지 않아요."
                await room_manager.connections.send(
                    websocket, {"type": "error", "code": code, "message": detail}
                )
    except WebSocketDisconnect:
        pass
    except (GameError, ValidationError) as exc:
        if isinstance(exc, GameError):
            code, detail = exc.code, exc.message
        else:
            code, detail = "invalid_message", "입장 정보가 올바르지 않아요."
        await websocket.send_json({"type": "error", "code": code, "message": detail})
        await websocket.close(code=4000)
    finally:
        if token and room:
            room_manager.connections.disconnect(room.room_code, token, websocket)
            room.disconnect(token)
            await room_manager.connections.broadcast(
                room.room_code,
                {"type": "presence", "playerId": room.players[token].public_id, "status": "disconnected"},
            )
            await room_manager.connections.broadcast(
                room.room_code, {"type": "game_state", "state": room.snapshot()}
            )
