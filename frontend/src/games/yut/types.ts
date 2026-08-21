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
  route: 'outer' | 'a' | 'b'
  index: number
  location: string
  finished: boolean
  shielded: boolean
  frozen: boolean
}

export interface LuckyEvent {
  type: string
  code?: string
  label?: string
  tier?: '🍀' | '✨' | '💀'
  location?: string
  message?: string
  name?: string
  steps?: number
  playerId?: string
  effect?: string
  probability?: number
  chain?: LuckyEvent[]
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
  pendingRoll: { name: YutRollName; steps: number } | null
  extraRoll: boolean
  winnerId: string | null
  lastEvent: LuckyEvent | null
  rematchReady: string[]
  lucky: { normal: string[]; jackpot: string[]; danger: string[] }
  cards: YutCardDefinition[]
}

export type YutProfile = Profile
export type YutSession = Session
export type { ConnectionStatus }
