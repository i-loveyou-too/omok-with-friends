from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .curling import DT, TRANSITION_SECONDS, CurlingRoom, curling_room_manager
from .game import GameError

router = APIRouter()


async def broadcast_state(room: CurlingRoom) -> None:
    await curling_room_manager.connections.broadcast(
        room.room_code,
        {"type": "game_state", "state": room.snapshot()},
    )


def schedule_turn_timeout(room: CurlingRoom) -> None:
    if room.turn_deadline is None or room.status not in {"playing", "shootout"} or room.active_shot is not None:
        return
    asyncio.create_task(
        watch_turn_timeout(
            room.room_code,
            room.game_number,
            room.turn_serial,
            room.turn_deadline,
        )
    )




def schedule_reconnect_timeouts(room: CurlingRoom) -> None:
    for token, deadline in list(room.reconnect_deadlines.items()):
        if token in room.players and not room.players[token].connected:
            asyncio.create_task(
                watch_reconnect_timeout(
                    room.room_code,
                    room.game_number,
                    token,
                    deadline,
                )
            )


async def watch_reconnect_timeout(
    room_code: str,
    game_number: int,
    token: str,
    deadline: float,
) -> None:
    await asyncio.sleep(max(0.0, deadline - time.monotonic()) + 0.04)
    try:
        room = curling_room_manager.get(room_code)
    except GameError:
        return
    if room.game_number != game_number or room.reconnect_deadlines.get(token) != deadline:
        return
    event = room.expire_reconnect(token)
    if not event:
        return
    await broadcast_state(room)
    await curling_room_manager.connections.broadcast(room.room_code, event)


async def watch_turn_timeout(
    room_code: str,
    game_number: int,
    turn_serial: int,
    deadline: float,
) -> None:
    await asyncio.sleep(max(0.0, deadline - time.monotonic()) + 0.03)
    try:
        room = curling_room_manager.get(room_code)
    except GameError:
        return
    if room.game_number != game_number or room.turn_serial != turn_serial:
        return
    event = room.expire_turn()
    if not event:
        return
    await broadcast_state(room)
    await curling_room_manager.connections.broadcast(room.room_code, event)
    if room.status == "end_finished":
        asyncio.create_task(advance_after_transition(room.room_code, room.game_number))
    else:
        schedule_turn_timeout(room)


async def advance_after_transition(room_code: str, game_number: int) -> None:
    await asyncio.sleep(TRANSITION_SECONDS + 0.08)
    try:
        room = curling_room_manager.get(room_code)
    except GameError:
        return
    if room.game_number != game_number:
        return
    event = room.advance()
    if event:
        await broadcast_state(room)
        schedule_turn_timeout(room)


async def resolve_live_shot(room_code: str, game_number: int, shot_id: int) -> None:
    try:
        room = curling_room_manager.get(room_code)
    except GameError:
        return
    while room.game_number == game_number and room.active_shot and room.active_shot.id == shot_id:
        done = room.step_live_shot()
        active = room.active_shot
        if active and (active.step % 3 == 0 or done):
            await curling_room_manager.connections.broadcast(
                room.room_code,
                {
                    "type": "shot_frame",
                    "shotId": active.id,
                    "frame": room._frame(),
                    "sweeping": active.sweeping,
                },
            )
        if done:
            shot = room.finish_live_shot()
            # Keep the final live frame visible until the authoritative snapshot arrives.
            await broadcast_state(room)
            await curling_room_manager.connections.broadcast(
                room.room_code,
                {"type": "shot_resolved", "shot": shot},
            )
            if room.status == "end_finished":
                asyncio.create_task(advance_after_transition(room.room_code, room.game_number))
            else:
                schedule_turn_timeout(room)
            return
        await asyncio.sleep(DT)


@router.post("/omokwithfriend/api/curling/rooms", status_code=201)
async def create_curling_room() -> dict:
    room = await curling_room_manager.create()
    return {"roomCode": room.room_code, "gameType": "curling"}


@router.get("/omokwithfriend/api/curling/rooms/{room_code}")
async def curling_room_status(room_code: str) -> dict:
    room = curling_room_manager.get(room_code)
    return {
        "roomCode": room.room_code,
        "gameType": "curling",
        "available": len(room.players) < 2,
    }


