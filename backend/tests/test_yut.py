from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.yut import CARD_BY_ID, CARD_DEFINITIONS, CARD_TIER_WEIGHTS, MAX_CARD_CHAIN, SHORT_A, YutRoom, yut_room_manager


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
    return next(p for p in room.pieces if p.owner_id == player.public_id and p.id == piece_id)


def resolve_card(room, moving, card_id, monkeypatch):
    cards = iter([CARD_BY_ID[card_id], *([CARD_BY_ID["nothing"]] * MAX_CARD_CHAIN)])
    monkeypatch.setattr(room, "_weighted_card", lambda _location: next(cards))
    return room._resolve_lucky_chain(moving, 0)


def finish_except(room, player, *piece_ids):
    for candidate in [p for p in room.pieces if p.owner_id == player.public_id]:
        if candidate.id not in piece_ids:
            candidate.finished = True
            candidate.index = len(SHORT_A) - 1


def test_room_starts_with_four_pieces_per_player():
    room, first, second = room_with_players()
    assert room.status == "playing"
    assert len([p for p in room.pieces if p.owner_id == first.public_id]) == 4
    assert len([p for p in room.pieces if p.owner_id == second.public_id]) == 4


def test_shortcut_stack_and_capture_grant_extra_turn():
    room, first, second = room_with_players()
    leader = piece(room, first, 0)
    mate = piece(room, first, 1)
    target = piece(room, second, 0)
    for stacked in (leader, mate):
        stacked.index = 4
    target.index = 5

    room.pending_roll = {"name": "do", "steps": 1}
    room.move(first.token, leader.id)

    assert leader.route == mate.route == "a"
    assert leader.index == mate.index == SHORT_A.index("O5")
    assert target.location == "S"
    assert room.current_token == first.token
    assert room.extra_roll is True


def test_frozen_piece_consumes_roll_and_turn():
    room, first, second = room_with_players()
    frozen = piece(room, first)
    frozen.frozen = True
    room.pending_roll = {"name": "gae", "steps": 2}

    room.move(first.token, frozen.id)

    assert frozen.frozen is False
    assert frozen.location == "S"
    assert room.pending_roll is None
    assert room.current_token == second.token
    assert room.last_event["type"] == "frozen_skip"


def test_lucky_card_moves_stack_and_chains(monkeypatch):
    room, first, _ = room_with_players("lucky")
    leader = piece(room, first, 0)
    mate = piece(room, first, 1)
    leader.index = mate.index = 1
    cards = iter([
        CARD_BY_ID["plus_two"],
        CARD_BY_ID["plus_one"],
        CARD_BY_ID["nothing"],
    ])
    monkeypatch.setattr(room, "_weighted_card", lambda _location: next(cards))

    room.pending_roll = {"name": "do", "steps": 1}
    room.move(first.token, leader.id)

    assert leader.location == mate.location == "O5"
    assert leader.route == mate.route == "a"
    assert room.last_event["code"] == "plus_two"
    assert [event["code"] for event in room.last_event["chain"]] == ["plus_one", "nothing"]


def test_card_catalog_has_18_ids_probabilities_and_cropped_images():
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


@pytest.mark.parametrize(
    ("card_id", "expected_location", "grants_reroll"),
    [
        ("plus_one", "O3", False),
        ("plus_two", "O4", False),
        ("minus_one", "O1", False),
        ("plus_four", "O6", False),
        ("teleport", "O6", False),
        ("golden_yut", "O3", True),
        ("minus_three", "S", False),
    ],
)
def test_all_card_movement_effects(card_id, expected_location, grants_reroll, monkeypatch):
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 2

    _, events = resolve_card(room, moving, card_id, monkeypatch)

    assert moving.location == expected_location
    assert bool(events[0].get("grantReroll")) is grants_reroll


def test_all_non_movement_card_effects(monkeypatch):
    room, first, second = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 2

    opponent = piece(room, second)
    opponent.index = 6
    finish_except(room, second, opponent.id)
    resolve_card(room, moving, "opponent_back", monkeypatch)
    assert opponent.location == "O4"

    _, reroll_events = resolve_card(room, moving, "reroll", monkeypatch)
    _, extra_turn_events = resolve_card(room, moving, "extra_turn", monkeypatch)
    _, nothing_events = resolve_card(room, moving, "nothing", monkeypatch)
    assert reroll_events[0]["grantReroll"] is True
    assert extra_turn_events[0]["grantReroll"] is True
    assert "grantReroll" not in nothing_events[0]

    resolve_card(room, moving, "shield", monkeypatch)
    assert moving.shielded is True

    mate = piece(room, first, 1)
    mate.index = 1
    finish_except(room, first, moving.id, mate.id)
    resolve_card(room, moving, "merge", monkeypatch)
    assert mate.location == moving.location

    opponent.finished = False
    opponent.index = 5
    opponent_mate = piece(room, second, 1)
    opponent_mate.finished = False
    opponent_mate.index = 5
    resolve_card(room, moving, "split", monkeypatch)
    assert {opponent.location, opponent_mate.location} == {"O4", "O5"}

    mate.route = "outer"
    mate.index = 0
    resolve_card(room, moving, "last_place_boost", monkeypatch)
    assert mate.location == "O5"

    opponent.index = 6
    opponent_mate.finished = True
    resolve_card(room, moving, "swap", monkeypatch)
    assert moving.location == "O6"
    assert opponent.location == "O2"

    moving.route = mate.route = "outer"
    moving.index = mate.index = 2
    resolve_card(room, moving, "forced_split", monkeypatch)
    assert {moving.location, mate.location} == {"O1", "O2"}

    moving.index = 2
    mate.finished = True
    opponent.index = 7
    resolve_card(room, moving, "chaos_swap", monkeypatch)
    assert moving.location == "O7"
    assert opponent.location == "O2"


