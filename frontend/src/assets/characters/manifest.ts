import type { CharacterId } from '../../types'

export type CharacterMood =
  | 'idle'
  | 'selected'
  | 'myTurn'
  | 'waiting'
  | 'thinking'
  | 'win'
  | 'lose'
  | 'disconnected'
  | 'reconnected'

export type ReactionKind = 'laugh' | 'surprised' | 'wait' | 'mistake' | 'clap' | 'angry'

export interface CharacterAsset {
  id: CharacterId
  label: string
  shortLabel: string
  theme: 'pink' | 'sky' | 'lilac' | 'yellow'
  poses: Record<CharacterMood, string>
  reactions: Record<ReactionKind, string>
}

const sprites = import.meta.glob<string>('./*/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})

function sprite(character: CharacterId, name: string) {
  const path = `./${character}/${name}.webp`
  const url = sprites[path]
  if (!url) throw new Error(`Missing final character asset: ${path}`)
  return url
}

function character(
  id: CharacterId,
  label: string,
  shortLabel: string,
  theme: CharacterAsset['theme'],
): CharacterAsset {
  return {
    id,
    label,
    shortLabel,
    theme,
    poses: {
      idle: sprite(id, 'idle'),
      selected: sprite(id, 'selected'),
      myTurn: sprite(id, 'my-turn'),
      waiting: sprite(id, 'waiting'),
      thinking: sprite(id, 'thinking'),
      win: sprite(id, 'win'),
      lose: sprite(id, 'lose'),
      disconnected: sprite(id, 'disconnected'),
      reconnected: sprite(id, 'reconnected'),
    },
    reactions: {
      laugh: sprite(id, 'reaction-laugh'),
      surprised: sprite(id, 'reaction-surprised'),
      wait: sprite(id, 'reaction-wait'),
      mistake: sprite(id, 'reaction-mistake'),
      clap: sprite(id, 'reaction-clap'),
      angry: sprite(id, 'reaction-angry'),
    },
  }
}

export const characterAssets: Record<CharacterId, CharacterAsset> = {
  chiikawa: character('chiikawa', '치이카와', '치', 'pink'),
  hachiware: character('hachiware', '하치와레', '하', 'sky'),
  momonga: character('momonga', '모몽가', '모', 'lilac'),
  usagi: character('usagi', '우사기', '우', 'yellow'),
}

export const reactionKindByValue: Record<string, ReactionKind> = {
  'ㅋㅋㅋ': 'laugh',
  '헉!': 'surprised',
  '잠깐!!': 'wait',
  '잘못뒀어ㅠ': 'mistake',
  '👏': 'clap',
  '😡': 'angry',
}

export function preloadCharacterAssets(characterIds: CharacterId[]) {
  const urls = new Set<string>()
  for (const id of characterIds) {
    const config = characterAssets[id]
    Object.values(config.poses).forEach((url) => urls.add(url))
    Object.values(config.reactions).forEach((url) => urls.add(url))
  }
  for (const url of urls) {
    const image = new Image()
    image.src = url
  }
}
