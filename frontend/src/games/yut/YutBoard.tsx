import { BOARD_POSITIONS, INNER_KEYS, OUTER_KEYS } from './board'
import { CharacterAvatar } from '../../components/CharacterAvatar'
import { yutAssets, yutTileAsset, type YutTileKind } from './assets'
import type { YutPiece, YutState } from './types'

interface Props {
  state: YutState
  selfId: string | null
  canMove: boolean
  onMove: (pieceId: number) => void
}

function groupedPieces(pieces: YutPiece[]) {
  const map = new Map<string, YutPiece[]>()
  for (const piece of pieces.filter((p) => !p.finished && p.location !== 'S')) {
    const key = `${piece.ownerId}:${piece.location}`
    map.set(key, [...(map.get(key) ?? []), piece])
  }
  return [...map.values()]
}

export function YutBoard({ state, selfId, canMove, onMove }: Props) {
  const lucky = new Set(state.lucky.normal)
  const jackpot = new Set(state.lucky.jackpot)
  const danger = new Set(state.lucky.danger)
  const groups = groupedPieces(state.pieces)
  const selfPlayer = state.players.find((p) => p.id === selfId)
  const selfHome = state.pieces.filter((p) => p.ownerId === selfId && p.location === 'S' && !p.finished)
  const otherId = state.players.find((p) => p.id !== selfId)?.id
  const otherPlayer = state.players.find((p) => p.id === otherId)
  const otherHome = state.pieces.filter((p) => p.ownerId === otherId && p.location === 'S' && !p.finished)

  return (
    <div className="yut-board-wrap">
      <div className="yut-board" aria-label="윷놀이 말판">
        <svg className="yut-lines" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M8 92H92V8H8Z"/>
          <path d="M8 50H92M50 8V92M8 8L92 92M92 8L8 92"/>
        </svg>
        {[...OUTER_KEYS.filter((key) => key !== 'S'), ...INNER_KEYS].map((key) => {
          const [x, y] = BOARD_POSITIONS[key]
          const kind: YutTileKind = jackpot.has(key) ? 'jackpot' : danger.has(key) ? 'danger' : lucky.has(key) ? 'lucky' : 'normal'
          const label = kind === 'jackpot' ? '대박칸' : kind === 'danger' ? '위험칸' : kind === 'lucky' ? '행운칸' : '일반칸'
          return <img key={key} className={`yut-node ${kind}`} src={yutTileAsset(kind)} alt={label} style={{ left: `${x}%`, top: `${y}%` }} draggable={false}/>
        })}
        {groups.map((group) => {
          const first = group[0]
          const [x, y] = BOARD_POSITIONS[first.location]
          const mine = first.ownerId === selfId
          const owner = state.players.find((player) => player.id === first.ownerId)
          return (
            <button
              key={`${first.ownerId}-${first.location}`}
              className={`yut-piece ${mine ? 'mine' : 'theirs'} ${first.shielded ? 'shielded' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              disabled={!mine || !canMove}
              onClick={() => onMove(first.id)}
              aria-label={`${mine ? '내' : '상대'} 말 ${group.length}개`}
            >
              {owner && <CharacterAvatar character={owner.character} active={mine && canMove}/>}
              {group.length > 1 && <span className="yut-stack-count">×{group.length}</span>}
            </button>
          )
        })}
        <div className="yut-home yut-home--me"><img className="yut-start-art" src={yutAssets.ui.start} alt="출발"/>{selfHome.map((p) => <button key={p.id} aria-label={`내 말 ${p.id + 1}`} disabled={!canMove} onClick={() => onMove(p.id)}>{selfPlayer && <CharacterAvatar character={selfPlayer.character}/>}</button>)}</div>
        <div className="yut-home yut-home--them"><b>상대 말</b>{otherHome.map((p) => <span key={p.id}>{otherPlayer && <CharacterAvatar character={otherPlayer.character}/>}</span>)}</div>
      </div>
    </div>
  )
}
