import type { CharacterId, ConnectionStatus } from '../../types'

export type { ConnectionStatus }
export type CurlDirection = 'left' | 'straight' | 'right'

export interface CurlingProfile {
  nickname: string
  character: CharacterId
  token?: string
}

export interface CurlingSession extends CurlingProfile {
  token: string
  playerId: string
  roomCode: string
}

export interface CurlingPlayer {
  id: string
  nickname: string
  character: CharacterId
  connected: boolean
  score: number
}

export interface CurlingStoneState {
  id: string
  ownerId: string
  number: number
  x: number
  y: number
  inPlay: boolean
}

export interface CurlingHouse {
  x: number
  y: number
  radius: number
  stoneRadius: number
  rinkWidth: number
  rinkHeight: number
  startX: number
  startY: number
  scoreRings: Array<{ radius: number; points: number }>
}

export interface CurlingEndResult {
  kind: 'end' | 'shootout'
  endNumber?: number
  round?: number
  winnerId: string | null
  points: number
  scoringStoneIds?: string[]
  playerPoints?: Record<string, number>
  stonePoints?: Record<string, number>
  distances?: Record<string, number | null>
  tie?: boolean
  nextStarterId?: string | null
}

export interface CurlingEndHistoryEntry {
  endNumber: number
  winnerId: string | null
  playerPoints: Record<string, number>
}

export interface CurlingActiveShot {
  id: number
  playerId: string
  stoneId: string
  curl: CurlDirection
  power: number
  angle: number
}

export type CurlingStatus = 'waiting' | 'playing' | 'end_finished' | 'shootout' | 'finished'

export interface CurlingState {
  roomCode: string
  gameType: 'curling'
  gameNumber: number
  status: CurlingStatus
  endNumber: number
  maxEnds: number
  stonesPerPlayer: number
  players: CurlingPlayer[]
  turnPlayerId: string | null
  starterPlayerId: string | null
  throwNumber: number
  throwsUsedByPlayer: Record<string, number>
  throwsRemainingByPlayer: Record<string, number>
  shotInProgress: boolean
  activeShotPlayerId: string | null
  sweeping: boolean
  stones: CurlingStoneState[]
  house: CurlingHouse
  lastEndResult: CurlingEndResult | null
  endHistory: CurlingEndHistoryEntry[]
  lastEvent: Record<string, unknown> | null
  shootoutRound: number
  shootoutAttempts: Record<string, number | null>
  shootoutAttemptedPlayerIds: string[]
  winnerId: string | null
  rematchReady: string[]
  transitionDeadline: number | null
  turnDurationSeconds: number
  turnStartedAt: number | null
  turnDeadline: number | null
  turnSerial: number
  pausedForReconnect: boolean
  reconnectGraceSeconds: number
  reconnectDeadlines: Record<string, number>
  activeShot: CurlingActiveShot | null
  serverNow: number
  curlOptions: CurlDirection[]
}

export interface CurlingShotFrameStone extends CurlingStoneState {}
export type CurlingShotFrame = CurlingShotFrameStone[]

export interface CurlingShotResolved {
  id: number
  playerId: string
  stoneId: string
  angle: number
  power: number
  curl: CurlDirection
  frames: CurlingShotFrame[]
  impactCount: number
  maxImpactSpeed: number
  landingPoints: number
  distanceToButton: number | null
  out: boolean
  perfect: boolean
  knockedOutStoneIds: string[]
  opponentTakeoutCount: number
}
