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
  lastMove: Point | null
  winningLine: Point[]
  winnerId: string | null
  undoRequestedBy: string | null
  rematchReady: string[]
  firstMoveCenterOnly: boolean
  forbidden: ForbiddenPoint[]
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
  playerId: string
  value: string
  nonce: number
}
