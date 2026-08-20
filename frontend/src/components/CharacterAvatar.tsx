import { characterAssets, type CharacterMood } from '../assets/characters/manifest'
import type { CharacterId } from '../types'

interface Props {
  character: CharacterId
  mood?: CharacterMood
  active?: boolean
  reaction?: string
}

export function CharacterAvatar({ character, mood = 'default', active, reaction }: Props) {
  const config = characterAssets[character]
  const image = config.assets[mood] ?? config.assets.default
  return (
    <div className={`avatar avatar--${config.theme} ${active ? 'is-active' : ''}`}>
      {reaction && <span className="reaction-bubble" key={reaction}>{reaction}</span>}
      {image ? (
        <img src={image} alt={config.label} />
      ) : (
        <span className="avatar-placeholder" aria-label={`${config.label} 이미지 자리`}>
          <b>{config.shortLabel}</b>
          <small>{config.label}</small>
        </span>
      )}
    </div>
  )
}

