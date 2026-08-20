from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, List, Optional, Sequence, Set, Tuple


BOARD_SIZE = 15
CENTER = BOARD_SIZE // 2
EMPTY = None
BLACK = "black"
WHITE = "white"
Coord = Tuple[int, int]
Board = List[List[Optional[str]]]
DIRECTIONS: Sequence[Coord] = ((0, 1), (1, 0), (1, 1), (1, -1))


class ForbiddenReason(str, Enum):
    OVERLINE = "overline"
    DOUBLE_FOUR = "double_four"
    DOUBLE_THREE = "double_three"


@dataclass(frozen=True)
class MoveAnalysis:
    forbidden: Optional[ForbiddenReason]
    winning_line: Tuple[Coord, ...] = ()


def new_board() -> Board:
    return [[EMPTY for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]


class RenjuRuleEngine:
    """Balanced Omok rules for a 15x15 board.

    Both colors win with exactly five and share the same forbidden moves:
    overlines, double-fours and double-threes.
    """

    @staticmethod
    def inside(row: int, col: int) -> bool:
        return 0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE

    def analyze_move(self, board: Board, row: int, col: int, color: str) -> MoveAnalysis:
        if not self.inside(row, col) or board[row][col] is not EMPTY:
            raise ValueError("The move must target an empty cell on the board")

        board[row][col] = color
        try:
            if self._has_overline(board, row, col, color):
                return MoveAnalysis(ForbiddenReason.OVERLINE)

            winning = self.winning_line(board, row, col, color)
            # A legal exact-five wins even when it also resembles a
            # double-three or double-four. Overline remains forbidden.
            if winning:
                return MoveAnalysis(None, tuple(winning))

            if self._four_threats(board, row, col, color) >= 2:
                return MoveAnalysis(ForbiddenReason.DOUBLE_FOUR)
            if self._open_three_directions(board, row, col, color) >= 2:
                return MoveAnalysis(ForbiddenReason.DOUBLE_THREE)
            return MoveAnalysis(None)
        finally:
            board[row][col] = EMPTY

    def analyze_black_move(self, board: Board, row: int, col: int) -> MoveAnalysis:
        return self.analyze_move(board, row, col, BLACK)

    def forbidden_points(self, board: Board, color: str) -> List[Tuple[int, int, str]]:
        points: List[Tuple[int, int, str]] = []
        for row in range(BOARD_SIZE):
            for col in range(BOARD_SIZE):
                if board[row][col] is EMPTY:
                    reason = self.analyze_move(board, row, col, color).forbidden
                    if reason:
                        points.append((row, col, reason.value))
        return points

    def winning_line(
        self, board: Board, row: int, col: int, color: str
    ) -> List[Coord]:
        for dr, dc in DIRECTIONS:
            run = self._contiguous_run(board, row, col, color, dr, dc)
            if len(run) == 5:
                return run
        return []

    def is_win(self, board: Board, row: int, col: int, color: str) -> bool:
        return bool(self.winning_line(board, row, col, color))

    def _has_overline(self, board: Board, row: int, col: int, color: str) -> bool:
        return any(
            len(self._contiguous_run(board, row, col, color, dr, dc)) >= 6
            for dr, dc in DIRECTIONS
        )

    def _contiguous_run(
        self, board: Board, row: int, col: int, color: str, dr: int, dc: int
    ) -> List[Coord]:
        before: List[Coord] = []
        r, c = row - dr, col - dc
        while self.inside(r, c) and board[r][c] == color:
            before.append((r, c))
            r, c = r - dr, c - dc
        before.reverse()

        after: List[Coord] = []
        r, c = row + dr, col + dc
        while self.inside(r, c) and board[r][c] == color:
            after.append((r, c))
            r, c = r + dr, c + dc
        return before + [(row, col)] + after

    def _line_coords(self, row: int, col: int, dr: int, dc: int, radius: int = 5) -> Iterable[Coord]:
        for distance in range(-radius, radius + 1):
            r, c = row + dr * distance, col + dc * distance
            if self.inside(r, c):
                yield r, c

    def _exact_five_sets(
        self, board: Board, origin: Coord, direction: Coord, color: str
    ) -> Set[frozenset[Coord]]:
        """Return exact-five segments in one direction containing origin."""
        row, col = origin
        dr, dc = direction
        coords = list(self._line_coords(row, col, dr, dc, radius=7))
        result: Set[frozenset[Coord]] = set()
        for start in range(0, len(coords) - 4):
            window = coords[start : start + 5]
            if origin not in window or any(board[r][c] != color for r, c in window):
                continue
            left = coords[start - 1] if start > 0 else None
            right = coords[start + 5] if start + 5 < len(coords) else None
            if left and board[left[0]][left[1]] == color:
                continue
            if right and board[right[0]][right[1]] == color:
                continue
            result.add(frozenset(window))
        return result

    def _winning_extensions(
        self, board: Board, origin: Coord, direction: Coord, color: str
    ) -> List[Tuple[Coord, frozenset[Coord]]]:
        wins: List[Tuple[Coord, frozenset[Coord]]] = []
        row, col = origin
        dr, dc = direction
        for r, c in self._line_coords(row, col, dr, dc):
            if board[r][c] is not EMPTY:
                continue
            board[r][c] = color
            try:
                for five in self._exact_five_sets(board, origin, direction, color):
                    if (r, c) in five:
                        wins.append(((r, c), frozenset(five - {(r, c)})))
            finally:
                board[r][c] = EMPTY
        return wins

    def _four_threats(self, board: Board, row: int, col: int, color: str) -> int:
        threats: Set[Tuple[Coord, frozenset[Coord]]] = set()
        for direction in DIRECTIONS:
            for _, stones in self._winning_extensions(board, (row, col), direction, color):
                if (row, col) in stones:
                    threats.add((direction, stones))
        return len(threats)

    def _open_three_directions(self, board: Board, row: int, col: int, color: str) -> int:
        count = 0
        origin = (row, col)
        for direction in DIRECTIONS:
            dr, dc = direction
            found = False
            for r, c in self._line_coords(row, col, dr, dc, radius=4):
                if board[r][c] is not EMPTY:
                    continue
                board[r][c] = color
                try:
                    # A straight-four with two distinct legal winning ends is
                    # the defining continuation of an open three.
                    wins = self._winning_extensions(board, origin, direction, color)
                    endpoints = {point for point, stones in wins if (r, c) in stones}
                    if len(endpoints) >= 2 and not self._has_overline(board, r, c, color):
                        found = True
                        break
                finally:
                    board[r][c] = EMPTY
            if found:
                count += 1
        return count
