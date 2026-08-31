import math
import time

import pytest

from app.curling import (
    DT,
    HOUSE_X,
    HOUSE_Y,
    RINK_WIDTH,
    STONE_RADIUS,
    CurlingRoom,
    CurlingStone,
)
from app.game import GameError


def joined_room() -> tuple[CurlingRoom, str, str]:
    room = CurlingRoom("ABCDE")
    first = room.join("첫째", "chiikawa", None)
    second = room.join("둘째", "hachiware", None)
    return room, first.token, second.token


def test_two_players_start_match_and_turns_alternate():
    room, first_token, second_token = joined_room()
    assert room.status == "playing"
    starter = room.current_token
    other = second_token if starter == first_token else first_token

    room.shoot(starter, 0.0, 0.4)
    assert room.current_token == other


def test_rejects_wrong_turn_and_bad_input():
    room, first_token, second_token = joined_room()
    starter = room.current_token
    wrong = second_token if starter == first_token else first_token
    with pytest.raises(GameError):
        room.shoot(wrong, 0.0, 0.5)
    with pytest.raises(GameError):
        room.shoot(starter, 60.0, 0.5)
    with pytest.raises(GameError):
        room.shoot(starter, 0.0, 0.01)


def test_straight_shot_moves_toward_house():
    room, first_token, _ = joined_room()
    result = room.shoot(room.current_token, 0.0, 0.8)
    stone = room.stones[-1]
    assert stone.y < 1420
    assert result["frames"]
    assert result["stoneId"] == stone.id


def test_target_scoring_adds_all_stones_for_both_players():
    room, first_token, second_token = joined_room()
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id
    room.stones = [
        CurlingStone("a1", first_id, 1, HOUSE_X, HOUSE_Y),          # 50
        CurlingStone("a2", first_id, 2, HOUSE_X + 80, HOUSE_Y),     # 30
        CurlingStone("b1", second_id, 1, HOUSE_X + 120, HOUSE_Y),   # 20
        CurlingStone("b2", second_id, 2, HOUSE_X + 175, HOUSE_Y),   # 10
    ]
    score = room.calculate_end_score()
    assert score["winnerId"] == first_id
    assert score["playerPoints"] == {first_id: 80, second_id: 30}
    assert score["stonePoints"] == {"a1": 50, "a2": 30, "b1": 20, "b2": 10}


def test_ring_score_uses_stone_center_not_edge_overlap():
    room, first_token, second_token = joined_room()
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id
    room.stones = [
        # Center is exactly on the 50-point boundary: 50.
        CurlingStone("center50", first_id, 1, HOUSE_X + 45, HOUSE_Y),
        # The stone body still overlaps the 50-point circle, but its center is outside it: 30.
        CurlingStone("edge30", second_id, 1, HOUSE_X + 46, HOUSE_Y),
    ]
    score = room.calculate_end_score()
    assert score["stonePoints"] == {"center50": 50, "edge30": 30}


def test_outside_outer_ring_scores_zero():
    room, first_token, second_token = joined_room()
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id
    room.stones = [
        CurlingStone("a", first_id, 1, HOUSE_X + 191, HOUSE_Y),
        CurlingStone("b", second_id, 1, HOUSE_X + 189, HOUSE_Y),
    ]
    score = room.calculate_end_score()
    assert score["playerPoints"][first_id] == 0
    assert score["playerPoints"][second_id] == 10
    assert score["winnerId"] == second_id



def test_house_outside_stone_stays_in_play_as_guard_and_scores_zero():
    room, first_token, _ = joined_room()
    first_id = room.players[first_token].public_id
    guard = CurlingStone("guard-zero", first_id, 1, HOUSE_X, HOUSE_Y + 360)
    room.stones = [guard]

    score = room.calculate_end_score()

    assert guard.in_play is True
    assert score["stonePoints"][guard.id] == 0
    assert guard in room.stones


def test_side_rails_keep_stones_live_and_open_ends_still_remove_them():
    room, first_token, _ = joined_room()
    first_id = room.players[first_token].public_id
    guard = CurlingStone("guard", first_id, 1, HOUSE_X, HOUSE_Y + 360)
    assert room._out_of_bounds(guard) is False

    guard.x = -STONE_RADIUS
    assert room._out_of_bounds(guard) is False

    guard.y = -STONE_RADIUS
    assert room._out_of_bounds(guard) is True

