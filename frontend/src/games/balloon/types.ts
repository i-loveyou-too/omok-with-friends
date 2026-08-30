import type { CharacterId, ConnectionStatus } from '../../types'

export interface BalloonPlayer {
  id: string
  nickname: string
  character: CharacterId
  connected: boolean
  score: number
}

export interface BalloonObject {
  balloonId: string
  pumpCount: number
}

export interface BalloonTurn {
  turnId: string
  playerId: string
  turnScore: number
  deadlineAt: number | null
  resolved: boolean
}

export type BalloonOutcomeKind = 'bank' | 'pop' | 'timeout'

export interface BalloonOutcome {
  turnId: string
  playerId: string
  kind: BalloonOutcomeKind
  points: number
  turnScore: number
  pumpCount: number
  at: number
}

export interface BalloonState {
  roomCode: string
  gameType: 'balloon'
  targetScore: number
  turnMs: number
  status: 'waiting' | 'playing' | 'finished'
  turnNumber: number
  players: BalloonPlayer[]
  balloon: BalloonObject | null
  turn: BalloonTurn | null
  winnerId: string | null
  lastOutcome: BalloonOutcome | null
  nextTurnAt: number | null
  paused: boolean
  rematchReadyIds: string[]
  serverNow: number
}

export interface BalloonConnection {
  state: BalloonState | null
  status: ConnectionStatus
  selfId: string | null
  error: string | null
  notice: string | null
  send: (payload: object) => boolean
}
