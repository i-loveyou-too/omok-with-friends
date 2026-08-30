import hashlib
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.find_match import DIFFICULTY_COUNTS, SYMBOL_IDS, FindMatchState
from app.find_match_rooms import find_match_room_manager
from app.main import app


client = TestClient(app)
BASE = "/omokwithfriend"
ASSET_DIR = Path(__file__).parents[2] / "frontend" / "public" / "assets" / "find-match"


def setup_function():
    find_match_room_manager.rooms.clear()
    find_match_room_manager.connections.connections.clear()


def join_two(room: FindMatchState):
    first = room.join("A", "chiikawa")
    second = room.join("B", "hachiware")
    return first, second


def reveal(room: FindMatchState, first, second):
    round_id = room.current_round.round_id
    room.ready_round(first.token, round_id)
    room.ready_round(second.token, round_id)
    room.current_round.revealed_at = int(time.time() * 1000) - 1


def test_every_server_symbol_has_an_approved_asset():
    for symbol_id in SYMBOL_IDS:
        folder = "characters" if symbol_id.startswith(("chiikawa_", "hachiware_", "usagi_", "momonga_")) else "symbols"
        assert (ASSET_DIR / folder / f"{symbol_id}.png").is_file(), symbol_id


def test_card_intersection_is_exactly_one_for_all_difficulties():
    for difficulty, count in DIFFICULTY_COUNTS.items():
        for _ in range(100):
            room = FindMatchState("ABCDE", difficulty=difficulty, win_target=10)
            join_two(room)
            current = room.current_round
            assert len(current.left) == count
            assert len(current.right) == count
            assert set(current.left) & set(current.right) == {current.answer}
            left_hashes = {_asset_hash(symbol_id) for symbol_id in current.left}
            right_hashes = {_asset_hash(symbol_id) for symbol_id in current.right}
            assert left_hashes & right_hashes == {_asset_hash(current.answer)}


def _asset_hash(symbol_id: str) -> str:
    folder = "characters" if symbol_id.startswith(("chiikawa_", "hachiware_", "usagi_", "momonga_")) else "symbols"
    return hashlib.sha256((ASSET_DIR / folder / f"{symbol_id}.png").read_bytes()).hexdigest()


def test_wrong_guess_is_server_locked_and_does_not_change_score():
    room = FindMatchState("ABCDE")
    first, second = join_two(room)
    reveal(room, first, second)
    current = room.current_round
    wrong = next(symbol for symbol in current.left if symbol != current.answer)
    event = room.guess(first.token, wrong, current.round_id)
    assert event["correct"] is False
    assert event["playerId"] == first.public_id
    assert event["lockMs"] == 1200
    assert room.scores[first.token] == 0

    try:
        room.guess(first.token, current.answer, current.round_id)
    except Exception as exc:
        assert getattr(exc, "code", None) == "guess_locked"
    else:
        raise AssertionError("the server accepted a guess during the penalty lock")


def test_stale_round_messages_are_rejected():
    room = FindMatchState("ABCDE")
    first, second = join_two(room)
    reveal(room, first, second)
    old_round = room.current_round
    room.guess(first.token, old_round.answer, old_round.round_id)
    room.next_round_at = int(time.time() * 1000) - 1
    assert room.advance() is True

    for action in (
        lambda: room.ready_round(first.token, old_round.round_id),
        lambda: room.guess(first.token, old_round.answer, old_round.round_id),
    ):
        try:
            action()
        except Exception as exc:
            assert getattr(exc, "code", None) == "stale_round"
        else:
            raise AssertionError("a stale round message was accepted")


def test_traps_start_at_40_percent_and_get_harder_after_70_percent(monkeypatch):
    room = FindMatchState("ABCDE", win_target=10)
    first, _ = join_two(room)
    room.scores[first.token] = 3
    assert room._trap_count() == 0
    monkeypatch.setattr("app.find_match.random.randint", lambda _a, b: b)
    room.scores[first.token] = 4
    assert room._trap_count() == 2
    room.scores[first.token] = 7
    assert room._trap_count() == 3


