from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .game import GameError
from .protocol import JoinMessage, MoveMessage, ReactionMessage, SecretCardActionMessage, SecretCardSimpleMessage, SecretCardSkillMessage, SimpleMessage, UndoResponseMessage, client_message_adapter, secret_card_message_adapter
from .rooms import room_manager
from .secret_card import SecretCardState
from .secret_rooms import secret_card_room_manager


async def broadcast_secret_state(room: SecretCardState) -> None:
    dead = []
    connections = secret_card_room_manager.connections.connections.get(room.room_code, {})
    for token, socket in list(connections.items()):
        try:
            await socket.send_json({"type": "game_state", "state": room.snapshot(token)})
        except Exception:
            dead.append((token, socket))
    for token, socket in dead:
        secret_card_room_manager.connections.disconnect(room.room_code, token, socket)
        room.disconnect(token)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async def maintain_rooms() -> None:
        cleanup_ticks = 0
        while True:
            await asyncio.sleep(0.25)
            cleanup_ticks += 1
            for room in list(room_manager.rooms.values()):
                timeout_event = room.expire_turn()
                if timeout_event:
                    await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
                    await room_manager.connections.broadcast(room.room_code, {"type": "turn_timeout", **timeout_event})
            for room in list(secret_card_room_manager.rooms.values()):
                timeout_event = room.expire_turn()
                reconnect_events = room.expire_reconnects()
                transition_event = room.advance()
                if timeout_event or reconnect_events or transition_event:
                    await broadcast_secret_state(room)
                if timeout_event:
                    await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "round_timeout", **timeout_event})
                for reconnect_event in reconnect_events:
                    await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "reconnect_timeout", **reconnect_event})
                if transition_event:
                    await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "auto_advanced", **transition_event})
            if cleanup_ticks >= 240:
                cleanup_ticks = 0
                room_manager.cleanup()
                secret_card_room_manager.cleanup()

    cleanup_task = asyncio.create_task(maintain_rooms())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(title="먼작귀게임방", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(GameError)
async def game_error_handler(_: Request, exc: GameError) -> JSONResponse:
    return JSONResponse(status_code=404 if exc.code == "room_not_found" else 400, content={"code": exc.code, "message": exc.message})


@app.get("/omokwithfriend/api/health")
async def health() -> dict:
    return {"ok": True, "rooms": len(room_manager.rooms), "secretCardRooms": len(secret_card_room_manager.rooms)}


@app.post("/omokwithfriend/api/rooms", status_code=201)
async def create_room() -> dict:
    room = await room_manager.create()
    return {"roomCode": room.room_code}


@app.get("/omokwithfriend/api/rooms/{room_code}")
async def room_status(room_code: str) -> dict:
    room = room_manager.get(room_code)
    return {"roomCode": room.room_code, "available": len(room.players) < 2}


@app.post("/omokwithfriend/api/secret-card/rooms", status_code=201)
async def create_secret_card_room() -> dict:
    room = await secret_card_room_manager.create()
    return {"roomCode": room.room_code, "gameType": "secret_card"}


@app.get("/omokwithfriend/api/secret-card/rooms/{room_code}")
async def secret_card_room_status(room_code: str) -> dict:
    room = secret_card_room_manager.get(room_code)
    return {"roomCode": room.room_code, "gameType": "secret_card", "available": len(room.players) < 2}


@app.websocket("/omokwithfriend/ws/rooms/{room_code}")
async def room_socket(websocket: WebSocket, room_code: str) -> None:
    await websocket.accept()
    token = None
    room = None
    try:
        room = room_manager.get(room_code)
        first = client_message_adapter.validate_python(await websocket.receive_json())
        if not isinstance(first, JoinMessage):
            raise GameError("join_required", "먼저 방에 입장해 주세요.")
        player = room.join(first.nickname, first.character, first.token)
        token = player.token
        reconnected = bool(first.token and first.token == token)
        await room_manager.connections.connect(room.room_code, token, websocket)
        await room_manager.connections.send(websocket, {"type": "joined", "token": token, "playerId": player.public_id, "reconnected": reconnected})
        await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
        if reconnected:
            await room_manager.connections.broadcast(room.room_code, {"type": "presence", "playerId": player.public_id, "status": "reconnected"})

        while True:
            try:
                message = client_message_adapter.validate_python(await websocket.receive_json())
                if isinstance(message, JoinMessage):
                    raise GameError("already_joined", "이미 입장했어요.")
                if isinstance(message, MoveMessage):
                    event = room.make_move(token, message.row, message.col)
                    await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
                    await room_manager.connections.broadcast(room.room_code, {"type": "move_confirmed", **event})
                    continue
                if isinstance(message, ReactionMessage):
                    event = room.reaction(token, message.value)
                    await room_manager.connections.broadcast(room.room_code, {"type": "reaction", **event})
                    continue
                if isinstance(message, UndoResponseMessage):
                    event = room.respond_undo(token, message.accept)
                    await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
                    await room_manager.connections.broadcast(room.room_code, {"type": "undo_result", **event})
                    continue
                if isinstance(message, SimpleMessage):
                    if message.type == "undo_request":
                        event = room.request_undo(token)
                        await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
                        await room_manager.connections.broadcast(room.room_code, {"type": "undo_requested", **event})
                        continue
                    if message.type == "rematch_request":
                        room.request_rematch(token)
                    elif message.type == "spicy_curry":
                        event = room.awaken(token)
                        await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
                        await room_manager.connections.broadcast(room.room_code, {"type": "player_awakened", **event})
                        continue
                    elif message.type == "resign":
                        room.resign(token)
                    elif message.type == "leave":
                        if room.status == "playing" and len(room.players) == 2:
                            room.resign(token)
                        room.disconnect(token)
                        await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
                        await websocket.close(code=1000)
                        return
                    elif message.type == "ping":
                        await room_manager.connections.send(websocket, {"type": "pong"})
                        continue
                await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})
            except (GameError, ValidationError) as exc:
                code, detail = (exc.code, exc.message) if isinstance(exc, GameError) else ("invalid_message", "메시지 형식이 올바르지 않아요.")
                await room_manager.connections.send(websocket, {"type": "error", "code": code, "message": detail})
    except WebSocketDisconnect:
        pass
    except (GameError, ValidationError) as exc:
        code, detail = (exc.code, exc.message) if isinstance(exc, GameError) else ("invalid_message", "입장 정보가 올바르지 않아요.")
        await websocket.send_json({"type": "error", "code": code, "message": detail})
        await websocket.close(code=4000)
    finally:
        if token and room:
            current = room_manager.connections.disconnect(room.room_code, token, websocket)
            if current:
                room.disconnect(token)
                await room_manager.connections.broadcast(room.room_code, {"type": "presence", "playerId": room.players[token].public_id, "status": "disconnected"})
                await room_manager.connections.broadcast(room.room_code, {"type": "game_state", "state": room.snapshot()})