def test_end_awards_target_points_to_both_players_and_loser_starts_next_end():
    room, first_token, second_token = joined_room()
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id
    room.end_start_index = 0
    room.stones = [
        CurlingStone("a", first_id, 1, HOUSE_X, HOUSE_Y),
        CurlingStone("b", second_id, 1, HOUSE_X + 120, HOUSE_Y),
    ]
    room._finish_end()
    assert room.players[first_token].score == 50
    assert room.players[second_token].score == 20
    room.end_number = 2
    room._start_regular_end()
    assert room.current_token == second_token


def test_tied_end_flips_the_previous_starter():
    room, first_token, second_token = joined_room()
    room.end_start_index = 0
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id
    room.stones = [
        CurlingStone("a", first_id, 1, HOUSE_X + 80, HOUSE_Y),
        CurlingStone("b", second_id, 1, HOUSE_X - 80, HOUSE_Y),
    ]
    room._finish_end()
    assert room.last_end_result["winnerId"] is None

    room.end_number = 2
    room._start_regular_end()
    assert room.current_token == second_token


def test_left_and_right_curl_bend_to_opposite_sides():
    left_room, left_first, left_second = joined_room()
    left_token = left_room.current_token
    left_room.shoot(left_token, 0.0, 0.72, "left")
    left_x = left_room.stones[-1].x

    right_room, right_first, right_second = joined_room()
    right_token = right_room.current_token
    right_room.shoot(right_token, 0.0, 0.72, "right")
    right_x = right_room.stones[-1].x

    assert left_x < HOUSE_X
    assert right_x > HOUSE_X


def test_invalid_curl_is_rejected():
    room, _, _ = joined_room()
    with pytest.raises(GameError):
        room.shoot(room.current_token, 0.0, 0.5, "spinny")


def test_three_end_tie_advances_to_shootout():
    room, _, _ = joined_room()
    room.status = "end_finished"
    room.end_number = 3
    room.transition_kind = "after_end"
    room.transition_deadline = 0.0
    event = room.advance(now=1.0)
    assert event["type"] == "shootout_started"
    assert room.status == "shootout"
    assert room.shootout_round == 1


def test_non_tied_final_score_finishes_match():
    room, first_token, second_token = joined_room()
    room.players[first_token].score = 2
    room.players[second_token].score = 1
    room.status = "end_finished"
    room.end_number = 3
    room.transition_kind = "after_end"
    room.transition_deadline = 0.0
    event = room.advance(now=1.0)
    assert event["type"] == "match_finished"
    assert room.status == "finished"
    assert room.winner_id == room.players[first_token].public_id


def test_shootout_attempts_are_independent_and_first_stone_is_cleared():
    room, first_token, second_token = joined_room()
    room._start_shootout()
    starter = room.current_token
    other = second_token if starter == first_token else first_token

    first_shot = room.shoot(starter, 0.0, 0.55, "straight")
    assert room.status == "shootout"
    assert room.current_token == other
    assert room.stones == []
    assert room.shootout_attempts[first_shot["playerId"]] < math.inf


def test_tied_shootout_repeats_and_flips_starter():
    room, first_token, second_token = joined_room()
    room._start_shootout()
    first_round_starter = room.current_token
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id

    # Force equal measured attempts, then finish the round.
    room.shootout_attempts = {first_id: 42.0, second_id: 42.4}
    room.throw_number = 2
    room._finish_shootout_round()
    assert room.status == "end_finished"
    assert room.last_end_result["tie"] is True
    room.transition_deadline = 0.0
    event = room.advance(now=1.0)
    assert event["type"] == "shootout_started"
    assert room.current_token != first_round_starter


def test_shootout_miss_loses_to_any_in_play_attempt():
    room, first_token, second_token = joined_room()
    room._start_shootout()
    player_ids = [room.players[token].public_id for token in room.player_order]
    room.shootout_attempts = {player_ids[0]: math.inf, player_ids[1]: 380.0}
    room.throw_number = 2
    room._finish_shootout_round()
    assert room.status == "finished"
    assert room.winner_id == player_ids[1]
    assert room.last_end_result["distances"][player_ids[0]] is None


