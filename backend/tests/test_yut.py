from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.game import GameError
from app.main import app
from app.yut import CARD_BY_ID, CARD_DEFINITIONS, CARD_TIER_WEIGHTS, MAX_CARD_CHAIN, ROUTES, YutRoom, yut_room_manager


client = TestClient(app)


def setup_function():
    yut_room_manager.rooms.clear()
    yut_room_manager.connections.connections.clear()


def room_with_players(mode="classic"):
    room = YutRoom("YUT42", mode)
    first = room.join("첫째", "chiikawa", None)
    second = room.join("둘째", "usagi", None)
    return room, first, second


def piece(room, player, piece_id=0):
    return next(item for item in room.pieces if item.owner_id == player.public_id and item.id == piece_id)


def finish_except(room, player, *piece_ids):
    for candidate in [item for item in room.pieces if item.owner_id == player.public_id]:
        if candidate.id not in piece_ids:
            candidate.finished = True
            candidate.index = len(ROUTES[candidate.route]) - 1


def test_room_starts_with_v2_turn_state_and_four_pieces_per_player():
    room, first, second = room_with_players()
    assert room.status == "playing"
    assert room.must_roll is True
    assert room.pending_rolls == []
    assert len([item for item in room.pieces if item.owner_id == first.public_id]) == 4
    assert len([item for item in room.pieces if item.owner_id == second.public_id]) == 4


def test_yut_and_mo_are_collected_before_strategic_move_order():
    room, first, _ = room_with_players()
    yut = room.roll(first.token, "yut")
    with pytest.raises(GameError, match="추가 윷") as exc:
        room.move(first.token, 0, yut["id"])
    assert exc.value.code == "roll_again_first"
    room.roll(first.token, "mo")
    gae = room.roll(first.token, "gae")
    assert [result["name"] for result in room.pending_rolls] == ["yut", "mo", "gae"]
    assert room.must_roll is False
    room.move(first.token, 0, gae["id"])
    assert piece(room, first).location == "O2"
    assert [result["name"] for result in room.pending_rolls] == ["yut", "mo"]
    assert room.current_token == first.token


def test_turn_advances_only_after_every_saved_result_is_consumed():
    room, first, second = room_with_players()
    yut = room.roll(first.token, "yut")
    gae = room.roll(first.token, "gae")
    room.move(first.token, 0, gae["id"])
    assert room.current_token == first.token
    room.move(first.token, 0, yut["id"])
    assert room.current_token == second.token
    assert room.must_roll is True


def test_start_backdo_consumes_only_selected_result():
    room, first, second = room_with_players()
    yut = room.roll(first.token, "yut")
    backdo = room.roll(first.token, "backdo")
    room.move(first.token, 0, backdo["id"])
    assert [result["id"] for result in room.pending_rolls] == [yut["id"]]
    assert room.current_token == first.token
    room.move(first.token, 0, yut["id"])
    assert room.current_token == second.token


def test_saved_result_moves_entire_stack_with_one_path():
    room, first, _ = room_with_players()
    leader = piece(room, first)
    mate = piece(room, first, 1)
    leader.index = mate.index = 3
    roll = room.roll(first.token, "gae")
    room.move(first.token, leader.id, roll["id"])
    assert leader.location == mate.location == "O5"
    assert leader.route == mate.route == "a"
    assert room.last_move["pieceIds"] == [0, 1]
    assert room.last_move["path"] == ["O4", "O5"]


def test_capture_waits_for_confirmation_then_grants_bonus_throw():
    room, first, second = room_with_players()
    mine = piece(room, first)
    theirs = piece(room, second)
    mine.index = 1
    theirs.index = 2
    roll = room.roll(first.token, "do")
    room.move(first.token, mine.id, roll["id"])
    assert room.pending_capture
    assert theirs.location == "O2"
    with pytest.raises(GameError) as exc:
        room.roll(first.token, "do")
    assert exc.value.code == "confirm_capture"
    room.confirm_capture(first.token)
    assert theirs.location == "S"
    assert room.must_roll is True
    assert room.last_event["type"] == "capture_confirmed"
    assert room.last_event["message"] == "잡았습니다!"


def test_shield_prevents_capture_once_without_resetting_piece():
    room, first, second = room_with_players()
    mine = piece(room, first)
    theirs = piece(room, second)
    mine.index = 1
    theirs.index = 2
    theirs.shielded = True
    roll = room.roll(first.token, "do")
    room.move(first.token, mine.id, roll["id"])
    assert room.pending_capture is None
    assert theirs.location == "O2"
    assert theirs.shielded is False


