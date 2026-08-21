import pytest

from app.game import GameError
from app.secret_card import (
    ANTE,
    GAME_RESULT_DURATION_MS,
    MAX_ROUNDS,
    RECONNECT_GRACE_SECONDS,
    ROUND_RESULT_DURATION_MS,
    STARTING_CHIPS,
    TARGET_WINS,
    SecretCardState,
)


def room_with_players():
    room = SecretCardState("CARDS")
    first = room.join("첫째", "chiikawa")
    second = room.join("둘째", "hachiware")
    return room, first, second


def assert_error(code, action):
    with pytest.raises(GameError) as exc:
        action()
    assert exc.value.code == code


def check_showdown(room, first, second, first_card=10, second_card=1):
    room.cards = {first.token: first_card, second.token: second_card}
    starter = room.turn_token
    other = second.token if starter == first.token else first.token
    room.act(starter, "check")
    room.act(other, "check")


def advance_result(room):
    deadline = room.transition_deadline
    assert deadline is not None
    assert room.advance(deadline - 1) is None
    return room.advance(deadline)


def win_game(room, first, second):
    for round_index in range(1, MAX_ROUNDS + 1):
        check_showdown(room, first, second)
        if round_index < MAX_ROUNDS:
            assert room.status == "round_finished"
            advance_result(room)


def test_two_players_start_first_game_with_private_unique_cards_and_ante():
    room, first, second = room_with_players()
    assert room.status == "playing"
    assert room.game_number == room.round_number == 1
    assert len(set(room.cards.values())) == 2
    assert set(room.cards.values()).issubset(set(range(1, 11)))
    assert room.pot == ANTE * 2
    assert first.chips == second.chips == STARTING_CHIPS - ANTE
    assert room.snapshot(first.token)["cards"] == {"self": None, "opponent": room.cards[second.token]}
    assert room.snapshot(second.token)["cards"] == {"self": None, "opponent": room.cards[first.token]}


def test_check_check_reveals_cards_then_automatically_starts_next_round():
    room, first, second = room_with_players()
    check_showdown(room, first, second, 9, 2)
    assert room.status == "round_finished"
    assert room.revealed is True
    assert room.round_winner_token == first.token
    assert first.round_wins == 1
    assert first.games_won == 0
    assert room.transition_deadline is not None
    assert room.transition_deadline - room.snapshot(first.token)["serverNow"] <= ROUND_RESULT_DURATION_MS
    event = advance_result(room)
    assert event["previousStatus"] == "round_finished"
    assert room.status == "playing"
    assert room.round_number == 2
    assert room.revealed is False


def test_timeout_auto_checks_when_nothing_is_owed_and_never_loses_round_directly():
    room, first, second = room_with_players()
    event = room.expire_turn(room.turn_deadline)
    assert event["action"] == "check"
    assert room.status == "playing"
    assert room.round_winner_token is None
    assert room.last_action["automatic"] is True
    assert room.turn_token == second.token

    event = room.expire_turn(room.turn_deadline)
    assert event["action"] == "check"
    assert room.status == "round_finished"
    assert room.revealed is True


def test_timeout_auto_folds_only_when_bet_response_is_required():
    room, first, second = room_with_players()
    room.act(first.token, "raise", 10)
    event = room.expire_turn(room.turn_deadline)
    assert event["action"] == "fold"
    assert room.status == "round_finished"
    assert room.round_winner_token == first.token
    assert room.last_action == {
        "playerId": second.public_id,
        "action": "fold",
        "amount": ANTE * 2 + 10,
        "automatic": True,
    }
    assert second.folds == 0


def test_raise_call_and_manual_fold_statistics():
    room, first, second = room_with_players()
    assert_error("wrong_turn", lambda: room.act(second.token, "check"))
    room.act(first.token, "raise", 50)
    assert_error("check_unavailable", lambda: room.act(second.token, "check"))
    room.act(second.token, "call")
    assert room.status == "round_finished"
    assert room.pot == ANTE * 2 + 100
    assert first.raises == 1

    advance_result(room)
    actor = room.turn_token
    room.act(actor, "fold")
    assert room.players[actor].folds == 1
    assert room.revealed is True


def test_each_game_uses_cards_one_to_ten_once_and_resets_chips_after_three_second_result():
    room, first, second = room_with_players()
    dealt = []
    for round_index in range(1, MAX_ROUNDS + 1):
        dealt.extend(room.cards.values())
        check_showdown(room, first, second)
        if round_index < MAX_ROUNDS:
            advance_result(room)
    assert sorted(dealt) == list(range(1, 11))
    assert room.status == "game_finished"
    assert room.game_winner_token == first.token
    assert first.games_won == 1
    deadline = room.transition_deadline
    assert deadline is not None
    assert deadline - room.snapshot(first.token)["serverNow"] <= GAME_RESULT_DURATION_MS
    advance_result(room)
    assert room.status == "playing"
    assert room.game_number == 2
    assert room.round_number == 1
    assert first.games_won == 1
    assert first.chips == second.chips == STARTING_CHIPS - ANTE


def test_three_game_wins_finish_match_and_rematch_still_requires_both_players():
    room, first, second = room_with_players()
    for game_index in range(1, TARGET_WINS + 1):
        win_game(room, first, second)
        if game_index < TARGET_WINS:
            assert room.status == "game_finished"
            advance_result(room)
    assert room.status == "finished"
    assert room.match_winner_token == first.token
    assert first.games_won == TARGET_WINS
    assert room.transition_deadline is None
    assert room.request_rematch(first.token) is False
    assert room.status == "finished"
    assert room.request_rematch(second.token) is True
    assert room.status == "playing"
    assert room.match_number == 2
    assert room.game_number == room.round_number == 1
    assert first.games_won == second.games_won == 0


def test_reconnect_timeout_loses_current_game_without_finishing_match():
    room, first, second = room_with_players()
    room.disconnect(second.token)
    deadline = room.reconnect_deadlines[second.token]
    assert deadline - room.snapshot(first.token)["serverNow"] <= RECONNECT_GRACE_SECONDS * 1000
    events = room.expire_reconnects(deadline)
    assert events[0]["action"] == "fold"
    assert room.status == "game_finished"
    assert room.round_winner_token == first.token
    assert room.game_winner_token == first.token
    assert first.games_won == 1
    assert room.match_winner_token is None


def test_all_in_resolves_at_showdown_and_next_round_is_automatic():
    room, first, second = room_with_players()
    room.act(first.token, "all_in")
    room.act(second.token, "call")
    assert room.status == "game_finished"
    assert room.pot == STARTING_CHIPS * 2
    assert first.all_ins == 1
    assert_error("auto_progress", lambda: room.request_next_round(first.token))
