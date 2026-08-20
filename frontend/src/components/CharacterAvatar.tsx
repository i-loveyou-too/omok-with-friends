import { characterAssets, reactionKindByValue, type CharacterMood } from '../assets/characters/manifest'
import type { CharacterId } from '../types'

interface Props {
  character: CharacterId
  mood?: CharacterMood
  active?: boolean
  reaction?: string
  reactionNonce?: number
  displayAsset?: {
    src: string
    stateLabel: string
  }
  showReactionBubble?: boolean
}

export function CharacterAvatar({ character, mood = 'idle', active, reaction, reactionNonce, displayAsset, showReactionBubble = true }: Props) {
  const config = characterAssets[character]
  const reactionKind = reaction ? reactionKindByValue[reaction] : undefined
  const image = displayAsset?.src ?? (reactionKind ? config.reactions[reactionKind] : config.poses[mood])
  const stateLabel = displayAsset?.stateLabel ?? mood
  return (
    <div className={`avatar avatar--${config.theme} ${active ? 'is-active' : ''}`}>
      {reaction && showReactionBubble && <span className="reaction-bubble" key={`${reaction}-${reactionNonce ?? 0}`}>{reaction}</span>}
      <img src={image} alt={`${config.label} ${stateLabel} 상태`} draggable={false} />
    </div>
  )
}
