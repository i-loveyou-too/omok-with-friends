import type { CharacterId, ConnectionStatus, Profile, Session } from '../../types'

export type YutMode = 'classic' | 'lucky'
export type YutRollName = 'backdo' | 'do' | 'gae' | 'geol' | 'yut' | 'mo'

export interface YutPlayer {
  id: string
  nickname: string
  character: CharacterId
  connected: boolean
  score: number
}

export interface YutPiece {
  id: number
  ownerId: string
  route: 'outer' | 'a' | 'a_center' | 'b'
  index: number
  location: string
  finished: boolean
  shielded: boolean
  frozen: boolean
}

export interface YutRollResult {
  id: number
  name: YutRollName
  steps: number
}

export interface YutCapturePrompt {
  ownerId: string
  movingPieceId: number
  targetPieceIds: number[]
  location: string
  drawCardAfter?: boolean
}

export interface YutCardInstance {
  instanceId: string
  cardId: string
  ownerId?: string
  sourcePieceId?: number
  sourceLocation?: string
  forced?: boolean
}

export interface YutMovePresentation {
  id: number
  reason: string
  ownerId?: string
  pieceIds?: number[]
  from?: string
  path?: string[]
  to?: string | null
  swap?: Array<{ ownerId: string; pieceId: number; from: string; to: string }>
}

export interface LuckyEvent {
  type: string
  code?: string
  label?: string
  tier?: '🍀' | '✨' | '💀'
  location?: string
  message?: string
  playerId?: string
  effect?: string
  probability?: number
  roll?: YutRollResult
  mustRollAgain?: boolean
  cardId?: string
  instanceId?: string
  ownerId?: string
  movingPieceId?: number
  targetPieceIds?: number[]
  capturedPieceIds?: number[]
  grantReroll?: boolean
  forced?: boolean
  noOp?: boolean
}

export interface YutCardDefinition {
  id: string
  label: string
  tier: '🍀' | '✨' | '💀'
  weight: number
  probability: number
  effect: string
  image: string
}

export interface YutState {
  roomCode: string
  mode: YutMode
  status: 'waiting' | 'playing' | 'finished'
  gameNumber: number
  turnPlayerId: string | null
  players: YutPlayer[]
  pieces: YutPiece[]
  pendingRolls: YutRollResult[]
  mustRoll: boolean
  pendingCapture: YutCapturePrompt | null
  pendingCard: YutCardInstance | null
  hands: Record<string, YutCardInstance[]>
  lastMove: YutMovePresentation | null
  winnerId: string | null
  lastEvent: LuckyEvent | null
  rematchReady: string[]
  lucky: { normal: string[]; jackpot: string[]; danger: string[] }
  cards: YutCardDefinition[]
}

export type YutProfile = Profile
export type YutSession = Session
export type { ConnectionStatus }