@router.websocket("/omokwithfriend/ws/curling/rooms/{room_code}")
async def curling_room_socket(websocket: WebSocket, room_code: str) -> None:
    await websocket.accept()
    token = None
    room = None
    try:
        room = curling_room_manager.get(room_code)
        first = await websocket.receive_json()
        if not isinstance(first, dict) or first.get("type") != "join":
            raise GameError("join_required", "먼저 컬링 방에 입장해 주세요.")

        nickname = str(first.get("nickname", "")).strip()[:12]
        character = str(first.get("character", ""))
        if not nickname:
            raise GameError("invalid_nickname", "닉네임을 입력해 주세요.")

        player = room.join(nickname, character, first.get("token"))
        token = player.token
        reconnected = bool(first.get("token") and first.get("token") == token)
        await curling_room_manager.connections.connect(room.room_code, token, websocket)
        await curling_room_manager.connections.send(
            websocket,
            {
                "type": "joined",
                "token": token,
                "playerId": player.public_id,
                "reconnected": reconnected,
            },
        )
        overdue_reconnect_events = room.expire_reconnects()
        await broadcast_state(room)
        for reconnect_event in overdue_reconnect_events:
            await curling_room_manager.connections.broadcast(room.room_code, reconnect_event)
        schedule_turn_timeout(room)
        schedule_reconnect_timeouts(room)

        while True:
            raw = await websocket.receive_json()
            try:
                if not isinstance(raw, dict):
                    raise GameError("invalid_message", "요청을 다시 확인해 주세요.")

                kind = raw.get("type")
                if kind == "shoot":
                    started = room.begin_live_shot(
                        token,
                        float(raw["angle"]),
                        float(raw["power"]),
                        str(raw.get("curl", "straight")),
                    )
                    await curling_room_manager.connections.broadcast(
                        room.room_code,
                        {"type": "shot_started", "shot": started},
                    )
                    await broadcast_state(room)
                    asyncio.create_task(resolve_live_shot(room.room_code, room.game_number, started["id"]))
                    continue

                if kind in {"sweep_start", "sweep_stop"}:
                    sweep = room.set_sweeping(token, kind == "sweep_start")
                    await curling_room_manager.connections.broadcast(
                        room.room_code,
                        {"type": "sweep_state", **sweep},
                    )
                    continue

                if kind == "rematch_request":
                    room.request_rematch(token)
                    await broadcast_state(room)
                    schedule_turn_timeout(room)
                    schedule_reconnect_timeouts(room)
                    continue

                if kind == "ping":
                    await curling_room_manager.connections.send(websocket, {"type": "pong"})
                    continue

                if kind == "leave":
                    forfeit_event = room.leave(token)
                    room.disconnect(token)
                    await broadcast_state(room)
                    if forfeit_event:
                        await curling_room_manager.connections.broadcast(room.room_code, forfeit_event)
                    await websocket.close(code=1000)
                    return

                raise GameError("invalid_message", "알 수 없는 컬링 요청이에요.")

            except (GameError, KeyError, TypeError, ValueError) as exc:
                code, detail = (
                    (exc.code, exc.message)
                    if isinstance(exc, GameError)
                    else ("invalid_message", "요청을 다시 확인해 주세요.")
                )
                await curling_room_manager.connections.send(
                    websocket,
                    {"type": "error", "code": code, "message": detail},
                )

    except WebSocketDisconnect:
        pass
    except (GameError, TypeError, ValueError) as exc:
        code, detail = (
            (exc.code, exc.message)
            if isinstance(exc, GameError)
            else ("invalid_message", "입장 정보를 다시 확인해 주세요.")
        )
        try:
            await websocket.send_json({"type": "error", "code": code, "message": detail})
            await websocket.close(code=4000)
        except Exception:
            pass
    finally:
        if token and room:
            current = curling_room_manager.connections.disconnect(room.room_code, token, websocket)
            if current:
                room.disconnect(token)
                await broadcast_state(room)
                schedule_reconnect_timeouts(room)
