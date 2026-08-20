import type { Color, ForbiddenPoint, Point } from '../types'

interface Props {
  board: Array<Array<Color | null>>
  forbidden: ForbiddenPoint[]
  lastMove: Point | null
  winningLine: Point[]
  disabled: boolean
  centerOnly: boolean
  onMove: (row: number, col: number) => void
}

const key = (row: number, col: number) => `${row}:${col}`

export function Board({ board, forbidden, lastMove, winningLine, disabled, centerOnly, onMove }: Props) {
  const banned = new Set(forbidden.map((point) => key(point.row, point.col)))
  const winning = new Set(winningLine.map((point) => key(point.row, point.col)))

  return (
    <div className="board-frame">
      <div className="board" role="grid" aria-label="15×15 오목판">
        {board.map((row, rowIndex) => row.map((stone, colIndex) => {
          const pointKey = key(rowIndex, colIndex)
          const isForbidden = banned.has(pointKey)
          const isLast = lastMove?.row === rowIndex && lastMove?.col === colIndex
          const canPlay = !disabled && !stone && !isForbidden && (!centerOnly || (rowIndex === 7 && colIndex === 7))
          return (
            <button
              className={`intersection ${stone ? `has-${stone}` : ''} ${isLast ? 'is-last' : ''} ${winning.has(pointKey) ? 'is-winning' : ''}`}
              type="button"
              role="gridcell"
              aria-label={`${rowIndex + 1}행 ${colIndex + 1}열${stone ? ` ${stone === 'black' ? '흑돌' : '백돌'}` : ''}${isForbidden ? ' 금수' : ''}`}
              disabled={!canPlay}
              key={pointKey}
              onClick={() => onMove(rowIndex, colIndex)}
            >
              {stone && <span className={`stone stone--${stone}`}><i /></span>}
              {!stone && isForbidden && <span className="forbidden" aria-hidden="true">🚫</span>}
              {!stone && centerOnly && rowIndex === 7 && colIndex === 7 && <span className="center-hint" />}
            </button>
          )
        }))}
      </div>
    </div>
  )
}

