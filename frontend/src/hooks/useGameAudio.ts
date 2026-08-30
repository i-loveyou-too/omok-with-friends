import { useCallback, useEffect, useRef, useState } from 'react'

export type GameEffect =
  | 'chatBubble'
  | 'stonePlace'
  | 'undoRequest'
  | 'findMatchReveal'
  | 'findMatchWrong'
  | 'findMatchScore'
  | 'findMatchCombo2'
  | 'findMatchCombo3'
  | 'findMatchVictory'

interface GameAudioOptions {
  bgm?: 'game' | 'chiikawa'
  bgmVolume?: number
  effectSet?: 'common' | 'findMatch'
}

const MUTE_STORAGE_KEY = 'omok-sound-muted'
const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`
const EFFECTS: Record<GameEffect, { src: string; volume: number }> = {
  chatBubble: { src: `${AUDIO_BASE}chat-pop.wav`, volume: 0.7 },
  stonePlace: { src: `${AUDIO_BASE}stone-place.wav`, volume: 0.72 },
  undoRequest: { src: `${AUDIO_BASE}undo-request.wav`, volume: 0.78 },
  findMatchReveal: { src: `${AUDIO_BASE}find-match/round-reveal.wav`, volume: 0.3 },
  findMatchWrong: { src: `${AUDIO_BASE}find-match/wrong.wav`, volume: 0.34 },
  findMatchScore: { src: `${AUDIO_BASE}find-match/score.wav`, volume: 0.44 },
  findMatchCombo2: { src: `${AUDIO_BASE}find-match/combo-2.wav`, volume: 0.48 },
  findMatchCombo3: { src: `${AUDIO_BASE}find-match/combo-3.wav`, volume: 0.52 },
  findMatchVictory: { src: `${AUDIO_BASE}find-match/victory.wav`, volume: 0.58 },
}
const EFFECT_SETS: Record<NonNullable<GameAudioOptions['effectSet']>, GameEffect[]> = {
  common: ['chatBubble', 'stonePlace', 'undoRequest'],
  findMatch: ['findMatchReveal', 'findMatchWrong', 'findMatchScore', 'findMatchCombo2', 'findMatchCombo3', 'findMatchVictory'],
}

function savedMutePreference() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true'
}

export function useGameAudio({ bgm = 'game', bgmVolume = 0.2, effectSet = 'common' }: GameAudioOptions = {}) {
  const [muted, setMuted] = useState(savedMutePreference)
  const [needsGesture, setNeedsGesture] = useState(false)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const mutedRef = useRef(muted)
  const playedIdsRef = useRef(new Set<string>())
  const effectsRef = useRef(new Map<GameEffect, HTMLAudioElement>())
  const activeEffectsRef = useRef(new Set<HTMLAudioElement>())
  const effectsPrimedRef = useRef(false)
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

  const primeEffects = useCallback(() => {
    if (mutedRef.current || effectsPrimedRef.current) return
    effectsPrimedRef.current = true
    const attempts: Array<Promise<boolean>> = []
    effectsRef.current.forEach((audio) => {
      audio.muted = true
      attempts.push(audio.play().then(() => {
        audio.pause()
        audio.currentTime = 0
        audio.muted = false
        return true
      }).catch(() => {
        audio.muted = false
        return false
      }))
    })
    void Promise.all(attempts).then((results) => {
      if (results.some((succeeded) => !succeeded)) effectsPrimedRef.current = false
    })
  }, [])

  useEffect(() => {
    const bgmFile = bgm === 'chiikawa' ? 'chiikawa-exercise-bgm.mp3' : 'game-bgm.mp3'
    const bgmAudio = new Audio(`${AUDIO_BASE}${bgmFile}`)
    bgmAudio.dataset.gameBgm = bgm
    bgmAudio.hidden = true
    bgmAudio.loop = true
    bgmAudio.preload = 'metadata'
    bgmAudio.volume = bgmVolume
    if (effectSet === 'findMatch') document.body.appendChild(bgmAudio)
    bgmRef.current = bgmAudio

    if (effectSet === 'findMatch') {
      EFFECT_SETS[effectSet].forEach((effect) => {
        const config = EFFECTS[effect]
        const audio = new Audio(config.src)
        audio.dataset.gameEffect = effect
        audio.dataset.playCount = '0'
        audio.hidden = true
        audio.preload = 'auto'
        audio.volume = config.volume
        document.body.appendChild(audio)
        effectsRef.current.set(effect, audio)
      })
    }

    const unlock = () => {
      primeEffects()
      void startBgm()
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    if (!mutedRef.current) void startBgm()

    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      bgmAudio.pause()
      bgmAudio.removeAttribute('src')
      bgmAudio.load()
      bgmAudio.remove()
      bgmRef.current = null
      effectsRef.current.forEach((audio) => {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        audio.remove()
      })
      effectsRef.current.clear()
      activeEffectsRef.current.forEach((audio) => {
        audio.pause()
        audio.removeAttribute('src')
      })
      activeEffectsRef.current.clear()
      effectsPrimedRef.current = false
    }
  }, [bgm, bgmVolume, effectSet, primeEffects, startBgm])

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

    const reusedAudio = effectsRef.current.get(effect)
    if (reusedAudio) {
      reusedAudio.currentTime = 0
      reusedAudio.dataset.playCount = String(Number(reusedAudio.dataset.playCount ?? 0) + 1)
      void reusedAudio.play().catch(() => undefined)
      return
    }

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