@app.websocket("/omokwithfriend/ws/secret-card/rooms/{room_code}")
async def secret_card_room_socket(websocket: WebSocket, room_code: str) -> None:
    await websocket.accept()
    token = None
    room = None
    try:
        room = secret_card_room_manager.get(room_code)
        first = secret_card_message_adapter.validate_python(await websocket.receive_json())
        if not isinstance(first, JoinMessage):
            raise GameError("join_required", "먼저 방에 입장해 주세요.")
        player = room.join(first.nickname, first.character, first.token)
        token = player.token
        reconnected = bool(first.token and first.token == token)
        await secret_card_room_manager.connections.connect(room.room_code, token, websocket)
        await secret_card_room_manager.connections.send(websocket, {"type": "joined", "token": token, "playerId": player.public_id, "reconnected": reconnected})
        await broadcast_secret_state(room)
        if reconnected:
            await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "presence", "playerId": player.public_id, "status": "reconnected"})

        while True:
            try:
                message = secret_card_message_adapter.validate_python(await websocket.receive_json())
                if isinstance(message, JoinMessage):
                    raise GameError("already_joined", "이미 입장했어요.")
                if isinstance(message, ReactionMessage):
                    event = room.reaction(token, message.value)
                    await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "reaction", **event})
                    continue
                if isinstance(message, SecretCardActionMessage):
                    event = room.act(token, message.action, message.amount)
                    await broadcast_secret_state(room)
                    await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "card_action_confirmed", **event})
                    continue
                if isinstance(message, SecretCardSkillMessage):
                    event = room.use_skill(token, message.skill)
                    await broadcast_secret_state(room)
                    await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "skill_used", **event})
                    continue
                if isinstance(message, SecretCardSimpleMessage):
                    if message.type == "next_round":
                        room.request_next_round(token)
                    elif message.type == "rematch_request":
                        room.request_rematch(token)
                    elif message.type == "leave":
                        room.leave(token)
                        await broadcast_secret_state(room)
                        await websocket.close(code=1000)
                        return
                    elif message.type == "ping":
                        await secret_card_room_manager.connections.send(websocket, {"type": "pong"})
                        continue
                    await broadcast_secret_state(room)
            except (GameError, ValidationError) as exc:
                code, detail = (exc.code, exc.message) if isinstance(exc, GameError) else ("invalid_message", "메시지 형식이 올바르지 않아요.")
                await secret_card_room_manager.connections.send(websocket, {"type": "error", "code": code, "message": detail})
    except WebSocketDisconnect:
        pass
    except (GameError, ValidationError) as exc:
        code, detail = (exc.code, exc.message) if isinstance(exc, GameError) else ("invalid_message", "입장 정보가 올바르지 않아요.")
        await websocket.send_json({"type": "error", "code": code, "message": detail})
        await websocket.close(code=4000)
    finally:
        if token and room:
            current = secret_card_room_manager.connections.disconnect(room.room_code, token, websocket)
            if current:
                room.disconnect(token)
                await secret_card_room_manager.connections.broadcast(room.room_code, {"type": "presence", "playerId": room.players[token].public_id, "status": "disconnected"})
                await broadcast_secret_state(room)
