import { useEffect, useRef, useState } from 'react'
import { CharacterAvatar } from '../../components/CharacterAvatar'
import { BOARD_POSITIONS, INNER_KEYS, OUTER_KEYS } from './board'
import { yutAssets, yutTileAsset, type YutTileKind } from './assets'
import type { YutPiece, YutState } from './types'

export type YutPieceSelectionMode = 'move' | 'own' | 'opponent' | null

interface Props {
  state: YutState
  selfId: string | null
  selectionMode: YutPieceSelectionMode
  selectedPieceIds?: number[]
  onSelect: (piece: YutPiece) => void
  onHop?: () => void
}

interface PieceGhost {
  key: string
  piece: YutPiece
  location: string
  kind: 'captured' | 'finished'
}

function pieceKey(piece: Pick<YutPiece, 'ownerId' | 'id'>) {
  return `${piece.ownerId}:${piece.id}`
}

function groupedPieces(pieces: YutPiece[], locations: Record<string, string>) {
  const groups = new Map<string, YutPiece[]>()
  for (const piece of pieces.filter((item) => !item.finished)) {
    const location = locations[pieceKey(piece)] ?? piece.location
    if (location === 'S' || location === 'F') continue
    const key = `${piece.ownerId}:${location}`
    groups.set(key, [...(groups.get(key) ?? []), piece])
  }
  return [...groups.entries()].map(([key, piecesAtLocation]) => ({
    key,
    location: key.slice(key.indexOf(':') + 1),
    pieces: piecesAtLocation,
  }))
}

