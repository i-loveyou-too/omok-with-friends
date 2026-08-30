import type { CharacterId, ConnectionStatus } from '../../types'
import type { FindMatchDifficulty } from './manifest'

export interface FindMatchPlayer {
  id: string
  nickname: string
  character: CharacterId
  connected: boolean
  score: number
}

export interface FindMatchRound {
  roundId: string
  left: string[]
  right: string[]
  trapPairs: string[][]
  phase: 'early' | 'mid' | 'late'
  revealedAt: number | null
  resolved: boolean
}

export interface FindMatchState {
  roomCode: string
  gameType: 'find_match'
  difficulty: FindMatchDifficulty
  symbolCount: number
  winTarget: number
  status: 'waiting' | 'playing' | 'finished'
  roundNumber: number
  players: FindMatchPlayer[]
  winnerId: string | null
  combo: { playerId: string | null; count: number }
  round: FindMatchRound | null
  pendingDifficulty: { requestedBy: string; difficulty: FindMatchDifficulty } | null
  rematchReadyIds: string[]
  nextRoundAt: number | null
  serverNow: number
}

export interface FindMatchConnection {
  state: FindMatchState | null
  status: ConnectionStatus
  selfId: string | null
  error: string | null
  notice: string | null
  lockedUntil: number
  lastWinnerId: string | null
  send: (payload: object) => boolean
}
