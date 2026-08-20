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
            confirmed_a = first.receive_json()
            confirmed_b = second.receive_json()
            assert confirmed_a["type"] == confirmed_b["type"] == "move_confirmed"
            assert confirmed_a["eventId"] == confirmed_b["eventId"]
            assert confirmed_a["row"] == confirmed_a["col"] == 7

            first.send_json({"type": "reaction", "value": "하품~"})
            reaction_a = first.receive_json()
            reaction_b = second.receive_json()
            assert reaction_a["type"] == reaction_b["type"] == "reaction"
            assert reaction_a["id"] == reaction_b["id"]

            second.send_json({"type": "reaction", "value": "빨리하세욧!"})
            other_reaction_a = first.receive_json()
            other_reaction_b = second.receive_json()
            assert other_reaction_a["id"] == other_reaction_b["id"]
            assert other_reaction_a["id"] != reaction_a["id"]

            first.send_json({"type": "undo_request"})
            undo_state_a = first.receive_json()
            undo_state_b = second.receive_json()
            undo_request_a = first.receive_json()
            undo_request_b = second.receive_json()
            assert undo_state_a["state"]["undoRequestId"]
            assert undo_state_b["state"]["undoRequestedBy"] == joined_a["playerId"]
            assert undo_request_a["type"] == undo_request_b["type"] == "undo_requested"
            assert undo_request_a["requestId"] == undo_request_b["requestId"]

            second.send_json({"type": "undo_response", "accept": True})
            undone_a = first.receive_json()
            undone_b = second.receive_json()
            undo_result_a = first.receive_json()
            undo_result_b = second.receive_json()
            assert undone_a["state"]["board"][7][7] is None
            assert undone_b["state"]["turn"] == "black"
            assert undo_result_a["type"] == undo_result_b["type"] == "undo_result"
            assert undo_result_a["accepted"] is True
            assert undo_result_a["eventId"] == undo_result_b["eventId"]
