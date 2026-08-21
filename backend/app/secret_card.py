from __future__ import annotations

import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from .game import CHARACTERS, REACTIONS, GameError, epoch_ms


STARTING_CHIPS = 500
ANTE = 10
MAX_GAMES = 5
MAX_ROUNDS = 5
TARGET_WINS = 3
TURN_DURATION_SECONDS = 20
RECONNECT_GRACE_SECONDS = 30
ROUND_RESULT_DURATION_MS = 2200
GAME_RESULT_DURATION_MS = 3000
RAISE_AMOUNTS = {10, 50, 100}


@dataclass
class SecretCardPlayer:
    token: str
    public_id: str
    nickname: str
    character: str
    connected: bool = True
    chips: int = STARTING_CHIPS
    games_won: int = 0
    round_wins: int = 0
    raises: int = 0
    folds: int = 0
    all_ins: int = 0
    last_reaction_at: float = field(default_factory=lambda: float("-inf"))

    def public(self) -> dict:
        return {
            "id": self.public_id,
            "nickname": self.nickname,
            "character": self.character,
            "connected": self.connected,
            "chips": self.chips,
            "score": self.games_won,
            "roundWins": self.round_wins,
            "stats": {"raises": self.raises, "folds": self.folds, "allIns": self.all_ins},
        }


