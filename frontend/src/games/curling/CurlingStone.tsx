import { characterAssets } from '../../assets/characters/manifest'
import type { CharacterId } from '../../types'
import { CURLING_STONE_VISUAL_DIAMETER_IN_RADII, curlingStoneAssets } from './assets'
import type { CurlingStoneState } from './types'

interface Props {
  stone: CurlingStoneState
  character: CharacterId
  rinkWidth: number
  rinkHeight: number
  stoneRadius: number
  self: boolean
  scoring?: boolean
  points?: number
}

export function CurlingStone({ stone, character, rinkWidth, rinkHeight, stoneRadius, self, scoring, points = 0 }: Props) {
  if (!stone.inPlay) return null
  const config = characterAssets[character]
  const size = `${(stoneRadius * CURLING_STONE_VISUAL_DIAMETER_IN_RADII / rinkWidth) * 100}%`
  const left = `${(stone.x / rinkWidth) * 100}%`
  const top = `${(stone.y / rinkHeight) * 100}%`

  return (
    <div
      className={`curling-stone curling-stone--asset ${self ? 'curling-stone--self' : 'curling-stone--opponent'} ${scoring ? 'is-scoring' : ''}`}
      style={{ left, top, width: size, aspectRatio: '1 / 1' }}
      aria-label={`${config.label} 스톤 ${stone.number}`}
    >
      <img src={curlingStoneAssets[character]} alt="" draggable={false} />
      <i className="curling-stone__owner-mark" aria-hidden="true">{self ? '나' : '상'}</i>
      {points > 0 && <span className={`curling-stone__points ${points === 50 ? 'is-perfect' : ''}`}>+{points}</span>}
    </div>
  )
}