def test_shootout_double_timeout_retries_without_non_json_infinity():
    room, _, _ = joined_room()
    room._start_shootout()
    for _ in range(2):
        deadline = room.turn_deadline
        assert deadline is not None
        room.expire_turn(now=deadline + 0.01)
    assert room.status == "end_finished"
    assert room.last_end_result["tie"] is True
    assert set(room.last_end_result["distances"].values()) == {None}


def test_rematch_requires_both_players():
    room, first_token, second_token = joined_room()
    room.status = "finished"
    room.winner_id = room.players[first_token].public_id
    room.request_rematch(first_token)
    assert room.status == "finished"
    room.request_rematch(second_token)
    assert room.status == "playing"
    assert room.game_number == 2
    assert all(player.score == 0 for player in room.players.values())


def test_straight_takeout_transfers_motion_to_existing_stone():
    room, first_token, _ = joined_room()
    first_id = room.players[first_token].public_id
    guard = CurlingStone("guard", first_id, 1, HOUSE_X, 780.0)
    room.stones = [guard]
    room.shoot(room.current_token, 0.0, 0.9)
    assert guard.y < 780.0


def test_full_power_can_run_through_the_back_of_the_rink():
    room, first_token, _ = joined_room()
    room.shoot(room.current_token, 0.0, 1.0)
    launched = room.stones[-1]
    assert not launched.in_play or launched.y < HOUSE_Y


def test_live_sweep_is_only_available_to_the_shooter():
    room, first_token, second_token = joined_room()
    shooter = room.current_token
    other = second_token if shooter == first_token else first_token
    room.begin_live_shot(shooter, 0.0, 0.55, "straight")
    with pytest.raises(GameError):
        room.set_sweeping(other, True)
    event = room.set_sweeping(shooter, True)
    assert event["active"] is True
    assert room.snapshot()["sweeping"] is True


def test_holding_sweep_reduces_friction_and_carries_stone_farther():
    plain, _, _ = joined_room()
    plain.begin_live_shot(plain.current_token, 0.0, 0.55, "straight")
    while not plain.step_live_shot():
        pass
    plain_y = plain.stones[-1].y
    plain.finish_live_shot()

    swept, _, _ = joined_room()
    shooter = swept.current_token
    swept.begin_live_shot(shooter, 0.0, 0.55, "straight")
    swept.set_sweeping(shooter, True)
    while not swept.step_live_shot():
        pass
    swept_y = swept.stones[-1].y
    swept.finish_live_shot()

    assert swept_y < plain_y


def test_sweeping_holds_a_curled_stone_straighter():
    plain, _, _ = joined_room()
    plain.begin_live_shot(plain.current_token, 0.0, 0.58, "right")
    while not plain.step_live_shot():
        pass
    plain_x = plain.stones[-1].x
    plain.finish_live_shot()

    swept, _, _ = joined_room()
    shooter = swept.current_token
    swept.begin_live_shot(shooter, 0.0, 0.58, "right")
    swept.set_sweeping(shooter, True)
    while not swept.step_live_shot():
        pass
    swept_x = swept.stones[-1].x
    swept.finish_live_shot()

    assert abs(swept_x - HOUSE_X) < abs(plain_x - HOUSE_X)


def test_power_80_curl_is_visible_and_takes_three_to_four_seconds():
    endpoints = {}
    durations = {}
    paths = {}
    for curl in ("left", "straight", "right"):
        room, _, _ = joined_room()
        room.begin_live_shot(room.current_token, 0.0, 0.80, curl)
        steps = 0
        samples = []
        while True:
            steps += 1
            done = room.step_live_shot()
            if steps in {30, 60, 90, 120, 150, 180}:
                samples.append((room.stones[-1].x, room.stones[-1].y))
            if done:
                break
        stone = room.stones[-1]
        endpoints[curl] = (stone.x, stone.y)
        durations[curl] = steps * DT
        paths[curl] = samples

    assert all(3.0 <= duration <= 4.0 for duration in durations.values())
    assert 350.0 <= endpoints["left"][0] <= 380.0
    assert endpoints["straight"][0] == pytest.approx(HOUSE_X)
    assert 620.0 <= endpoints["right"][0] <= 650.0

    left_halfway_bend = HOUSE_X - paths["left"][2][0]
    left_late_bend = paths["left"][2][0] - endpoints["left"][0]
    assert HOUSE_X - paths["left"][0][0] < 10.0
    assert left_late_bend >= left_halfway_bend * 1.8


