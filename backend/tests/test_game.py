import pytest

from app.game import TURN_DURATION_SECONDS, GameError, GameState, Move
from app.renju import BLACK, CENTER, WHITE


def room_with_players():
    room = GameState("ABCDE")
    first = room.join("첫째", "chiikawa")
    second = room.join("둘째", "hachiware")
    return room, first, second


def assert_error(code, action):
    with pytest.raises(GameError) as exc:
        action()
    assert exc.value.code == code


def test_first_move_must_be_center():
    room, first, _ = room_with_players()
    assert_error("first_move_center", lambda: room.make_move(first.token, 0, 0))
    room.make_move(first.token, CENTER, CENTER)
    assert room.board[CENTER][CENTER] == BLACK


def test_occupied_cell_and_wrong_turn():
    room, first, second = room_with_players()
    room.make_move(first.token, CENTER, CENTER)
    assert_error("wrong_turn", lambda: room.make_move(first.token, 7, 8))
    assert_error("occupied", lambda: room.make_move(second.token, CENTER, CENTER))


def test_no_move_after_game_finished():
    room, first, second = room_with_players()
    room.status = "finished"
    assert_error("game_not_playing", lambda: room.make_move(first.token, CENTER, CENTER))
    assert_error("game_not_playing", lambda: room.make_move(second.token, CENTER, CENTER))


def test_undo_removes_only_last_move_and_restores_turn():
    room, first, second = room_with_players()
    room.make_move(first.token, CENTER, CENTER)
    room.make_move(second.token, CENTER, CENTER + 1)
    room.request_undo(first.token)
    room.respond_undo(second.token, True)
    assert room.board[CENTER][CENTER] == BLACK
    assert room.board[CENTER][CENTER + 1] is None
    assert room.turn == WHITE
    assert len(room.moves) == 1


def test_rematch_swaps_colors_and_keeps_score():
    room, first, second = room_with_players()
    room.resign(second.token)
    assert room.scores[first.token] == 1
    assert room.request_rematch(first.token) is False
    assert room.request_rematch(second.token) is True
    assert room.game_number == 2
    assert first.color == WHITE
    assert second.color == BLACK
    assert room.scores[first.token] == 1
    assert room.board[CENTER][CENTER] is None


def test_resign_counts_as_opponent_win():
    room, first, second = room_with_players()
    room.resign(first.token)
    assert room.winner_token == second.token
    assert room.scores[second.token] == 1


def test_turn_deadline_is_server_based_and_expires_after_sixty_seconds():
    room, first, _ = room_with_players()
    snapshot = room.snapshot()
    assert snapshot["turnDurationSeconds"] == TURN_DURATION_SECONDS == 60
    assert snapshot["turnDeadline"] - snapshot["turnStartedAt"] == 60_000

    deadline = room.turn_deadline
    assert deadline is not None
    assert room.expire_turn(deadline - 1) is None
    event = room.expire_turn(deadline)
    assert event is not None
    assert event["playerId"] == first.public_id
    assert room.turn == WHITE
    assert room.turn_deadline == deadline + 60_000


def test_move_and_reaction_events_have_unique_server_ids():
    room, first, second = room_with_players()
    move = room.make_move(first.token, CENTER, CENTER)
    assert move["eventId"]
    assert move["playerId"] == first.public_id

    first.last_reaction_at = -1
    reaction_a = room.reaction(first.token, "하품~")
    second.last_reaction_at = -1
    reaction_b = room.reaction(second.token, "빨리하세욧!")
    assert reaction_a["id"] != reaction_b["id"]
    assert reaction_a["expiresAt"] > reaction_a["createdAt"]


def test_server_rejects_white_forbidden_move():
    room, first, second = room_with_players()
    room.board[CENTER][CENTER] = BLACK
    room.moves.append(Move(CENTER, CENTER, BLACK, first.token))
    room.turn = WHITE
    room.board[6][5] = WHITE
    room.board[6][7] = WHITE
    room.board[5][6] = WHITE
    room.board[7][6] = WHITE

    assert_error("forbidden", lambda: room.make_move(second.token, 6, 6))
    assert room.board[6][6] is None


def test_snapshot_lists_forbidden_points_for_white_turn():
    room, first, _ = room_with_players()
    room.board[CENTER][CENTER] = BLACK
    room.moves.append(Move(CENTER, CENTER, BLACK, first.token))
    room.turn = WHITE
    room.board[6][5] = WHITE
    room.board[6][7] = WHITE
    room.board[5][6] = WHITE
    room.board[7][6] = WHITE

    assert {"row": 6, "col": 6, "reason": "double_three"} in room.snapshot()["forbidden"]


def test_undo_result_has_request_and_event_ids_and_restarts_timer():
    room, first, second = room_with_players()
    room.make_move(first.token, CENTER, CENTER)
    request = room.request_undo(first.token)
    old_deadline = room.turn_deadline
    result = room.respond_undo(second.token, True)
    assert result["eventId"]
    assert result["requestId"] == request["requestId"]
    assert result["requesterId"] == first.public_id
    assert result["responderId"] == second.public_id
    assert result["accepted"] is True
    assert room.board[CENTER][CENTER] is None
    assert room.turn == BLACK
    assert room.turn_deadline is not None
    assert room.turn_deadline >= old_deadline
