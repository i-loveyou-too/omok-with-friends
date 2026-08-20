import type { CharacterId } from '../../types'

export type CharacterMood =
  | 'default'
  | 'myTurn'
  | 'waiting'
  | 'thinking'
  | 'win'
  | 'lose'
  | 'disconnected'
  | 'reconnected'
  | 'reaction'

export interface CharacterAsset {
  id: CharacterId
  label: string
  shortLabel: string
  theme: string
  assets: Record<CharacterMood, string | null>
}

const emptySlots: Record<CharacterMood, null> = {
  default: null,
  myTurn: null,
  waiting: null,
  thinking: null,
  win: null,
  lose: null,
  disconnected: null,
  reconnected: null,
  reaction: null,
}

export const characterAssets: Record<CharacterId, CharacterAsset> = {
  chiikawa: { id: 'chiikawa', label: '치이카와', shortLabel: '치', theme: 'pink', assets: { ...emptySlots } },
  hachiware: { id: 'hachiware', label: '하치와레', shortLabel: '하', theme: 'sky', assets: { ...emptySlots } },
  momonga: { id: 'momonga', label: '모몽가', shortLabel: '모', theme: 'lilac', assets: { ...emptySlots } },
  usagi: { id: 'usagi', label: '우사기', shortLabel: '우', theme: 'yellow', assets: { ...emptySlots } },
}