def test_keep_card_persists_in_authoritative_hand_snapshot_and_reconnect():
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 2
    room.must_roll = False
    assert room.force_card_draw_for_test(first.public_id, moving.id, "swap")
    instance_id = room.pending_card["instanceId"]
    room.card_choice(first.token, "keep")
    assert room.pending_card is None
    assert room.hands[first.public_id] == [{"instanceId": instance_id, "cardId": "swap"}]
    assert room.snapshot()["hands"][first.public_id][0]["instanceId"] == instance_id
    reconnected = room.join("첫째", "chiikawa", first.token)
    assert reconnected.public_id == first.public_id
    assert room.snapshot()["hands"][first.public_id][0]["cardId"] == "swap"


def test_danger_card_cannot_be_kept_and_forces_target_selection():
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 4
    room.must_roll = False
    room.pending_rolls = [{"id": 70, "name": "do", "steps": 1}]
    assert room.force_card_draw_for_test(first.public_id, moving.id, "minus_three")
    assert room.pending_card["forced"] is True
    with pytest.raises(GameError) as exc:
        room.card_choice(first.token, "keep")
    assert exc.value.code == "danger_card_forced"
    assert room.pending_card is not None
    room.card_choice(first.token, "use", moving.id)
    assert moving.location == "O1"
    assert room.pending_card is None
    assert room.last_event["forced"] is True
    assert room.hands[first.public_id] == []


def test_forced_split_requires_an_eligible_own_stack_and_cannot_cancel():
    room, first, _ = room_with_players("lucky")
    leader = piece(room, first)
    mate = piece(room, first, 1)
    leader.index = mate.index = 18
    room.must_roll = False
    room.pending_rolls = [{"id": 71, "name": "do", "steps": 1}]
    room.force_card_draw_for_test(first.public_id, leader.id, "forced_split")
    with pytest.raises(GameError) as exc:
        room.card_choice(first.token, "use", piece(room, first, 2).id)
    assert exc.value.code == "stack_required"
    assert room.pending_card is not None
    room.card_choice(first.token, "use", leader.id)
    assert {leader.location, mate.location} == {"O17", "O18"}
    assert room.pending_card is None


def test_forced_split_without_applicable_stack_is_safe_noop():
    room, first, second = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 18
    room.must_roll = False
    assert room.force_card_draw_for_test(first.public_id, moving.id, "forced_split")
    assert room.pending_card is None
    assert room.last_event["type"] == "card_used"
    assert room.last_event["noOp"] is True
    assert room.current_token == second.token


def test_minus_three_stale_draw_without_applicable_piece_cannot_block_game():
    room, first, second = room_with_players("lucky")
    stale_source = piece(room, second)
    stale_source.index = 18
    finish_except(room, first)
    room.must_roll = False
    assert room._maybe_draw_card(first.public_id, stale_source, forced_card_id="minus_three")
    assert room.pending_card is None
    assert room.status == "finished"


def test_chaos_swap_auto_applies_and_noops_when_board_has_too_few_pieces():
    room, first, second = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 18
    room.must_roll = False
    room.force_card_draw_for_test(first.public_id, moving.id, "chaos_swap")
    assert room.pending_card is None
    assert room.last_event["type"] == "card_used"
    assert room.last_event["forced"] is True
    assert room.last_event["noOp"] is True
    assert room.current_token == second.token


def test_chaos_swap_auto_applies_when_both_players_have_board_pieces():
    room, first, second = room_with_players("lucky")
    mine, theirs = piece(room, first), piece(room, second)
    mine.index = 18
    theirs.index = 6
    room.must_roll = False
    room.force_card_draw_for_test(first.public_id, mine.id, "chaos_swap")
    assert room.pending_card is None
    assert mine.location == "O6"
    assert theirs.location == "O18"
    assert room.last_move["reason"] == "card:chaos_swap"
    assert room.current_token == second.token


def test_client_action_ids_make_yut_bonus_roll_double_tap_idempotent():
    room, first, _ = room_with_players()
    assert room.accept_action(first.token, "roll-1") is True
    room.roll(first.token, "yut")
    assert room.accept_action(first.token, "roll-1") is False
    assert [result["name"] for result in room.pending_rolls] == ["yut"]
    assert room.accept_action(first.token, "roll-2") is True
    room.roll(first.token, "gae")
    assert [result["name"] for result in room.pending_rolls] == ["yut", "gae"]


def test_invalid_target_does_not_consume_drawn_or_kept_card():
    room, first, _ = room_with_players("lucky")
    room.must_roll = False
    moving = piece(room, first)
    moving.index = 2
    room.force_card_draw_for_test(first.public_id, moving.id, "swap")
    with pytest.raises(GameError):
        room.card_choice(first.token, "use", moving.id, None)
    assert room.pending_card is not None
    room.card_choice(first.token, "keep")
    instance_id = room.hands[first.public_id][0]["instanceId"]
    with pytest.raises(GameError):
        room.use_kept_card(first.token, instance_id, moving.id, None)
    assert room.hands[first.public_id][0]["instanceId"] == instance_id


