export type Color = 'black' | 'white'
export type CharacterId = 'chiikawa' | 'hachiware' | 'momonga' | 'usagi'
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface Player {
  id: string
  nickname: string
  character: CharacterId
  connected: boolean
  color: Color | null
  score: number
  awakened: boolean
}

export interface Point {
  row: number
  col: number
}

export interface ForbiddenPoint extends Point {
  reason: 'overline' | 'double_four' | 'double_three'
}

export interface GameState {
  roomCode: string
  gameNumber: number
  status: 'waiting' | 'playing' | 'finished' | 'draw'
  turn: Color
  board: Array<Array<Color | null>>
  players: Player[]
  awakenedPlayers: string[]
  lastMove: Point | null
  winningLine: Point[]
  winnerId: string | null
  undoRequestedBy: string | null
  undoRequestId: string | null
  rematchReady: string[]
  firstMoveCenterOnly: boolean
  forbidden: ForbiddenPoint[]
  turnDurationSeconds: number
  turnStartedAt: number | null
  turnDeadline: number | null
  serverNow: number
}

export interface Profile {
  nickname: string
  character: CharacterId
  token?: string
}

export interface Session extends Profile {
  token: string
  playerId: string
  roomCode: string
}

export interface ReactionEvent {
  id: string
  roomId: string
  playerId: string
  value: string
  createdAt: number
  expiresAt: number
  serverTimestamp: number
}

export interface MoveConfirmedEvent extends Point {
  eventId: string
  roomId: string
  playerId: string
  color: Color
  serverTimestamp: number
}

export interface UndoRequestEvent {
  requestId: string
  roomId: string
  playerId: string
  serverTimestamp: number
}

export interface UndoResultEvent {
  eventId: string
  requestId: string
  roomId: string
  requesterId: string
  responderId: string
  accepted: boolean
  serverTimestamp: number
}

export interface TurnTimeoutEvent {
  eventId: string
  roomId: string
  playerId: string | null
  expiredColor: Color
  serverTimestamp: number
}

export interface PlayerAwakenedEvent {
  eventId: string
  roomId: string
  playerId: string
  serverTimestamp: number
}

export interface GameErrorEvent {
  code: string
  message: string
  nonce: number
}

export interface PresenceEvent {
  playerId: string
  status: 'disconnected' | 'reconnected'
  nonce: number
}
