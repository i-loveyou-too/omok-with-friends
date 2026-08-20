import { characterAssets, reactionKindByValue, type CharacterMood } from '../assets/characters/manifest'
import type { CharacterId } from '../types'

interface Props {
  character: CharacterId
  mood?: CharacterMood
  active?: boolean
  reaction?: string
  reactionNonce?: number
}

export function CharacterAvatar({ character, mood = 'idle', active, reaction, reactionNonce }: Props) {
  const config = characterAssets[character]
  const reactionKind = reaction ? reactionKindByValue[reaction] : undefined
  const image = reactionKind ? config.reactions[reactionKind] : config.poses[mood]
  return (
    <div className={`avatar avatar--${config.theme} ${active ? 'is-active' : ''}`}>
      {reaction && <span className="reaction-bubble" key={`${reaction}-${reactionNonce ?? 0}`}>{reaction}</span>}
      <img src={image} alt={`${config.label} ${mood} 상태`} draggable={false} />
    </div>
  )
}
