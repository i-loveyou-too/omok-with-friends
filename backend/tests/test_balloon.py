import json

import pytest
from fastapi.testclient import TestClient

from app.balloon import BURST_MAX, BURST_MIN, TARGET_SCORE, TURN_MS, BalloonState, choose_burst_at, epoch_ms
from app.balloon_rooms import balloon_room_manager
from app.game import GameError
from app.main import app


client = TestClient(app)
BASE = "/omokwithfriend"


def setup_function() -> None:
    balloon_room_manager.rooms.clear()
    balloon_room_manager.connections.connections.clear()


def make_room() -> tuple[BalloonState, str, str]:
    room = BalloonState("ABCDE")
    first = room.join("첫째", "chiikawa")
    second = room.join("둘째", "hachiware")
    return room, first.token, second.token


def current_token(room: BalloonState) -> str:
    assert room.current_turn is not None
    return room.current_turn.player_token


def other_token(room: BalloonState) -> str:
    current = current_token(room)
    return next(token for token in room.player_order if token != current)


def assert_game_error(code: str, action) -> None:
    with pytest.raises(GameError) as exc:
        action()
    assert exc.value.code == code


def test_burst_range_is_30_to_60_and_secret_from_snapshot() -> None:
    values = [choose_burst_at() for _ in range(1_000)]
    assert min(values) >= BURST_MIN
    assert max(values) <= BURST_MAX

    room, _, _ = make_room()
    snapshot_json = json.dumps(room.snapshot())
    assert "burst" not in snapshot_json.lower()


def test_first_29_pumps_are_safe_and_exact_burst_pops() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    old_balloon_id = room.current_balloon.balloon_id
    room.current_balloon.burst_at = 30
    token = current_token(room)
    turn_id = room.current_turn.turn_id

    for expected in range(1, 30):
        event = room.pump(token, turn_id)
        assert event["popped"] is False
        assert event["pumpCount"] == expected

    event = room.pump(token, turn_id)
    assert event["popped"] is True
    assert event["pumpCount"] == 30
    assert room.scores[token] == 0
    assert room.last_outcome and room.last_outcome["kind"] == "pop"
    assert room.current_balloon.balloon_id != old_balloon_id
    assert room.current_balloon.pump_count == 0


def test_bank_saves_points_and_late_actions_are_rejected() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    room.current_balloon.burst_at = 60
    token = current_token(room)
    turn_id = room.current_turn.turn_id
    for _ in range(17):
        room.pump(token, turn_id)

    room.bank(token, turn_id)
    assert room.scores[token] == 17
    assert room.last_outcome and room.last_outcome["points"] == 17
    assert room.current_balloon.pump_count == 17
    assert_game_error("turn_closed", lambda: room.pump(token, turn_id))
    assert_game_error("turn_closed", lambda: room.bank(token, turn_id))


def test_bank_keeps_balloon_and_opponent_continues_until_it_pops() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    first_turn_token = current_token(room)
    first_turn_id = room.current_turn.turn_id
    balloon_id = room.current_balloon.balloon_id
    room.current_balloon.burst_at = 36

    for _ in range(34):
        room.pump(first_turn_token, first_turn_id)
    original_burst_at = room.current_balloon.burst_at
    room.bank(first_turn_token, first_turn_id)
    assert room.scores[first_turn_token] == 34
    assert room.current_balloon.balloon_id == balloon_id
    assert room.current_balloon.pump_count == 34
    assert room.current_balloon.burst_at == original_burst_at

    room.next_turn_at = epoch_ms() - 1
    assert room.advance() is True
    assert room.current_turn is not None
    second_turn_token = current_token(room)
    second_turn_id = room.current_turn.turn_id
    assert second_turn_token != first_turn_token
    assert second_turn_id != first_turn_id
    assert room.snapshot()["balloon"] == {"balloonId": balloon_id, "pumpCount": 34}

    safe = room.pump(second_turn_token, second_turn_id)
    assert safe["popped"] is False
    assert safe["pumpCount"] == 35
    popped = room.pump(second_turn_token, second_turn_id)
    assert popped["popped"] is True
    assert popped["pumpCount"] == 36
    assert popped["turnScore"] == 2
    assert room.scores[first_turn_token] == 34
    assert room.scores[second_turn_token] == 0
    assert room.current_balloon.balloon_id != balloon_id
    assert room.current_balloon.pump_count == 0


def test_late_pump_after_pop_is_rejected_without_changing_total() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    token = current_token(room)
    room.scores[token] = 23
    room.current_balloon.burst_at = 30
    turn_id = room.current_turn.turn_id
    for _ in range(30):
        room.pump(token, turn_id)

    assert room.scores[token] == 23
    assert_game_error("turn_closed", lambda: room.pump(token, turn_id))
    assert room.scores[token] == 23


def test_opponent_actions_are_rejected() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None
    opponent = other_token(room)
    turn_id = room.current_turn.turn_id
    assert_game_error("not_your_turn", lambda: room.pump(opponent, turn_id))
    assert_game_error("not_your_turn", lambda: room.bank(opponent, turn_id))


def test_stale_turn_id_is_rejected_before_and_after_advance() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    token = current_token(room)
    old_id = room.current_turn.turn_id
    assert_game_error("stale_turn", lambda: room.pump(token, "old-turn"))

    room.current_balloon.burst_at = 60
    room.pump(token, old_id)
    room.bank(token, old_id)
    room.next_turn_at = epoch_ms() - 1
    assert room.advance() is True
    assert_game_error("stale_turn", lambda: room.pump(current_token(room), old_id))


