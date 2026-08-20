import pytest

from app.game import GameError, GameState
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