def test_power_80_full_sweep_adds_carry_and_visibly_straightens_curl():
    plain, _, _ = joined_room()
    plain_result = _live_shot(plain, 0.80, "right")
    plain_stone = next(stone for stone in plain.stones if stone.id == plain_result["stoneId"])

    swept, _, _ = joined_room()
    swept_result = _live_shot(swept, 0.80, "right", sweep=True)
    swept_stone = next(stone for stone in swept.stones if stone.id == swept_result["stoneId"])

    assert plain_stone.y - swept_stone.y >= 100.0
    straightening = abs(plain_stone.x - HOUSE_X) - abs(swept_stone.x - HOUSE_X)
    assert straightening >= 15.0
    assert abs(swept_stone.x - HOUSE_X) >= 100.0


@pytest.mark.parametrize(("angle", "curl"), [(-28.0, "left"), (28.0, "right")])
def test_power_80_outward_curl_bounces_off_side_wall(angle, curl):
    room, _, _ = joined_room()
    room.begin_live_shot(room.current_token, angle, 0.80, curl)
    shot = room.active_shot
    assert shot is not None
    previous_vx = shot.velocities[shot.stone_id][0]
    bounce_count = 0
    while True:
        done = room.step_live_shot()
        vx = shot.velocities[shot.stone_id][0]
        if previous_vx * vx < 0.0:
            bounce_count += 1
        previous_vx = vx
        if done:
            break

    stone = room.stones[-1]
    assert bounce_count == 1
    assert STONE_RADIUS <= stone.x <= RINK_WIDTH - STONE_RADIUS
    assert stone.in_play is True


def test_swept_wall_shot_can_take_out_an_opponent_stone():
    room, first_token, second_token = joined_room()
    shooter = room.current_token
    opponent = second_token if shooter == first_token else first_token
    opponent_id = room.players[opponent].public_id
    room.stones = [CurlingStone("wall-target", opponent_id, 1, 760.0, 50.0)]

    room.begin_live_shot(shooter, 28.0, 1.0, "straight")
    room.set_sweeping(shooter, True)
    shot = room.active_shot
    assert shot is not None
    previous_vx = shot.velocities[shot.stone_id][0]
    bounced = False
    while True:
        done = room.step_live_shot()
        vx = shot.velocities[shot.stone_id][0]
        bounced = bounced or previous_vx * vx < 0.0
        previous_vx = vx
        if done:
            break
    result = room.finish_live_shot()

    assert bounced is True
    assert result["impactCount"] >= 1
    assert result["opponentTakeoutCount"] == 1
    assert "wall-target" in result["knockedOutStoneIds"]


def test_turn_timer_is_20_seconds_and_timeout_skips_stone():
    room, first_token, second_token = joined_room()
    starter = room.current_token
    other = second_token if starter == first_token else first_token
    started = room.turn_started_at
    deadline = room.turn_deadline
    assert started is not None
    assert deadline is not None
    assert deadline - started == pytest.approx(20.0)

    event = room.expire_turn(now=deadline + 0.01)
    assert event is not None
    assert event["playerId"] == room.players[starter].public_id
    assert room.throw_number == 1
    assert room.current_token == other
    assert room.stones == []
    assert room.turn_deadline is not None


def test_six_missed_throws_finish_regular_end_with_zero_points():
    room, _, _ = joined_room()
    for _ in range(6):
        assert room.turn_deadline is not None
        room.expire_turn(now=room.turn_deadline + 0.01)
    assert room.status == "end_finished"
    assert room.last_end_result is not None
    assert all(points == 0 for points in room.last_end_result["playerPoints"].values())
    assert room.turn_deadline is None


def test_snapshot_exposes_authoritative_turn_clock():
    room, _, _ = joined_room()
    snapshot = room.snapshot()
    assert snapshot["turnDurationSeconds"] == 20
    assert snapshot["turnStartedAt"] is not None
    assert snapshot["turnDeadline"] is not None
    assert 19000 <= snapshot["turnDeadline"] - snapshot["serverNow"] <= 20000