@dataclass
class SecretCardState:
    room_code: str
    players: Dict[str, SecretCardPlayer] = field(default_factory=dict)
    player_order: List[str] = field(default_factory=list)
    status: str = "waiting"
    match_number: int = 1
    game_number: int = 0
    round_number: int = 0
    deck: List[int] = field(default_factory=list)
    cards: Dict[str, int] = field(default_factory=dict)
    contributions: Dict[str, int] = field(default_factory=dict)
    pot: int = 0
    current_bet: int = 0
    turn_token: Optional[str] = None
    last_action: Optional[dict] = None
    round_winner_token: Optional[str] = None
    game_winner_token: Optional[str] = None
    match_winner_token: Optional[str] = None
    revealed: bool = False
    rematch_ready: Set[str] = field(default_factory=set)
    turn_started_at: Optional[int] = None
    turn_deadline: Optional[int] = None
    transition_deadline: Optional[int] = None
    reconnect_deadlines: Dict[str, int] = field(default_factory=dict)
    max_pot: int = 0
    last_active: float = field(default_factory=time.monotonic)

    def join(self, nickname: str, character: str, token: Optional[str] = None) -> SecretCardPlayer:
        nickname = nickname.strip()
        if not nickname or len(nickname) > 12:
            raise GameError("invalid_nickname", "닉네임은 1~12자로 입력해 주세요.")
        if character not in CHARACTERS:
            raise GameError("invalid_character", "캐릭터 선택이 올바르지 않아요.")
        if token and token in self.players:
            player = self.players[token]
            player.connected = True
            self.reconnect_deadlines.pop(token, None)
            self.last_active = time.monotonic()
            return player
        if len(self.player_order) >= 2:
            raise GameError("room_full", "이미 두 명이 있는 방이에요.")

        token = secrets.token_urlsafe(24)
        player = SecretCardPlayer(token, secrets.token_hex(4), nickname, character)
        self.players[token] = player
        self.player_order.append(token)
        if len(self.player_order) == 2:
            self._start_match()
        self.last_active = time.monotonic()
        return player

    def disconnect(self, token: str) -> None:
        player = self._player(token)
        player.connected = False
        if self.status == "playing":
            self.reconnect_deadlines[token] = epoch_ms() + RECONNECT_GRACE_SECONDS * 1000
        self.last_active = time.monotonic()

    def reaction(self, token: str, value: str) -> dict:
        player = self._player(token)
        if value not in REACTIONS:
            raise GameError("invalid_reaction", "지원하지 않는 리액션이에요.")
        now = time.monotonic()
        if now - player.last_reaction_at < 1.0:
            raise GameError("reaction_cooldown", "리액션은 잠시 뒤 다시 보내 주세요.")
        player.last_reaction_at = now
        self.last_active = now
        created_at = epoch_ms()
        return {
            "id": secrets.token_hex(8), "roomId": self.room_code,
            "playerId": player.public_id, "value": value,
            "createdAt": created_at, "expiresAt": created_at + 2800,
            "serverTimestamp": created_at,
        }

    def act(self, token: str, action: str, amount: Optional[int] = None) -> dict:
        player = self._player(token)
        if self.status != "playing":
            raise GameError("action_unavailable", "지금은 카드를 선택할 수 없어요.")
        if token != self.turn_token:
            raise GameError("wrong_turn", "상대 차례예요.")
        if self.turn_deadline is not None and epoch_ms() >= self.turn_deadline:
            raise GameError("turn_expired", "선택 시간이 지났어요.")

        opponent_token = self._opponent(token)
        owed = self.current_bet - self.contributions[token]
        if action == "fold":
            player.folds += 1
            self._resolve_round(opponent_token, "fold", actor_token=token)
        elif action == "check":
            if owed:
                raise GameError("check_unavailable", "먼저 콜하거나 다이해야 해요.")
            previous_check = self.last_action and self.last_action.get("action") == "check"
            self._record_action(token, "check", 0)
            if previous_check:
                self._showdown()
            else:
                self._pass_turn(opponent_token)
        elif action == "call":
            if owed <= 0:
                raise GameError("call_unavailable", "받을 베팅이 없어요. 체크해 주세요.")
            if player.chips < owed:
                raise GameError("not_enough_chips", "별이 부족해요. 올인을 선택해 주세요.")
            self._put_chips(token, owed)
            self._record_action(token, "call", owed)
            self._showdown()
        elif action == "raise":
            if amount not in RAISE_AMOUNTS:
                raise GameError("invalid_raise", "+10, +50, +100 중에서 골라 주세요.")
            opponent = self.players[opponent_token]
            target = self.current_bet + amount
            if target > self.contributions[opponent_token] + opponent.chips:
                raise GameError("raise_too_large", "상대가 받을 수 있는 별보다 많이 올릴 수 없어요.")
            required = target - self.contributions[token]
            if required > player.chips:
                raise GameError("not_enough_chips", "별이 부족해요.")
            self._put_chips(token, required)
            self.current_bet = target
            player.raises += 1
            self._record_action(token, "raise", amount)
            self._pass_turn(opponent_token)
        elif action == "all_in":
            player.all_ins += 1
            own_limit = self.contributions[token] + player.chips
            opponent = self.players[opponent_token]
            target = min(own_limit, self.contributions[opponent_token] + opponent.chips)
            required = max(0, target - self.contributions[token])
            self._put_chips(token, required)
            was_raise = target > self.current_bet
            self.current_bet = max(self.current_bet, target)
            self._record_action(token, "all_in", required)
            if not was_raise and self.contributions[token] >= self.current_bet:
                self._showdown()
            else:
                self._pass_turn(opponent_token)
        else:
            raise GameError("invalid_action", "지원하지 않는 선택이에요.")
        self.last_active = time.monotonic()
        return self._event(playerId=player.public_id, action=action, amount=amount)

    def request_next_round(self, token: str) -> bool:
        self._player(token)
        raise GameError("auto_progress", "다음 라운드는 결과 공개 후 자동으로 시작해요.")

    def request_rematch(self, token: str) -> bool:
        self._player(token)
        if self.status != "finished":
            raise GameError("rematch_unavailable", "최종 매치가 끝난 뒤 다시 대결할 수 있어요.")
        self.rematch_ready.add(token)
        if len(self.rematch_ready) == 2:
            self.match_number += 1
            self._start_match()
            return True
        return False

    def leave(self, token: str) -> None:
        self._player(token)
        if self.status in {"playing", "round_finished", "game_finished"} and len(self.player_order) == 2:
            self.match_winner_token = self._opponent(token)
            self.status = "finished"
            self.revealed = True
            self.transition_deadline = None
            self._stop_turn()
        self.disconnect(token)

    def expire_turn(self, now_ms: Optional[int] = None) -> Optional[dict]:
        now_ms = now_ms if now_ms is not None else epoch_ms()
        if self.status != "playing" or self.turn_deadline is None or now_ms < self.turn_deadline:
            return None
        expired = self.turn_token
        if not expired:
            return None
        opponent = self._opponent(expired)
        owed = self.current_bet - self.contributions[expired]
        if owed <= 0:
            previous_check = self.last_action and self.last_action.get("action") == "check"
            self._record_action(expired, "check", 0, automatic=True)
            if previous_check:
                self._showdown()
            else:
                self._pass_turn(opponent)
            action = "check"
        else:
            self._resolve_round(opponent, "fold", actor_token=expired, automatic=True)
            action = "fold"
        return self._event(playerId=self.players[expired].public_id, reason="turn_timeout", action=action)

    def expire_reconnects(self, now_ms: Optional[int] = None) -> List[dict]:
        now_ms = now_ms if now_ms is not None else epoch_ms()
        events: List[dict] = []
        for token, deadline in list(self.reconnect_deadlines.items()):
            if now_ms < deadline:
                continue
            self.reconnect_deadlines.pop(token, None)
            if self.status == "playing" and not self.players[token].connected:
                winner = self._opponent(token)
                self.revealed = True
                self.last_action = {
                    "playerId": self.players[token].public_id,
                    "action": "fold", "amount": self.pot, "automatic": True,
                }
                self.round_winner_token = winner
                self._stop_turn()
                self.reconnect_deadlines.clear()
                self._finish_game(winner)
                events.append(self._event(playerId=self.players[token].public_id, reason="reconnect_timeout", action="fold"))
                break
        return events

    def advance(self, now_ms: Optional[int] = None) -> Optional[dict]:
        now_ms = now_ms if now_ms is not None else epoch_ms()
        if self.transition_deadline is None or now_ms < self.transition_deadline:
            return None
        previous = self.status
        if previous == "round_finished":
            self._start_round()
        elif previous == "game_finished":
            self._start_game()
        else:
            self.transition_deadline = None
            return None
        return self._event(previousStatus=previous, status=self.status, gameNumber=self.game_number, roundNumber=self.round_number)

    def snapshot(self, viewer_token: Optional[str] = None) -> dict:
        opponent_token = self._opponent(viewer_token) if viewer_token in self.player_order and len(self.player_order) == 2 else None
        own_card = self.cards.get(viewer_token) if self.revealed and viewer_token else None
        opponent_card = self.cards.get(opponent_token) if opponent_token else None
        return {
            "roomCode": self.room_code, "gameType": "secret_card",
            "matchNumber": self.match_number, "gameNumber": self.game_number,
            "maxGames": MAX_GAMES, "status": self.status,
            "roundNumber": self.round_number, "maxRounds": MAX_ROUNDS,
            "targetWins": TARGET_WINS, "startingChips": STARTING_CHIPS, "ante": ANTE,
            "players": [self.players[token].public() for token in self.player_order],
            "turnPlayerId": self.players[self.turn_token].public_id if self.turn_token else None,
            "pot": self.pot, "maxPot": self.max_pot, "currentBet": self.current_bet,
            "contributions": {self.players[token].public_id: value for token, value in self.contributions.items()},
            "cards": {"self": own_card, "opponent": opponent_card}, "revealed": self.revealed,
            "roundWinnerId": self.players[self.round_winner_token].public_id if self.round_winner_token else None,
            "gameWinnerId": self.players[self.game_winner_token].public_id if self.game_winner_token else None,
            "matchWinnerId": self.players[self.match_winner_token].public_id if self.match_winner_token else None,
            "lastAction": self.last_action,
            "rematchReady": [self.players[token].public_id for token in self.rematch_ready],
            "turnDurationSeconds": TURN_DURATION_SECONDS,
            "turnStartedAt": self.turn_started_at, "turnDeadline": self.turn_deadline,
            "transitionDeadline": self.transition_deadline,
            "reconnectDeadlines": {self.players[token].public_id: value for token, value in self.reconnect_deadlines.items()},
            "serverNow": epoch_ms(),
        }

    def _start_match(self) -> None:
        self.game_number = 0
        self.match_winner_token = None
        self.rematch_ready.clear()
        self.max_pot = 0
        for player in self.players.values():
            player.games_won = 0
            player.raises = player.folds = player.all_ins = 0
        self._start_game()

    def _start_game(self) -> None:
        self.game_number += 1
        self.round_number = 0
        self.deck = list(range(1, 11))
        random.SystemRandom().shuffle(self.deck)
        self.game_winner_token = None
        self.transition_deadline = None
        for player in self.players.values():
            player.chips = STARTING_CHIPS
            player.round_wins = 0
        self._start_round()

    def _start_round(self) -> None:
        if len(self.deck) < 2:
            self._finish_game()
            return
        self.round_number += 1
        self.status = "playing"
        self.cards = {self.player_order[0]: self.deck.pop(), self.player_order[1]: self.deck.pop()}
        self.contributions = {token: 0 for token in self.player_order}
        self.pot = 0
        for token in self.player_order:
            self._put_chips(token, min(ANTE, self.players[token].chips))
        self.current_bet = max(self.contributions.values())
        self.turn_token = self.player_order[(self.game_number + self.round_number) % 2]
        self.last_action = None
        self.round_winner_token = None
        self.revealed = False
        self.transition_deadline = None
        now = epoch_ms()
        self.reconnect_deadlines = {token: now + RECONNECT_GRACE_SECONDS * 1000 for token in self.player_order if not self.players[token].connected}
        self._start_turn()

    def _resolve_round(self, winner_token: str, reason: str, actor_token: Optional[str] = None, automatic: bool = False) -> None:
        self.round_winner_token = winner_token
        self.players[winner_token].round_wins += 1
        self.players[winner_token].chips += self.pot
        self.max_pot = max(self.max_pot, self.pot)
        self.revealed = True
        event_token = actor_token or winner_token
        self.last_action = {
            "playerId": self.players[event_token].public_id,
            "action": reason, "amount": self.pot, "automatic": automatic,
        }
        self.turn_token = None
        self._stop_turn()
        self.reconnect_deadlines.clear()
        if self.round_number >= MAX_ROUNDS or any(player.chips <= 0 for player in self.players.values()):
            self._finish_game()
        else:
            self.status = "round_finished"
            self.transition_deadline = epoch_ms() + ROUND_RESULT_DURATION_MS

    def _finish_game(self, forced_winner: Optional[str] = None) -> None:
        first, second = self.player_order
        first_player, second_player = self.players[first], self.players[second]
        if forced_winner:
            winner = forced_winner
        elif first_player.chips == second_player.chips:
            winner = first if first_player.round_wins > second_player.round_wins else second
        else:
            winner = first if first_player.chips > second_player.chips else second
        self.game_winner_token = winner
        self.players[winner].games_won += 1
        self.status = "game_finished"
        self.transition_deadline = epoch_ms() + GAME_RESULT_DURATION_MS
        if self.players[winner].games_won >= TARGET_WINS or self.game_number >= MAX_GAMES:
            self.status = "finished"
            self.match_winner_token = winner
            self.transition_deadline = None

    def _showdown(self) -> None:
        first, second = self.player_order
        winner = first if self.cards[first] > self.cards[second] else second
        self._resolve_round(winner, "showdown")

    def _record_action(self, token: str, action: str, amount: int, automatic: bool = False) -> None:
        self.last_action = {"playerId": self.players[token].public_id, "action": action, "amount": amount, "automatic": automatic}

    def _pass_turn(self, token: str) -> None:
        self.turn_token = token
        self._start_turn()

    def _put_chips(self, token: str, amount: int) -> None:
        if amount < 0 or amount > self.players[token].chips:
            raise GameError("not_enough_chips", "별이 부족해요.")
        self.players[token].chips -= amount
        self.contributions[token] = self.contributions.get(token, 0) + amount
        self.pot += amount

    def _start_turn(self) -> None:
        now = epoch_ms()
        self.turn_started_at = now
        self.turn_deadline = now + TURN_DURATION_SECONDS * 1000

    def _stop_turn(self) -> None:
        self.turn_started_at = self.turn_deadline = None

    def _opponent(self, token: str) -> str:
        opponent = next((item for item in self.player_order if item != token), None)
        if not opponent:
            raise GameError("no_opponent", "아직 상대가 없어요.")
        return opponent

    def _player(self, token: str) -> SecretCardPlayer:
        try:
            return self.players[token]
        except KeyError as exc:
            raise GameError("unknown_player", "플레이어 정보를 찾을 수 없어요.") from exc

    def _event(self, **payload: object) -> dict:
        return {"eventId": secrets.token_hex(8), "roomId": self.room_code, "serverTimestamp": epoch_ms(), **payload}