export function YutBoard({ state, selfId, selectionMode, selectedPieceIds = [], onSelect, onHop }: Props) {
  const [locations, setLocations] = useState<Record<string, string>>(() =>
    Object.fromEntries(state.pieces.map((piece) => [pieceKey(piece), piece.location])),
  )
  const [ghosts, setGhosts] = useState<PieceGhost[]>([])
  const [hoppingKeys, setHoppingKeys] = useState<Set<string>>(new Set())
  const seenMove = useRef('')
  const previousPieces = useRef(new Map(state.pieces.map((piece) => [pieceKey(piece), piece])))
  const onHopRef = useRef(onHop)
  onHopRef.current = onHop

  useEffect(() => {
    const signature = JSON.stringify(state.lastMove)
    const finalLocations = Object.fromEntries(state.pieces.map((piece) => [pieceKey(piece), piece.location]))
    if (!state.lastMove || signature === seenMove.current) {
      setLocations(finalLocations)
      seenMove.current = signature
      return
    }
    seenMove.current = signature
    const timers: number[] = []
    if (state.lastMove.swap?.length) {
      setLocations({
        ...finalLocations,
        ...Object.fromEntries(state.lastMove.swap.map((move) => [`${move.ownerId}:${move.pieceId}`, move.from])),
      })
      timers.push(window.setTimeout(() => {
        setLocations(finalLocations)
        setHoppingKeys(new Set(state.lastMove?.swap?.map((move) => `${move.ownerId}:${move.pieceId}`)))
        onHopRef.current?.()
      }, 220))
      timers.push(window.setTimeout(() => setHoppingKeys(new Set()), 420))
    } else if (state.lastMove.ownerId && state.lastMove.pieceIds?.length && state.lastMove.from) {
      const keys = state.lastMove.pieceIds.map((id) => `${state.lastMove?.ownerId}:${id}`)
      setLocations({ ...finalLocations, ...Object.fromEntries(keys.map((key) => [key, state.lastMove?.from as string])) })
      const path = state.lastMove.path?.length ? state.lastMove.path : state.lastMove.to ? [state.lastMove.to] : []
      path.forEach((location, index) => {
        timers.push(window.setTimeout(() => {
          setLocations((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, location])) }))
          setHoppingKeys(new Set(keys))
          onHopRef.current?.()
        }, 210 * (index + 1)))
        timers.push(window.setTimeout(() => setHoppingKeys(new Set()), 210 * (index + 1) + 180))
      })
    } else {
      setLocations(finalLocations)
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [state.lastMove, state.pieces])

  useEffect(() => {
    const before = previousPieces.current
    const next = new Map(state.pieces.map((piece) => [pieceKey(piece), piece]))
    const newGhosts: PieceGhost[] = []
    for (const current of state.pieces) {
      const old = before.get(pieceKey(current))
      if (!old) continue
      if (state.lastEvent?.type === 'capture_confirmed' && old.location !== 'S' && current.location === 'S') {
        newGhosts.push({ key: `capture-${pieceKey(current)}`, piece: current, location: old.location, kind: 'captured' })
      } else if (!old.finished && current.finished) {
        newGhosts.push({ key: `finish-${pieceKey(current)}`, piece: current, location: old.location, kind: 'finished' })
      }
    }
    previousPieces.current = next
    if (!newGhosts.length) return
    setGhosts(newGhosts)
    const timer = window.setTimeout(() => setGhosts([]), 720)
    return () => window.clearTimeout(timer)
  }, [state.lastEvent, state.pieces])

  const lucky = new Set(state.lucky.normal)
  const jackpot = new Set(state.lucky.jackpot)
  const danger = new Set(state.lucky.danger)
  const groups = groupedPieces(state.pieces, locations)
  const ownersByLocation = new Map<string, Set<string>>()
  groups.forEach(({ location, pieces }) => {
    const owners = ownersByLocation.get(location) ?? new Set<string>()
    owners.add(pieces[0].ownerId)
    ownersByLocation.set(location, owners)
  })
  const contestedLocations = new Set(
    [...ownersByLocation.entries()].filter(([, owners]) => owners.size > 1).map(([location]) => location),
  )

  const selectable = (piece: YutPiece) => {
    if (!selectionMode || piece.finished) return false
    if (selectionMode === 'opponent') return piece.ownerId !== selfId && !['S', 'F'].includes(piece.location)
    return piece.ownerId === selfId
  }

  return (
    <div className="yut-board-wrap">
      <div className="yut-board" aria-label="윷놀이 말판">
        <svg className="yut-lines" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M8 92H92V8H8Z" />
          <path d="M8 50H92M50 8V92M8 8L92 92M92 8L8 92" />
        </svg>
        {[...OUTER_KEYS.filter((key) => key !== 'S'), ...INNER_KEYS].map((key) => {
          const [x, y] = BOARD_POSITIONS[key]

          if (key === 'O20') {
            return (
              <img
                key={key}
                className="yut-node yut-node--start-finish"
                src={yutAssets.ui.startFinish}
                alt="출발·도착"
                style={{ left: `${x}%`, top: `${y}%` }}
                draggable={false}
              />
            )
          }

          const kind: YutTileKind = jackpot.has(key) ? 'jackpot' : danger.has(key) ? 'danger' : lucky.has(key) ? 'lucky' : 'normal'
          const label = kind === 'jackpot' ? '대박칸' : kind === 'danger' ? '위험칸' : kind === 'lucky' ? '행운칸' : '일반칸'
          return <img key={key} className={`yut-node ${kind}`} src={yutTileAsset(kind)} alt={label} style={{ left: `${x}%`, top: `${y}%` }} draggable={false} />
        })}
        {groups.map(({ key, location, pieces }) => {
          const first = pieces[0]
          const [x, y] = BOARD_POSITIONS[location]
          const mine = first.ownerId === selfId
          const owner = state.players.find((player) => player.id === first.ownerId)
          const canSelect = selectable(first)
          return (
            <button
              key={key}
              className={`yut-piece ${mine ? 'mine' : 'theirs'} ${contestedLocations.has(location) ? 'is-contested' : ''} ${x >= 90 ? 'is-right-edge' : ''} ${y >= 90 ? 'is-bottom-edge' : ''} ${first.shielded ? 'shielded' : ''} ${canSelect ? 'can-select' : ''} ${selectedPieceIds.includes(first.id) && mine ? 'is-selected' : ''} ${hoppingKeys.has(pieceKey(first)) ? 'is-hopping' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              disabled={!canSelect}
              onClick={() => onSelect(first)}
              aria-label={`${mine ? '내' : '상대'} 말 ${pieces.length}개`}
            >
              {owner && <CharacterAvatar character={owner.character} active={canSelect} />}
              {pieces.length > 1 && <span className="yut-stack-count">×{pieces.length}</span>}
            </button>
          )
        })}
        {ghosts.map((ghost) => {
          const [x, y] = BOARD_POSITIONS[ghost.location]
          const owner = state.players.find((player) => player.id === ghost.piece.ownerId)
          return <span key={ghost.key} className={`yut-piece yut-piece-ghost is-${ghost.kind}`} style={{ left: `${x}%`, top: `${y}%` }}>{owner && <CharacterAvatar character={owner.character} />}</span>
        })}
      </div>
    </div>
  )
}