def test_twelve_second_timeout_auto_banks() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    token = current_token(room)
    turn_id = room.current_turn.turn_id
    assert room.current_turn.deadline_at is not None
    assert TURN_MS - 50 <= room.current_turn.deadline_at - epoch_ms() <= TURN_MS
    room.current_balloon.burst_at = 60
    for _ in range(9):
        room.pump(token, turn_id)

    room.current_turn.deadline_at = epoch_ms() - 1
    event = room.expire_turn()
    assert event and event["kind"] == "timeout"
    assert event["points"] == 9
    assert room.scores[token] == 9
    assert room.current_balloon.pump_count == 9


def test_reaching_100_finishes_game() -> None:
    room, _, _ = make_room()
    assert room.current_turn is not None and room.current_balloon is not None
    token = current_token(room)
    room.scores[token] = TARGET_SCORE - 1
    room.current_balloon.burst_at = 60
    turn_id = room.current_turn.turn_id
    room.pump(token, turn_id)
    room.bank(token, turn_id)
    assert room.status == "finished"
    assert room.winner_token == token
    assert room.scores[token] == TARGET_SCORE


def test_rematch_requires_both_players_resets_and_alternates_first_turn() -> None:
    room, first, second = make_room()
    assert room.starting_index is not None and room.current_balloon is not None
    previous_start = room.starting_index
    previous_balloon_id = room.current_balloon.balloon_id
    room.status = "finished"
    room.winner_token = first
    room.scores[first] = 100
    room.scores[second] = 41

    assert room.request_rematch(first) is False
    assert room.status == "finished"
    assert room.request_rematch(second) is True
    assert room.status == "playing"
    assert room.starting_index == 1 - previous_start
    assert room.current_turn is not None
    assert room.current_turn.player_token == room.player_order[room.starting_index]
    assert room.turn_number == 1
    assert room.scores == {first: 0, second: 0}
    assert room.winner_token is None
    assert room.rematch_ready == set()
    assert room.current_balloon is not None
    assert room.current_balloon.balloon_id != previous_balloon_id
    assert room.current_balloon.pump_count == 0


def test_disconnect_pauses_and_reconnect_resumes_exact_remaining_time() -> None:
    room, first, _ = make_room()
    assert room.current_turn is not None
    room.current_turn.deadline_at = epoch_ms() + 7_000
    room.disconnect(first)
    saved_remaining = room.paused_remaining_ms
    assert 6_950 <= saved_remaining <= 7_000
    assert room.paused is True
    assert room.current_turn.deadline_at is None
    assert room.expire_turn() is None

    original = room.players[first]
    reconnected = room.join("무시되는 새 이름", "usagi", first)
    assert reconnected.public_id == original.public_id
    assert reconnected.nickname == "첫째"
    assert room.resume_if_possible() is True
    assert room.paused is False
    assert room.current_turn.deadline_at is not None
    resumed_remaining = room.current_turn.deadline_at - epoch_ms()
    assert saved_remaining - 10 <= resumed_remaining <= saved_remaining


def test_third_player_is_blocked_but_known_token_can_reconnect() -> None:
    room, first, _ = make_room()
    assert_game_error("room_full", lambda: room.join("셋째", "usagi"))
    room.disconnect(first)
    reconnected = room.join("첫째", "chiikawa", first)
    assert reconnected.token == first
    assert len(room.players) == 2


def test_balloon_rest_and_two_player_websocket_flow() -> None:
    response = client.post(f"{BASE}/api/balloon/rooms")
    assert response.status_code == 201
    assert response.json()["targetScore"] == TARGET_SCORE
    code = response.json()["roomCode"]
    assert len(code) == 5

    status = client.get(f"{BASE}/api/balloon/rooms/{code}")
    assert status.status_code == 200
    assert status.json()["gameType"] == "balloon"

    with client.websocket_connect(f"{BASE}/ws/balloon/rooms/{code}") as first:
        first.send_json({"type": "join", "nickname": "A", "character": "chiikawa"})
        joined_first = first.receive_json()
        assert joined_first["type"] == "joined"
        assert first.receive_json()["state"]["status"] == "waiting"

        with client.websocket_connect(f"{BASE}/ws/balloon/rooms/{code}") as second:
            second.send_json({"type": "join", "nickname": "B", "character": "usagi"})
            joined_second = second.receive_json()
            first_state = first.receive_json()["state"]
            second_state = second.receive_json()["state"]
            assert first_state["status"] == second_state["status"] == "playing"

            active_is_first = first_state["turn"]["playerId"] == joined_first["playerId"]
            active = first if active_is_first else second
            opponent = second if active_is_first else first
            turn_id = first_state["turn"]["turnId"]

            opponent.send_json({"type": "pump", "turnId": turn_id})
            assert opponent.receive_json()["code"] == "not_your_turn"
            active.send_json({"type": "ping"})
            assert active.receive_json()["type"] == "pong"
            active.send_json({"type": "pump", "turnId": turn_id})
            active_state = active.receive_json()["state"]
            opponent_state = opponent.receive_json()["state"]
            assert active_state["turn"]["turnScore"] == 1
            assert active_state["balloon"]["pumpCount"] == 1
            assert opponent_state["turn"]["turnScore"] == 1
            assert opponent_state["balloon"]["balloonId"] == active_state["balloon"]["balloonId"]

            with client.websocket_connect(f"{BASE}/ws/balloon/rooms/{code}") as third:
                third.send_json({"type": "join", "nickname": "C", "character": "hachiware"})
                assert third.receive_json()["code"] == "room_full"


def test_missing_room_returns_room_not_found() -> None:
    response = client.get(f"{BASE}/api/balloon/rooms/NOPE0")
    assert response.status_code == 404
    assert response.json()["code"] == "room_not_found"