def test_pending_card_blocks_roll_move_and_kept_card_use():
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 2
    room.must_roll = False
    room.pending_rolls = [{"id": 91, "name": "do", "steps": 1}]
    room.hands[first.public_id].append({"instanceId": "kept", "cardId": "nothing"})
    room.force_card_draw_for_test(first.public_id, moving.id, "nothing")
    for action in (
        lambda: room.roll(first.token, "do"),
        lambda: room.move(first.token, moving.id, 91),
        lambda: room.use_kept_card(first.token, "kept"),
    ):
        with pytest.raises(GameError) as exc:
            action()
        assert exc.value.code == "resolve_card"


def test_roll_id_can_only_be_consumed_once():
    room, first, _ = room_with_players()
    yut = room.roll(first.token, "yut")
    gae = room.roll(first.token, "gae")
    room.move(first.token, 0, gae["id"])
    with pytest.raises(GameError) as exc:
        room.move(first.token, 0, gae["id"])
    assert exc.value.code == "invalid_roll"
    assert [result["id"] for result in room.pending_rolls] == [yut["id"]]


def test_swap_kept_card_uses_explicit_own_and_opponent_targets():
    room, first, second = room_with_players("lucky")
    mine, theirs = piece(room, first), piece(room, second)
    mine.index = 3
    theirs.index = 8
    room.must_roll = False
    room.hands[first.public_id].append({"instanceId": "abc", "cardId": "swap"})
    room.use_kept_card(first.token, "abc", mine.id, theirs.id)
    assert mine.location == "O8"
    assert theirs.location == "O3"
    assert room.hands[first.public_id] == []
    assert room.last_move["reason"] == "card:swap"
    assert len(room.last_move["swap"]) == 2


@pytest.mark.parametrize(
    ("card_id", "expected_location", "grants_roll"),
    [
        ("plus_one", "O3", False),
        ("plus_two", "O4", False),
        ("minus_one", "O1", False),
        ("plus_four", "O6", False),
        ("teleport", "O6", False),
        ("golden_yut", "O3", True),
    ],
)
def test_explicit_movement_card_targets(card_id, expected_location, grants_roll):
    room, first, _ = room_with_players("classic")
    moving = piece(room, first)
    moving.index = 2
    room.must_roll = False
    room.hands[first.public_id].append({"instanceId": "card", "cardId": card_id})
    room.use_kept_card(first.token, "card", moving.id)
    assert moving.location == expected_location
    assert room.last_event["grantReroll"] is grants_roll
    assert (room.current_token == first.token) is grants_roll


def test_opponent_back_and_split_require_explicit_targets():
    room, first, second = room_with_players("lucky")
    target = piece(room, second)
    mate = piece(room, second, 1)
    target.index = mate.index = 6
    room.must_roll = False
    room.pending_rolls = [{"id": 999, "name": "do", "steps": 1}]
    room.hands[first.public_id].append({"instanceId": "back", "cardId": "opponent_back"})
    room.use_kept_card(first.token, "back", target_piece_id=target.id)
    assert target.location == mate.location == "O4"
    target.index = mate.index = 6
    room.hands[first.public_id].append({"instanceId": "split", "cardId": "split"})
    room.use_kept_card(first.token, "split", target_piece_id=target.id)
    assert {target.location, mate.location} == {"O5", "O6"}


def test_card_movement_uses_capture_confirmation_and_draws_next_card(monkeypatch):
    room, first, second = room_with_players("lucky")
    mine, theirs = piece(room, first), piece(room, second)
    mine.index = 1
    theirs.index = 2
    room.must_roll = False
    room.hands[first.public_id].append({"instanceId": "plus", "cardId": "plus_one"})
    monkeypatch.setattr(room, "_weighted_card", lambda _location: CARD_BY_ID["nothing"])
    room.use_kept_card(first.token, "plus", mine.id)
    assert room.pending_capture is not None
    assert theirs.location == "O2"
    room.confirm_capture(first.token)
    assert theirs.location == "S"
    assert room.pending_card is not None
    assert room.pending_card["cardId"] == "nothing"


def test_card_movement_can_finish_last_piece_and_end_game():
    room, first, _ = room_with_players("classic")
    moving = piece(room, first)
    finish_except(room, first, moving.id)
    moving.index = 20
    room.must_roll = False
    room.hands[first.public_id].append({"instanceId": "finish", "cardId": "plus_one"})
    room.use_kept_card(first.token, "finish", moving.id)
    assert moving.finished is True
    assert room.status == "finished"
    assert room.winner_id == first.public_id


