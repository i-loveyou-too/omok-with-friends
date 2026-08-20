export const BOARD_LINE_COUNT = 15
export const BOARD_INTERVAL_COUNT = BOARD_LINE_COUNT - 1

export interface IntersectionGeometry {
  xPercent: number
  yPercent: number
  hitLeftPercent: number
  hitTopPercent: number
  hitWidthPercent: number
  hitHeightPercent: number
}

function assertBoardIndex(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value >= BOARD_LINE_COUNT) {
    throw new RangeError(`${label} must be an integer from 0 to ${BOARD_LINE_COUNT - 1}`)
  }
}

function axisGeometry(index: number) {
  const position = index / BOARD_INTERVAL_COUNT * 100
  const start = Math.max(0, (index - 0.5) / BOARD_INTERVAL_COUNT * 100)
  const end = Math.min(100, (index + 0.5) / BOARD_INTERVAL_COUNT * 100)
  return { position, start, size: end - start }
}

/**
 * A single 15-lines/14-intervals coordinate source for every board visual and hit target.
 * Edge targets are half-width Voronoi regions, so the wooden frame is never clickable.
 */
export function getIntersectionGeometry(row: number, col: number): IntersectionGeometry {
  assertBoardIndex(row, 'row')
  assertBoardIndex(col, 'col')
  const x = axisGeometry(col)
  const y = axisGeometry(row)
  return {
    xPercent: x.position,
    yPercent: y.position,
    hitLeftPercent: x.start,
    hitTopPercent: y.start,
    hitWidthPercent: x.size,
    hitHeightPercent: y.size,
  }
}
