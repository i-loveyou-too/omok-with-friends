import { useCallback, useEffect, useRef, useState } from 'react'
import { isGameBgmMuted, subscribeGameBgm, toggleGameBgmMute } from './gameAudioStore'

/**
 * Shared game-room audio: subscribes to the single common BGM (see gameAudioStore) plus plays
 * one-shot SFX cues local to whoever calls this hook. The mute flag and the BGM element itself
 * are shared singletons, so omok / secret-card / yut always agree on ON vs OFF and never double
 * up or restart each other's playback when the user navigates between them.
 */

const isMobile = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches

export interface AudioEffectConfig {
  src: string
  volume: number
}

export function useGameAudio<T extends string>(effects: Record<T, AudioEffectConfig>) {
  const [muted, setMuted] = useState(isGameBgmMuted)
  const activeEffectsRef = useRef(new Set<HTMLAudioElement>())

  useEffect(() => {
    const unsubscribe = subscribeGameBgm(() => setMuted(isGameBgmMuted()))
    return () => {
      unsubscribe()
      activeEffectsRef.current.forEach((audio) => {
        audio.pause()
        audio.removeAttribute('src')
      })
      activeEffectsRef.current.clear()
    }
  }, [])

  const playEffect = useCallback((effect: T) => {
    // SFX are intentionally independent of the BGM mute flag — muting the music should never
    // silence stone-place/win/etc. cues. `muted` here only tracks BGM for callers that render
    // a combined toggle button.
    const config = effects[effect]
    if (!config) return
    const audio = new Audio(config.src)
    audio.volume = isMobile() ? config.volume * 0.85 : config.volume
    activeEffectsRef.current.add(audio)
    const release = () => activeEffectsRef.current.delete(audio)
    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener('error', release, { once: true })
    void audio.play().catch(release)
  }, [effects])

  const toggleMute = useCallback(() => toggleGameBgmMute(), [])

  return { muted, toggleMute, playEffect }
}
