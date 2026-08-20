import { useState, type CSSProperties } from 'react'

import type { Color, ForbiddenPoint, Point } from '../types'
import { getIntersectionGeometry } from '../utils/boardGeometry'

interface Props {
  board: Array<Array<Color | null>>
  forbidden: ForbiddenPoint[]
  lastMove: Point | null
  winningLine: Point[]
  disabled: boolean
  centerOnly: boolean
  candidate: Point | null
  candidateColor: Color | null
  onMove: (row: number, col: number) => void
}

interface BoardPoint {
  row: number
  col: number
  stone: Color | null
}

const key = (row: number, col: number) => `${row}:${col}`

function visualStyle(row: number, col: number): CSSProperties {
  const geometry = getIntersectionGeometry(row, col)
  return {
    left: `${geometry.xPercent}%`,
    top: `${geometry.yPercent}%`,
  }
}

function hitStyle(row: number, col: number): CSSProperties {
  const geometry = getIntersectionGeometry(row, col)
  return {
    left: `${geometry.hitLeftPercent}%`,
    top: `${geometry.hitTopPercent}%`,
    width: `${geometry.hitWidthPercent}%`,
    height: `${geometry.hitHeightPercent}%`,
  }
}

export function Board({ board, forbidden, lastMove, winningLine, disabled, centerOnly, candidate, candidateColor, onMove }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const banned = new Set(forbidden.map((point) => key(point.row, point.col)))
  const winning = new Set(winningLine.map((point) => key(point.row, point.col)))
  const points: BoardPoint[] = board.flatMap((row, rowIndex) => (
    row.map((stone, colIndex) => ({ row: rowIndex, col: colIndex, stone }))
  ))

  return (
    <div className="board-frame">
      <div className="board" role="grid" aria-label="15×15 오목판">
        <div className="board-visual-layer" aria-hidden="true">
          {points.map(({ row, col, stone }) => {
            const pointKey = key(row, col)
            const isForbidden = banned.has(pointKey)
            const isLast = lastMove?.row === row && lastMove?.col === col
            const isCandidate = candidate?.row === row && candidate?.col === col
            const canSelect = !disabled && !stone && (!centerOnly || (row === 7 && col === 7))
            const geometry = getIntersectionGeometry(row, col)

            return (
              <span
                className={`intersection-visual ${stone ? `has-${stone}` : ''} ${isLast ? 'is-last' : ''} ${winning.has(pointKey) ? 'is-winning' : ''}`}
                data-row={row}
                data-col={col}
                data-x-percent={geometry.xPercent}
                data-y-percent={geometry.yPercent}
                key={pointKey}
                style={visualStyle(row, col)}
              >
                {stone && <span className={`stone stone--${stone}`}><i /></span>}
                {!stone && isCandidate && candidateColor && <span className={`candidate-stone candidate-stone--${candidateColor}`} />}
                {!stone && isForbidden && <span className="forbidden"><i /></span>}
                {!stone && centerOnly && row === 7 && col === 7 && <span className="center-hint" />}
                {!stone && canSelect && hovered === pointKey && <span className="hover-preview" />}
              </span>
            )
          })}
        </div>

        <div className="board-hit-layer">
          {points.map(({ row, col, stone }) => {
            const pointKey = key(row, col)
            const isForbidden = banned.has(pointKey)
            const canSelect = !disabled && !stone && (!centerOnly || (row === 7 && col === 7))

            return (
              <button
                className="intersection"
                type="button"
                role="gridcell"
                aria-label={`${row + 1}행 ${col + 1}열${stone ? ` ${stone === 'black' ? '흑돌' : '백돌'}` : ''}${candidate?.row === row && candidate?.col === col ? ' 후보' : ''}${isForbidden ? ' 금수' : ''}`}
                disabled={!canSelect}
                key={pointKey}
                onBlur={() => setHovered((current) => current === pointKey ? null : current)}
                onClick={() => onMove(row, col)}
                onFocus={() => canSelect && setHovered(pointKey)}
                onMouseEnter={() => canSelect && setHovered(pointKey)}
                onMouseLeave={() => setHovered((current) => current === pointKey ? null : current)}
                style={hitStyle(row, col)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
