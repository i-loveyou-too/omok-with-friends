import { useCallback, useEffect, useRef, useState } from 'react'

export type GameEffect = 'chatBubble' | 'stonePlace' | 'undoRequest'

const MUTE_STORAGE_KEY = 'omok-sound-muted'
const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`
const EFFECTS: Record<GameEffect, { src: string; volume: number }> = {
  chatBubble: { src: `${AUDIO_BASE}chat-pop.wav`, volume: 0.7 },
  stonePlace: { src: `${AUDIO_BASE}stone-place.wav`, volume: 0.72 },
  undoRequest: { src: `${AUDIO_BASE}undo-request.wav`, volume: 0.78 },
}

function savedMutePreference() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true'
}

export function useGameAudio() {
  const [muted, setMuted] = useState(savedMutePreference)
  const [needsGesture, setNeedsGesture] = useState(false)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const mutedRef = useRef(muted)
  const playedIdsRef = useRef(new Set<string>())
  const activeEffectsRef = useRef(new Set<HTMLAudioElement>())
  mutedRef.current = muted

  const startBgm = useCallback(async () => {
    const bgm = bgmRef.current
    if (!bgm || mutedRef.current || !bgm.paused) return
    try {
      await bgm.play()
      setNeedsGesture(false)
    } catch {
      setNeedsGesture(true)
    }
  }, [])

  useEffect(() => {
    const bgm = new Audio(`${AUDIO_BASE}game-bgm.mp3`)
    bgm.loop = true
    bgm.preload = 'metadata'
    bgm.volume = 0.2
    bgmRef.current = bgm

    const unlock = () => { void startBgm() }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    if (!mutedRef.current) void startBgm()

    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      bgm.pause()
      bgm.removeAttribute('src')
      bgm.load()
      bgmRef.current = null
      activeEffectsRef.current.forEach((audio) => {
        audio.pause()
        audio.removeAttribute('src')
      })
      activeEffectsRef.current.clear()
      playedIdsRef.current.clear()
    }
  }, [startBgm])

  useEffect(() => {
    window.localStorage.setItem(MUTE_STORAGE_KEY, String(muted))
    const bgm = bgmRef.current
    if (!bgm) return
    if (muted) {
      bgm.pause()
      setNeedsGesture(false)
    } else {
      void startBgm()
    }
  }, [muted, startBgm])

  const playEffect = useCallback((effect: GameEffect, eventId: string) => {
    if (playedIdsRef.current.has(eventId)) return
    playedIdsRef.current.add(eventId)
    if (mutedRef.current) return

    const config = EFFECTS[effect]
    const audio = new Audio(config.src)
    audio.volume = config.volume
    activeEffectsRef.current.add(audio)
    const release = () => activeEffectsRef.current.delete(audio)
    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener('error', release, { once: true })
    void audio.play().catch(release)
  }, [])

  const toggleMute = useCallback(() => setMuted((value) => {
    const next = !value
    mutedRef.current = next
    if (!next) void startBgm()
    return next
  }), [startBgm])

  return { muted, needsGesture, startBgm, toggleMute, playEffect }
}
