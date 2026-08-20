from fastapi.testclient import TestClient

from app.main import app
from app.rooms import room_manager


client = TestClient(app)


def setup_function():
    room_manager.rooms.clear()
    room_manager.connections.connections.clear()


def test_create_room_and_two_player_websocket_game():
    response = client.post("/omok/api/rooms")
    assert response.status_code == 201
    code = response.json()["roomCode"]

    with client.websocket_connect(f"/omok/ws/rooms/{code}") as first:
        first.send_json({"type": "join", "nickname": "A", "character": "chiikawa"})
        joined_a = first.receive_json()
        assert joined_a["type"] == "joined"
        waiting = first.receive_json()
        assert waiting["state"]["status"] == "waiting"

        with client.websocket_connect(f"/omok/ws/rooms/{code}") as second:
            second.send_json({"type": "join", "nickname": "B", "character": "usagi"})
            joined_b = second.receive_json()
            assert joined_b["type"] == "joined"
            state_a = first.receive_json()
            state_b = second.receive_json()
            assert state_a["state"]["status"] == "playing"
            assert state_b["state"]["status"] == "playing"

            first.send_json({"type": "move", "row": 7, "col": 7})
            moved_a = first.receive_json()
            moved_b = second.receive_json()
            assert moved_a["state"]["board"][7][7] == "black"
            assert moved_b["state"]["turn"] == "white"