def test_card_chain_is_limited_to_four_activations(monkeypatch):
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 2
    cards = iter([
        CARD_BY_ID["plus_two"],
        CARD_BY_ID["plus_one"],
        CARD_BY_ID["plus_one"],
        CARD_BY_ID["plus_one"],
        CARD_BY_ID["plus_one"],
    ])
    monkeypatch.setattr(room, "_weighted_card", lambda _location: next(cards))

    _, events = room._resolve_lucky_chain(moving, 0)

    assert len(events) == MAX_CARD_CHAIN
    assert moving.location == "A2"


def test_chained_extra_turn_is_propagated_to_turn_result(monkeypatch):
    room, first, _ = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 1
    cards = iter([CARD_BY_ID["plus_two"], CARD_BY_ID["extra_turn"]])
    monkeypatch.setattr(room, "_weighted_card", lambda _location: next(cards))
    room.pending_roll = {"name": "do", "steps": 1}

    room.move(first.token, moving.id)

    assert moving.location == "O4"
    assert room.last_event["grantReroll"] is True
    assert room.current_token == first.token
    assert room.extra_roll is True


def test_boosted_piece_captures_and_grants_extra_turn(monkeypatch):
    room, first, second = room_with_players("lucky")
    moving = piece(room, first)
    moving.index = 1
    boosted = piece(room, first, 1)
    target = piece(room, second)
    target.index = 5
    cards = iter([CARD_BY_ID["last_place_boost"], CARD_BY_ID["nothing"]])
    monkeypatch.setattr(room, "_weighted_card", lambda _location: next(cards))
    room.pending_roll = {"name": "do", "steps": 1}

    room.move(first.token, moving.id)

    assert boosted.location == "O5"
    assert target.location == "S"
    assert room.current_token == first.token
    assert room.extra_roll is True


def test_card_movement_captures_and_grants_extra_turn(monkeypatch):
    room, first, second = room_with_players("lucky")
    mine = piece(room, first)
    theirs = piece(room, second)
    mine.index = 1
    theirs.index = 3
    monkeypatch.setattr(room, "_weighted_card", lambda _location: CARD_BY_ID["plus_one"])

    room.pending_roll = {"name": "do", "steps": 1}
    room.move(first.token, mine.id)

    assert mine.location == "O3"
    assert theirs.location == "S"
    assert room.current_token == first.token
    assert room.extra_roll is True


def test_finish_win_and_rematch():
    room, first, second = room_with_players()
    moving = piece(room, first)
    for finished in [p for p in room.pieces if p.owner_id == first.public_id and p is not moving]:
        finished.finished = True
        finished.index = 21
    moving.index = 20
    room.pending_roll = {"name": "do", "steps": 1}

    room.move(first.token, moving.id)

    assert room.status == "finished"
    assert room.winner_id == first.public_id
    assert first.score == 1
    room.request_rematch(first.token)
    room.request_rematch(second.token)
    assert room.status == "playing"
    assert room.game_number == 2
    assert room.player_order[0] == second.token


def test_yut_api_join_and_reconnect_state_sync():
    response = client.post("/omok/api/yut/rooms?mode=lucky")
    assert response.status_code == 201
    code = response.json()["roomCode"]

    with client.websocket_connect(f"/omok/ws/yut/rooms/{code}") as socket:
        socket.send_json({"type": "join", "nickname": "A", "character": "hachiware"})
        joined = socket.receive_json()
        state = socket.receive_json()
        assert joined["type"] == "joined"
        assert state["state"]["mode"] == "lucky"

    with client.websocket_connect(f"/omok/ws/yut/rooms/{code}") as socket:
        socket.send_json({
            "type": "join",
            "nickname": "A",
            "character": "hachiware",
            "token": joined["token"],
        })
        rejoined = socket.receive_json()
        synced = socket.receive_json()
        assert rejoined["reconnected"] is True
        assert rejoined["playerId"] == joined["playerId"]
        assert synced["state"]["players"][0]["connected"] is True
