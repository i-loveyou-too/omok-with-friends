export const BOARD_POSITIONS: Record<string, [number, number]> = {
  S: [8, 92], O1: [29, 92], O2: [43, 92], O3: [57, 92], O4: [71, 92], O5: [92, 92],
  O6: [92, 71], O7: [92, 57], O8: [92, 43], O9: [92, 29], O10: [92, 8],
  O11: [71, 8], O12: [57, 8], O13: [43, 8], O14: [29, 8], O15: [8, 8],
  O16: [8, 29], O17: [8, 43], O18: [8, 57], O19: [8, 71], O20: [8, 92],
  A1: [71, 71], A2: [57, 57], C: [50, 50], A3: [43, 43], A4: [29, 29],
  B1: [71, 29], B2: [57, 43], B3: [43, 57], B4: [29, 71], F: [8, 92],
}

export const OUTER_KEYS = ['S', ...Array.from({ length: 20 }, (_, i) => `O${i + 1}`)]
export const INNER_KEYS = ['A1', 'A2', 'C', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4']

export const ROLL_LABEL: Record<string, string> = {
  backdo: '빽도', do: '도', gae: '개', geol: '걸', yut: '윷', mo: '모',
}