def test_move_records_deterministic_stepwise_path():
    room, first, _ = room_with_players()
    roll = room.roll(first.token, "geol")
    room.move(first.token, 0, roll["id"])
    assert room.last_move["path"] == ["O1", "O2", "O3"]
    assert room.last_move["to"] == "O3"
    assert room.last_move["pieceIds"] == [0]


def test_frozen_piece_consumes_one_result_without_discarding_pool():
    room, first, _ = room_with_players()
    frozen = piece(room, first)
    frozen.frozen = True
    yut = room.roll(first.token, "yut")
    gae = room.roll(first.token, "gae")
    room.move(first.token, frozen.id, gae["id"])
    assert frozen.frozen is False
    assert [result["id"] for result in room.pending_rolls] == [yut["id"]]
    assert room.current_token == first.token


def test_card_catalog_keeps_all_18_ids_weights_probabilities_and_assets():
    expected_ids = [
        "plus_one", "plus_two", "minus_one", "opponent_back", "reroll", "shield",
        "merge", "split", "extra_turn", "nothing", "plus_four", "teleport",
        "golden_yut", "last_place_boost", "swap", "minus_three", "forced_split", "chaos_swap",
    ]
    assert [card.id for card in CARD_DEFINITIONS] == expected_ids
    assert len(CARD_BY_ID) == 18
    for tier, total_weight in CARD_TIER_WEIGHTS.items():
        probability_sum = sum(card.weight / total_weight for card in CARD_DEFINITIONS if card.tier == tier)
        assert probability_sum == pytest.approx(1)
    card_folder = Path(__file__).parents[2] / "frontend/public/assets/yut/cards"
    assert all((card_folder / card.image).is_file() for card in CARD_DEFINITIONS)


def test_card_chain_is_limited_to_maximum_draws(monkeypatch):
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 2
    room.must_roll = False
    room.pending_rolls = [{"id": 999, "name": "do", "steps": 1}]
    monkeypatch.setattr(room, "_weighted_card", lambda _location: CARD_BY_ID["nothing"])
    for _ in range(MAX_CARD_CHAIN):
        assert room._maybe_draw_card(first.public_id, moving)
        room.card_choice(first.token, "keep")
    assert room.card_chain_count == MAX_CARD_CHAIN
    assert room.pending_card is None
    assert room._maybe_draw_card(first.public_id, moving) is False


def test_finish_win_and_rematch_reset_v2_state():
    room, first, second = room_with_players()
    moving = piece(room, first)
    finish_except(room, first, moving.id)
    moving.index = 20
    roll = room.roll(first.token, "do")
    room.move(first.token, moving.id, roll["id"])
    assert room.status == "finished"
    assert room.winner_id == first.public_id
    assert first.score == 1
    room.request_rematch(first.token)
    room.request_rematch(second.token)
    assert room.status == "playing"
    assert room.game_number == 2
    assert room.player_order[0] == second.token
    assert room.must_roll is True
    assert room.pending_rolls == []


def test_yut_api_websocket_join_and_v2_action_dispatch():
    response = client.post("/omokwithfriend/api/yut/rooms?mode=classic")
    assert response.status_code == 201
    code = response.json()["roomCode"]
    with client.websocket_connect(f"/omokwithfriend/ws/yut/rooms/{code}") as first_socket:
        first_socket.send_json({"type": "join", "nickname": "A", "character": "hachiware"})
        joined = first_socket.receive_json()
        first_socket.receive_json()
        with client.websocket_connect(f"/omokwithfriend/ws/yut/rooms/{code}") as second_socket:
            second_socket.send_json({"type": "join", "nickname": "B", "character": "usagi"})
            second_socket.receive_json()
            second_socket.receive_json()
            started = first_socket.receive_json()
            assert started["state"]["mustRoll"] is True
            first_socket.send_json({"type": "roll"})
            rolled = first_socket.receive_json()["state"]
            assert rolled["lastEvent"]["type"] == "roll"
            assert rolled["lastEvent"]["roll"]["id"] >= 1
    with client.websocket_connect(f"/omokwithfriend/ws/yut/rooms/{code}") as socket:
        socket.send_json({"type": "join", "nickname": "A", "character": "hachiware", "token": joined["token"]})
        rejoined = socket.receive_json()
        synced = socket.receive_json()
        assert rejoined["reconnected"] is True
        assert synced["state"]["players"][0]["connected"] is True
        assert "pendingRolls" in synced["state"]