def test_opponent_guard_is_never_protected_from_takeout():
    room, first_token, second_token = joined_room()
    shooter = room.current_token
    opponent = second_token if shooter == first_token else first_token
    opponent_id = room.players[opponent].public_id

    # A zero-point guard directly in the lane must be fully hittable from the
    # very first throw. There is intentionally no free-guard protection rule.
    guard = CurlingStone("opponent-guard", opponent_id, 1, HOUSE_X, 780.0)
    room.stones = [guard]
    before_y = guard.y

    room.shoot(shooter, 0.0, 0.9)

    assert guard.y < before_y or guard.in_play is False



def test_explicit_leave_forfeit_finishes_match_for_opponent():
    room, first_token, second_token = joined_room()
    loser = room.current_token
    winner = second_token if loser == first_token else first_token
    event = room.forfeit(loser)
    assert event is not None
    assert room.status == "finished"
    assert room.winner_id == room.players[winner].public_id


def test_snapshot_exposes_starter_and_remaining_throw_counts():
    room, first_token, second_token = joined_room()
    starter = room.current_token
    other = second_token if starter == first_token else first_token
    first = room.snapshot()
    starter_id = room.players[starter].public_id
    other_id = room.players[other].public_id
    assert first["starterPlayerId"] == starter_id
    assert first["throwsRemainingByPlayer"][starter_id] == 3
    room.shoot(starter, 0.0, 0.4)
    next_snapshot = room.snapshot()
    assert next_snapshot["throwsUsedByPlayer"][starter_id] == 1
    assert next_snapshot["throwsRemainingByPlayer"][starter_id] == 2
    assert next_snapshot["throwsRemainingByPlayer"][other_id] == 3


def _live_shot(room: CurlingRoom, power: float, curl: str = "straight", sweep: bool = False) -> dict:
    token = room.current_token
    assert token is not None
    room.begin_live_shot(token, 0.0, power, curl)
    if sweep:
        room.set_sweeping(token, True)
    while not room.step_live_shot():
        pass
    return room.finish_live_shot()


def test_reference_power_ladder_is_playable_after_physics_tuning():
    expected = {0.80: 10, 0.85: 30, 0.88: 50}
    for power, points in expected.items():
        room, _, _ = joined_room()
        result = _live_shot(room, power)
        assert result["landingPoints"] == points


def test_static_and_live_simulation_use_same_friction_constant():
    static_room, _, _ = joined_room()
    static_room.shoot(static_room.current_token, 0.0, 0.85, "straight")
    static_stone = static_room.stones[-1]

    live_room, _, _ = joined_room()
    _live_shot(live_room, 0.85)
    live_stone = live_room.stones[-1]

    assert live_stone.y == pytest.approx(static_stone.y, abs=0.05)


def test_shot_reports_real_opponent_takeout_not_just_a_hard_hit():
    room, first_token, second_token = joined_room()
    shooter = room.current_token
    opponent = second_token if shooter == first_token else first_token
    opponent_id = room.players[opponent].public_id
    guard = CurlingStone("take-me-out", opponent_id, 1, HOUSE_X, 180.0)
    room.stones = [guard]

    result = _live_shot(room, 1.0)

    assert result["impactCount"] > 0
    assert result["opponentTakeoutCount"] >= 1
    assert "take-me-out" in result["knockedOutStoneIds"]


def test_end_history_and_next_starter_are_authoritative():
    room, first_token, second_token = joined_room()
    room.end_start_index = 0
    first_id = room.players[first_token].public_id
    second_id = room.players[second_token].public_id
    room.stones = [
        CurlingStone("a", first_id, 1, HOUSE_X, HOUSE_Y),
        CurlingStone("b", second_id, 1, HOUSE_X + 120, HOUSE_Y),
    ]

    room._finish_end()

    assert room.last_end_result["nextStarterId"] == second_id
    assert room.end_history == [{
        "endNumber": 1,
        "winnerId": first_id,
        "playerPoints": {first_id: 50, second_id: 20},
    }]
    snapshot = room.snapshot()
    assert snapshot["endHistory"] == room.end_history