def test_rematch_requires_both_players():
    room = FindMatchState("ABCDE", win_target=7)
    first, second = join_two(room)
    room.status = "finished"
    room.winner_token = first.token
    assert room.request_rematch(first.token) is False
    assert room.request_rematch(second.token) is True
    assert room.status == "playing"
    assert room.scores[first.token] == room.scores[second.token] == 0


def test_find_match_api_websocket_game_reconnect_and_rematch():
    response = client.post(f"{BASE}/api/find-match/rooms?difficulty=easy&win_target=7")
    assert response.status_code == 201
    assert response.json()["gameType"] == "find_match"
    code = response.json()["roomCode"]

    with client.websocket_connect(f"{BASE}/ws/find-match/rooms/{code}") as first:
        first.send_json({"type": "join", "nickname": "A", "character": "chiikawa"})
        joined_first = first.receive_json()
        assert joined_first["type"] == "joined"
        assert first.receive_json()["state"]["status"] == "waiting"

        with client.websocket_connect(f"{BASE}/ws/find-match/rooms/{code}") as second:
            second.send_json({"type": "join", "nickname": "B", "character": "usagi"})
            joined_second = second.receive_json()
            first_state = first.receive_json()["state"]
            second_state = second.receive_json()["state"]
            assert first_state["status"] == second_state["status"] == "playing"
            assert first_state["symbolCount"] == 8
            assert first_state["round"]["left"]

            round_id = first_state["round"]["roundId"]
            first.send_json({"type": "round_ready", "roundId": round_id})
            assert first.receive_json()["type"] == "game_state"
            assert second.receive_json()["type"] == "game_state"
            second.send_json({"type": "round_ready", "roundId": round_id})
            revealed_first = first.receive_json()["state"]
            revealed_second = second.receive_json()["state"]
            assert revealed_first["round"]["revealedAt"] is not None
            assert revealed_second["round"]["revealedAt"] == revealed_first["round"]["revealedAt"]

            room = find_match_room_manager.get(code)
            room.scores[joined_first["token"]] = 6
            answer = room.current_round.answer
            room.current_round.revealed_at = int(time.time() * 1000) - 1
            first.send_json({"type": "guess", "roundId": round_id, "symbolId": answer})
            first_result = first.receive_json()
            second_result = second.receive_json()
            assert first_result["type"] == second_result["type"] == "guess_result"
            assert first_result["finished"] is True
            assert first.receive_json()["state"]["status"] == "finished"
            assert second.receive_json()["state"]["winnerId"] == joined_first["playerId"]

            first.send_json({"type": "rematch_request"})
            first_waiting = first.receive_json()["state"]
            second_waiting = second.receive_json()["state"]
            assert joined_first["playerId"] in first_waiting["rematchReadyIds"]
            assert second_waiting["status"] == "finished"
            second.send_json({"type": "rematch_request"})
            assert first.receive_json()["state"]["status"] == "playing"
            assert second.receive_json()["state"]["roundNumber"] == 1

    with client.websocket_connect(f"{BASE}/ws/find-match/rooms/{code}") as reconnected:
        reconnected.send_json({
            "type": "join",
            "nickname": "A",
            "character": "chiikawa",
            "token": joined_first["token"],
        })
        joined_again = reconnected.receive_json()
        assert joined_again["type"] == "joined"
        assert joined_again["reconnected"] is True
        assert joined_again["playerId"] == joined_first["playerId"]
        assert reconnected.receive_json()["state"]["status"] == "playing"


def test_find_match_api_validates_settings_and_missing_room():
    assert client.post(f"{BASE}/api/find-match/rooms?difficulty=impossible").status_code == 400
    assert client.post(f"{BASE}/api/find-match/rooms?win_target=9").status_code == 400
    missing = client.get(f"{BASE}/api/find-match/rooms/NOPE0")
    assert missing.status_code == 404
    assert missing.json()["code"] == "room_not_found"
