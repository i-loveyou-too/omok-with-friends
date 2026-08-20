from app.renju import BLACK, WHITE, ForbiddenReason, RenjuRuleEngine, new_board


engine = RenjuRuleEngine()


def put(board, color, *coords):
    for row, col in coords:
        board[row][col] = color


def test_black_exact_five_wins():
    board = new_board()
    put(board, BLACK, (7, 3), (7, 4), (7, 5), (7, 6), (7, 7))
    assert engine.is_win(board, 7, 7, BLACK)
    assert len(engine.winning_line(board, 7, 7, BLACK)) == 5


def test_black_overline_is_forbidden_and_not_a_win():
    board = new_board()
    put(board, BLACK, (7, 3), (7, 4), (7, 5), (7, 6), (7, 7))
    analysis = engine.analyze_black_move(board, 7, 8)
    assert analysis.forbidden == ForbiddenReason.OVERLINE

    board[7][8] = BLACK
    assert not engine.is_win(board, 7, 8, BLACK)


def test_double_three_is_forbidden():
    board = new_board()
    put(board, BLACK, (7, 6), (7, 8), (6, 7), (8, 7))
    assert engine.analyze_black_move(board, 7, 7).forbidden == ForbiddenReason.DOUBLE_THREE


def test_double_four_is_forbidden():
    board = new_board()
    put(board, BLACK, (7, 5), (7, 6), (7, 8), (5, 7), (6, 7), (8, 7))
    assert engine.analyze_black_move(board, 7, 7).forbidden == ForbiddenReason.DOUBLE_FOUR


def test_white_overline_wins():
    board = new_board()
    put(board, WHITE, (4, 2), (4, 3), (4, 4), (4, 5), (4, 6), (4, 7))
    assert engine.is_win(board, 4, 7, WHITE)

