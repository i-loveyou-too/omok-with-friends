from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .renju import BLACK, BOARD_SIZE, CENTER, WHITE, Board, RenjuRuleEngine, new_board


CHARACTERS = {"chiikawa", "hachiware", "momonga", "usagi"}
REACTIONS = {"ㅋㅋㅋ", "헉!", "잠깐!!", "잘못뒀어ㅠ", "👏", "😡"}


class GameError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PlayerState:
    token: str
    public_id: str
    nickname: str
    character: str
    connected: bool = True
    color: Optional[str] = None
    last_reaction_at: float = 0.0

    def public(self, score: int) -> dict:
        return {
            "id": self.public_id,
            "nickname": self.nickname,
            "character": self.character,
            "connected": self.connected,
            "color": self.color,
            "score": score,
        }


@dataclass
class Move:
    row: int
    col: int
    color: str
    player_token: str


@dataclass
class GameState:
    room_code: str
    engine: RenjuRuleEngine = field(default_factory=RenjuRuleEngine)
    board: Board = field(default_factory=new_board)
    players: Dict[str, PlayerState] = field(default_factory=dict)
    player_order: List[str] = field(default_factory=list)
    scores: Dict[str, int] = field(default_factory=dict)
    status: str = "waiting"
    turn: str = BLACK
    game_number: int = 1
    moves: List[Move] = field(default_factory=list)
    winner_token: Optional[str] = None
    winning_line: List[Tuple[int, int]] = field(default_factory=list)
    undo_requested_by: Optional[str] = None
    rematch_ready: Set[str] = field(default_factory=set)
    last_active: float = field(default_factory=time.monotonic)

    def join(self, nickname: str, character: str, token: Optional[str] = None) -> PlayerState:
        nickname = nickname.strip()
        if not nickname or len(nickname) > 12:
            raise GameError("invalid_nickname", "닉네임은 1~12자로 입력해 주세요.")
        if character not in CHARACTERS:
            raise GameError("invalid_character", "캐릭터 선택이 올바르지 않아요.")

        if token and token in self.players:
            player = self.players[token]
            player.connected = True
            self.last_active = time.monotonic()
            return player

        if len(self.player_order) >= 2:
            raise GameError("room_full", "이미 두 명이 있는 방이에요.")

        token = secrets.token_urlsafe(24)
        player = PlayerState(
            token=token,
            public_id=secrets.token_hex(4),
            nickname=nickname,
            character=character,
        )
        self.players[token] = player
        self.player_order.append(token)
        self.scores[token] = 0
        self._assign_colors()
        if len(self.player_order) == 2:
            self.status = "playing"
        self.last_active = time.monotonic()
        return player

    def disconnect(self, token: str) -> None:
        if token in self.players:
            self.players[token].connected = False
            self.last_active = time.monotonic()

    def make_move(self, token: str, row: int, col: int) -> None:
        player = self._player(token)
        if self.status != "playing":
            raise GameError("game_not_playing", "지금은 돌을 놓을 수 없어요.")
        if player.color != self.turn:
            raise GameError("wrong_turn", "상대 차례예요.")
        if not self.engine.inside(row, col):
            raise GameError("invalid_coordinate", "보드 밖에는 놓을 수 없어요.")
        if self.board[row][col] is not None:
            raise GameError("occupied", "이미 돌이 놓인 자리예요.")
        if not self.moves and (row, col) != (CENTER, CENTER):
            raise GameError("first_move_center", "첫 수는 정중앙에 놓아 주세요.")
        if player.color == BLACK:
            analysis = self.engine.analyze_black_move(self.board, row, col)
            if analysis.forbidden:
                raise GameError("forbidden", f"흑의 금수예요: {analysis.forbidden.value}")

        self.board[row][col] = player.color
        self.moves.append(Move(row, col, player.color, token))
        self.undo_requested_by = None
        winning = self.engine.winning_line(self.board, row, col, player.color)
        if winning:
            self.status = "finished"
            self.winner_token = token
            self.winning_line = winning
            self.scores[token] += 1
        elif len(self.moves) == BOARD_SIZE * BOARD_SIZE:
            self.status = "draw"
        else:
            self.turn = WHITE if self.turn == BLACK else BLACK
        self.last_active = time.monotonic()

    def request_undo(self, token: str) -> None:
        self._player(token)
        if self.status != "playing" or not self.moves:
            raise GameError("undo_unavailable", "지금은 무르기를 요청할 수 없어요.")
        if self.undo_requested_by:
            raise GameError("undo_pending", "이미 무르기 응답을 기다리고 있어요.")
        self.undo_requested_by = token
        self.last_active = time.monotonic()

    def respond_undo(self, token: str, accept: bool) -> None:
        self._player(token)
        requester = self.undo_requested_by
        if not requester:
            raise GameError("no_undo_request", "대기 중인 무르기 요청이 없어요.")
        if requester == token:
            raise GameError("self_undo_response", "상대가 응답해야 해요.")
        self.undo_requested_by = None
        if not accept:
            return
        move = self.moves.pop()
        self.board[move.row][move.col] = None
        self.turn = move.color
        self.winner_token = None
        self.winning_line = []
        self.status = "playing"
        self.last_active = time.monotonic()

    def resign(self, token: str) -> None:
        self._player(token)
        if self.status != "playing":
            raise GameError("game_not_playing", "진행 중인 게임이 아니에요.")
        opponent = next((item for item in self.player_order if item != token), None)
        if not opponent:
            raise GameError("no_opponent", "아직 상대가 없어요.")
        self.status = "finished"
        self.winner_token = opponent
        self.scores[opponent] += 1
        self.undo_requested_by = None
        self.last_active = time.monotonic()

    def request_rematch(self, token: str) -> bool:
        self._player(token)
        if self.status not in {"finished", "draw"}:
            raise GameError("rematch_unavailable", "게임이 끝난 뒤 다시 대결할 수 있어요.")
        self.rematch_ready.add(token)
        self.last_active = time.monotonic()
        if len(self.rematch_ready) == 2:
            self._reset_for_rematch()
            return True
        return False

    def reaction(self, token: str, value: str) -> dict:
        player = self._player(token)
        if value not in REACTIONS:
            raise GameError("invalid_reaction", "지원하지 않는 리액션이에요.")
        now = time.monotonic()
        if now - player.last_reaction_at < 1.0:
            raise GameError("reaction_cooldown", "리액션은 잠시 뒤 다시 보내 주세요.")
        player.last_reaction_at = now
        self.last_active = now
        return {"playerId": player.public_id, "value": value}

    def snapshot(self) -> dict:
        forbidden = []
        if self.status == "playing" and self.turn == BLACK and self.moves:
            forbidden = [
                {"row": row, "col": col, "reason": reason}
                for row, col, reason in self.engine.forbidden_points(self.board)
            ]
        return {
            "roomCode": self.room_code,
            "gameNumber": self.game_number,
            "status": self.status,
            "turn": self.turn,
            "board": self.board,
            "players": [self.players[token].public(self.scores[token]) for token in self.player_order],
            "lastMove": (
                {"row": self.moves[-1].row, "col": self.moves[-1].col}
                if self.moves
                else None
            ),
            "winningLine": [{"row": row, "col": col} for row, col in self.winning_line],
            "winnerId": self.players[self.winner_token].public_id if self.winner_token else None,
            "undoRequestedBy": (
                self.players[self.undo_requested_by].public_id if self.undo_requested_by else None
            ),
            "rematchReady": [self.players[token].public_id for token in self.rematch_ready],
            "firstMoveCenterOnly": not self.moves,
            "forbidden": forbidden,
        }

    def _player(self, token: str) -> PlayerState:
        try:
            return self.players[token]
        except KeyError as exc:
            raise GameError("unknown_player", "플레이어 정보를 찾을 수 없어요.") from exc

    def _assign_colors(self) -> None:
        if self.player_order:
            self.players[self.player_order[0]].color = BLACK if self.game_number % 2 else WHITE
        if len(self.player_order) > 1:
            self.players[self.player_order[1]].color = WHITE if self.game_number % 2 else BLACK

    def _reset_for_rematch(self) -> None:
        self.game_number += 1
        self.board = new_board()
        self.moves = []
        self.status = "playing"
        self.turn = BLACK
        self.winner_token = None
        self.winning_line = []
        self.undo_requested_by = None
        self.rematch_ready.clear()
        self._assign_colors()
