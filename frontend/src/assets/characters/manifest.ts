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

const sprites = import.meta.glob<string>([
  './*/idle.webp',
  './*/my-turn.webp',
  './*/waiting.webp',
  './*/thinking.webp',
  './*/win.webp',
  './*/lose.webp',
  './*/disconnected.webp',
  './*/reconnected.webp',
  './*/reaction-laugh.webp',
], {
  eager: true,
  query: '?url',
  import: 'default',
})

function sprite(character: CharacterId, name: string) {
  const path = [`./${character}/${name}.webp`, `./${character}/${name}.png`]
    .find((candidate) => sprites[candidate])
  if (!path) throw new Error(`Missing shared character asset: ${character}/${name}`)
  return sprites[path]
}

function character(
  id: CharacterId,
  label: string,
  shortLabel: string,
  theme: string,
): CharacterAsset {
  return {
    id,
    label,
    shortLabel,
    theme,
    assets: {
      default: sprite(id, 'idle'),
      myTurn: sprite(id, 'my-turn'),
      waiting: sprite(id, 'waiting'),
      thinking: sprite(id, 'thinking'),
      win: sprite(id, 'win'),
      lose: sprite(id, 'lose'),
      disconnected: sprite(id, 'disconnected'),
      reconnected: sprite(id, 'reconnected'),
      reaction: sprite(id, 'reaction-laugh'),
    },
  }
}

export const characterAssets: Record<CharacterId, CharacterAsset> = {
  chiikawa: character('chiikawa', '치이카와', '치', 'pink'),
  hachiware: character('hachiware', '하치와레', '하', 'sky'),
  momonga: character('momonga', '모몽가', '모', 'lilac'),
  usagi: character('usagi', '우사기', '우', 'yellow'),
}
