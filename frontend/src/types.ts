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
  id?: string
  roomId?: string
  createdAt?: number
  expiresAt?: number
  serverTimestamp?: number
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

export interface SecretCardPlayer {
  id: string
  nickname: string
  character: CharacterId
  connected: boolean
  chips: number
  score: number
  roundWins: number
  stats: { raises: number; folds: number; allIns: number }
}

export type SecretCardStatus = 'waiting' | 'playing' | 'round_finished' | 'game_finished' | 'finished'
export type SecretCardAction = 'check' | 'call' | 'raise' | 'fold' | 'all_in'

export interface SecretCardState {
  roomCode: string
  gameType: 'secret_card'
  matchNumber: number
  gameNumber: number
  maxGames: number
  status: SecretCardStatus
  roundNumber: number
  maxRounds: number
  targetWins: number
  startingChips: number
  ante: number
  players: SecretCardPlayer[]
  turnPlayerId: string | null
  pot: number
  maxPot: number
  currentBet: number
  contributions: Record<string, number>
  cards: { self: number | null; opponent: number | null }
  revealed: boolean
  roundWinnerId: string | null
  gameWinnerId: string | null
  matchWinnerId: string | null
  lastAction: { playerId: string; action: string; amount: number; automatic?: boolean } | null
  rematchReady: string[]
  turnDurationSeconds: number
  turnStartedAt: number | null
  turnDeadline: number | null
  transitionDeadline: number | null
  reconnectDeadlines: Record<string, number>
  serverNow: number
}