def test_disconnect_pauses_turn_timer_and_reconnect_resumes_remaining_time():
    room, first_token, second_token = joined_room()
    now = room.turn_started_at
    assert now is not None
    original_deadline = room.turn_deadline
    assert original_deadline is not None
    room.disconnect(second_token)

    assert room.turn_deadline is None
    assert room.paused_turn_remaining == pytest.approx(20.0, abs=0.1)
    assert room.snapshot()["pausedForReconnect"] is True

    room.join("둘째", "hachiware", second_token)
    assert room.players[second_token].connected is True
    assert room.turn_deadline is not None
    assert room.snapshot()["pausedForReconnect"] is False
    assert 19.0 <= room.turn_deadline - time.monotonic() <= 20.1


def test_reconnect_timeout_forfeits_only_when_opponent_is_connected():
    room, first_token, second_token = joined_room()
    room.disconnect(first_token)
    deadline = room.reconnect_deadlines[first_token]
    event = room.expire_reconnect(first_token, now=deadline + 0.01)

    assert event is not None
    assert event["type"] == "reconnect_timeout"
    assert room.status == "finished"
    assert room.winner_id == room.players[second_token].public_id


def test_both_disconnected_does_not_arbitrarily_award_a_winner():
    room, first_token, second_token = joined_room()
    room.disconnect(first_token)
    room.disconnect(second_token)
    first_deadline = room.reconnect_deadlines[first_token]

    assert room.expire_reconnect(first_token, now=first_deadline + 10) is None
    assert room.status == "playing"
    assert room.winner_id is None


def test_disconnect_during_live_shot_finishes_motion_then_waits_for_reconnect():
    room, first_token, second_token = joined_room()
    shooter = room.current_token
    other = second_token if shooter == first_token else first_token
    room.begin_live_shot(shooter, 0.0, 0.82, "straight")
    room.disconnect(other)

    while not room.step_live_shot():
        pass
    room.finish_live_shot()

    assert room.active_shot is None
    assert room.turn_deadline is None
    assert room.paused_turn_remaining == pytest.approx(20.0)
    assert room.snapshot()["pausedForReconnect"] is True


def test_snapshot_exposes_reconnect_deadline_without_monotonic_clock_leak():
    room, first_token, _ = joined_room()
    room.disconnect(first_token)
    snapshot = room.snapshot()
    player_id = room.players[first_token].public_id

    assert snapshot["reconnectGraceSeconds"] == 20
    assert snapshot["reconnectDeadlines"][player_id] >= snapshot["serverNow"]
    assert snapshot["activeShot"] is None


def test_late_reconnect_cannot_race_past_expired_grace_period(monkeypatch):
    room, first_token, second_token = joined_room()
    room.disconnect(first_token)
    deadline = room.reconnect_deadlines[first_token]
    monkeypatch.setattr("app.curling.time.monotonic", lambda: deadline + 0.01)

    player = room.join("첫째", "chiikawa", first_token)

    assert player.connected is True
    assert room.status == "finished"
    assert room.winner_id == room.players[second_token].public_id
    assert room.last_event["type"] == "reconnect_timeout"


def test_explicit_leave_while_waiting_releases_the_player_slot():
    room = CurlingRoom("ABCDE")
    first = room.join("첫째", "chiikawa", None)
    assert len(room.players) == 1

    room.leave(first.token)

    assert room.status == "waiting"
    assert room.players == {}
    assert room.player_order == []
    replacement = room.join("새친구", "usagi", None)
    assert replacement.token in room.players
    assert len(room.players) == 1


def test_match_started_with_disconnected_waiting_player_enters_reconnect_pause():
    room = CurlingRoom("ABCDE")
    first = room.join("첫째", "chiikawa", None)
    room.disconnect(first.token)
    second = room.join("둘째", "hachiware", None)

    assert room.status == "playing"
    assert room.turn_deadline is None
    assert first.token in room.reconnect_deadlines
    deadline = room.reconnect_deadlines[first.token]
    event = room.expire_reconnect(first.token, now=deadline + 0.01)
    assert event is not None
    assert room.winner_id == second.public_id


def test_rematch_waits_for_both_players_to_be_connected():
    room, first_token, second_token = joined_room()
    room.status = "finished"
    room.winner_id = room.players[first_token].public_id
    room.request_rematch(first_token)
    room.disconnect(first_token)
    room.request_rematch(second_token)

    assert room.game_number == 1
    assert room.status == "finished"
    assert len(room.rematch_ready) == 2

    room.join("첫째", "chiikawa", first_token)
    assert room.game_number == 2
    assert room.status == "playing"
    assert room.rematch_ready == set()
