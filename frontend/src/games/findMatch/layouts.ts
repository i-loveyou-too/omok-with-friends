import type { FindMatchDifficulty } from './manifest'

export type Slot = { x: number; y: number; scale: number }

const VARIANT_PHASES = [0, 0.19, 0.38, 0.57, 0.76, 0.95, 1.14, 1.33, 1.52, 1.71]

const ring = (count: number, radius: number, phase: number, scales: number[]): Slot[] => Array.from({ length: count }, (_, index) => {
  const angle = phase + (Math.PI * 2 * index) / count
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
    scale: scales[index % scales.length],
  }
})

function packedLayout(count: 8 | 10 | 12, variant: number): Slot[] {
  const phase = VARIANT_PHASES[variant]
  if (count === 8) {
    return [
      ...ring(6, 31, phase, [0.82, 0.9, 0.84, 0.88, 0.82, 0.9]),
      ...ring(2, 9, phase + Math.PI / 6, [0.62, 0.62]),
    ]
  }
  if (count === 10) {
    return [
      ...ring(7, 32, phase, [0.78, 0.86, 0.8, 0.84, 0.78, 0.86, 0.82]),
      ...ring(3, 10.5, phase + Math.PI / 7, [0.6, 0.6, 0.6]),
    ]
  }
  return [
    ...ring(8, 33, phase, [0.72, 0.78, 0.7, 0.76, 0.72, 0.78, 0.7, 0.76]),
    ...ring(4, 12, phase + Math.PI / 8, [0.56, 0.58, 0.56, 0.58]),
  ]
}

const makeLayouts = (count: 8 | 10 | 12) => VARIANT_PHASES.map((_, variant) => packedLayout(count, variant))

export const FIND_MATCH_LAYOUTS: Record<FindMatchDifficulty, Slot[][]> = {
  easy: makeLayouts(8),
  medium: makeLayouts(10),
  hard: makeLayouts(12),
}

export function layoutFor(difficulty: FindMatchDifficulty, side: 'left' | 'right', roundNumber: number) {
  const layouts = FIND_MATCH_LAYOUTS[difficulty]
  const offset = side === 'left' ? 0 : 3
  return layouts[(roundNumber + offset) % layouts.length]
}
