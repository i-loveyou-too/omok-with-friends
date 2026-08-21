from fastapi.testclient import TestClient

from app.main import app
from app.secret_rooms import secret_card_room_manager


client = TestClient(app)
BASE = "/omokwithfriend"


def setup_function():
    secret_card_room_manager.rooms.clear()
    secret_card_room_manager.connections.connections.clear()


def test_secret_card_websocket_hides_own_card_and_syncs_actions():
    response = client.post(f"{BASE}/api/secret-card/rooms")
    assert response.status_code == 201
    code = response.json()["roomCode"]

    with client.websocket_connect(f"{BASE}/ws/secret-card/rooms/{code}") as first:
        first.send_json({"type": "join", "nickname": "A", "character": "chiikawa"})
        joined_first = first.receive_json()
        assert joined_first["type"] == "joined"
        assert first.receive_json()["state"]["status"] == "waiting"

        with client.websocket_connect(f"{BASE}/ws/secret-card/rooms/{code}") as second:
            second.send_json({"type": "join", "nickname": "B", "character": "usagi"})
            joined_second = second.receive_json()
            first_state = first.receive_json()["state"]
            second_state = second.receive_json()["state"]
            assert first_state["cards"]["self"] is None
            assert second_state["cards"]["self"] is None
            assert first_state["cards"]["opponent"] is not None
            assert second_state["cards"]["opponent"] is not None
            assert first_state["cards"]["opponent"] != second_state["cards"]["opponent"]

            first.send_json({"type": "card_action", "action": "check"})
            assert first.receive_json()["state"]["turnPlayerId"] == joined_second["playerId"]
            assert second.receive_json()["type"] == "game_state"
            assert first.receive_json()["type"] == "card_action_confirmed"
            assert second.receive_json()["type"] == "card_action_confirmed"

            second.send_json({"type": "card_action", "action": "check"})
            revealed_first = first.receive_json()["state"]
            revealed_second = second.receive_json()["state"]
            assert revealed_first["revealed"] is True
            assert revealed_second["cards"]["self"] is not None
            assert first.receive_json()["type"] == "card_action_confirmed"
            assert second.receive_json()["type"] == "card_action_confirmed"
            assert joined_first["playerId"] != joined_second["playerId"]


def test_secret_card_websocket_skill_action_round_trips_through_snapshot():
    response = client.post(f"{BASE}/api/secret-card/rooms")
    code = response.json()["roomCode"]

    with client.websocket_connect(f"{BASE}/ws/secret-card/rooms/{code}") as first:
        first.send_json({"type": "join", "nickname": "A", "character": "chiikawa"})
        first.receive_json()
        first.receive_json()

        with client.websocket_connect(f"{BASE}/ws/secret-card/rooms/{code}") as second:
            second.send_json({"type": "join", "nickname": "B", "character": "hachiware"})
            second.receive_json()
            first.receive_json()
            second.receive_json()

            first.send_json({"type": "skill_action", "skill": "hint"})
            first_state = first.receive_json()["state"]
            second.receive_json()
            assert first_state["skills"]["hintBand"] in {"low", "mid", "high"}
            assert first.receive_json()["type"] == "skill_used"
            assert second.receive_json()["type"] == "skill_used"


def test_missing_secret_card_room_returns_not_found():
    response = client.get(f"{BASE}/api/secret-card/rooms/NOPE0")
    assert response.status_code == 404
    assert response.json()["code"] == "room_not_found"
