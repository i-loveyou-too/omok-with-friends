import {
  characterAssets,
  getDisplayedCharacterAsset,
  reactionKindByValue,
  type CharacterMood,
  type TemporaryCharacterReaction,
} from '../assets/characters/manifest'
import type { CharacterId } from '../types'

interface Props {
  character: CharacterId
  mood?: CharacterMood
  active?: boolean
  reaction?: string
  reactionNonce?: number
  temporaryReaction?: TemporaryCharacterReaction
  awakened?: boolean
  displayAsset?: {
    src: string
    stateLabel: string
  }
  showReactionBubble?: boolean
}

export function CharacterAvatar({ character, mood = 'idle', active, reaction, reactionNonce, temporaryReaction = null, awakened = false, displayAsset, showReactionBubble = true }: Props) {
  const config = characterAssets[character]
  const reactionKind = reaction ? reactionKindByValue[reaction] : undefined
  const displayed = displayAsset
    ? { src: displayAsset.src, stateLabel: displayAsset.stateLabel, awakenedFallback: false }
    : getDisplayedCharacterAsset({ character, mood, temporaryReaction, reaction: reactionKind, awakened })
  return (
    <div className={`avatar avatar--${config.theme} ${active ? 'is-active' : ''} ${awakened ? 'is-awakened' : ''} ${displayed.awakenedFallback ? 'is-awakened-fallback' : ''}`}>
      {reaction && showReactionBubble && <span className="reaction-bubble" key={`${reaction}-${reactionNonce ?? 0}`}>{reaction}</span>}
      <img src={displayed.src} alt={`${config.label} ${displayed.stateLabel} 상태`} draggable={false} />
    </div>
  )
}
