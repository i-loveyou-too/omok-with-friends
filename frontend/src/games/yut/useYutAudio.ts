import { useCallback, useEffect, useRef, useState } from 'react'
import type { YutState } from './types'
import { isGameBgmMuted, playGameBgm, subscribeGameBgm, toggleGameBgmMute } from '../../hooks/gameAudioStore'

export type YutSound = 'myTurn' | 'throw' | 'landing' | 'smallResult' | 'bigResult' | 'backdo' | 'luckyCard' | 'jackpotCard' | 'dangerCard' | 'capture' | 'stack' | 'finish' | 'victory'

interface AudioManifest {
  basePath: string
  sfx: Record<YutSound, string | null>
}

const MANIFEST_URL = `${import.meta.env.BASE_URL}assets/yut/audio/manifest.json`
const isMobile = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches

function storedFlag(key: string, fallback: boolean) {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

// BGM itself is the shared singleton in hooks/gameAudioStore (same track and ON/OFF flag as
// the omok and secret-card rooms). Only yut's own SFX cues (manifest-driven) live here.
export function useYutAudio(state: YutState | null, selfId: string | null) {
  const [bgmEnabled, setBgmEnabled] = useState(() => !isGameBgmMuted())
  const [sfxEnabled, setSfxEnabled] = useState(() => storedFlag('yut-sfx-enabled', true))
  const manifest = useRef<AudioManifest | null>(null)
  const sounds = useRef(new Map<string, HTMLAudioElement>())
  const previous = useRef<YutState | null>(null)
  const sfxEnabledRef = useRef(sfxEnabled)

  useEffect(() => { sfxEnabledRef.current = sfxEnabled }, [sfxEnabled])

  useEffect(() => subscribeGameBgm(() => setBgmEnabled(!isGameBgmMuted())), [])

  useEffect(() => {
    let active = true
    fetch(MANIFEST_URL)
      .then((response) => response.ok ? response.json() : null)
      .then((data: AudioManifest | null) => { if (active && data) manifest.current = data })
      .catch(() => undefined)
    return () => {
      active = false
      sounds.current.forEach((audio) => audio.pause())
    }
  }, [])

  const sourceUrl = useCallback((source: string | null | undefined) => {
    if (!source || !manifest.current) return null
    return source.startsWith('/') ? source : `${manifest.current.basePath}${source}`
  }, [])

  const play = useCallback((name: YutSound) => {
    playGameBgm()
    if (!sfxEnabledRef.current) return
    const url = sourceUrl(manifest.current?.sfx[name])
    if (!url) return
    let audio = sounds.current.get(name)
    if (!audio) {
      audio = new Audio(url)
      audio.volume = isMobile() ? 0.24 : 0.48
      sounds.current.set(name, audio)
    }
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
  }, [sourceUrl])

  const toggleBgm = useCallback(() => toggleGameBgmMute(), [])

  const toggleSfx = useCallback(() => {
    setSfxEnabled((enabled) => {
      const next = !enabled
      localStorage.setItem('yut-sfx-enabled', String(next))
      sfxEnabledRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    if (!state) return
    const before = previous.current
    previous.current = state
    if (!before) return

    if (before.turnPlayerId !== selfId && state.turnPlayerId === selfId && state.status === 'playing') {
      play('myTurn')
    }

    const oldEvent = JSON.stringify(before.lastEvent)
    const newEvent = JSON.stringify(state.lastEvent)
    if (oldEvent !== newEvent && state.lastEvent?.type === 'lucky_card') {
      play('luckyCard')
      if (state.lastEvent.tier === '✨') play('jackpotCard')
      if (state.lastEvent.tier === '💀') play('dangerCard')
    }

    const beforePieces = new Map(before.pieces.map((piece) => [`${piece.ownerId}:${piece.id}`, piece]))
    const opponentCaptured = state.pieces.some((piece) => {
      const old = beforePieces.get(`${piece.ownerId}:${piece.id}`)
      return piece.ownerId !== selfId && old && old.location !== 'S' && piece.location === 'S'
    })
    if (opponentCaptured) play('capture')

    const newlyFinished = state.pieces.some((piece) => !beforePieces.get(`${piece.ownerId}:${piece.id}`)?.finished && piece.finished)
    if (newlyFinished) play('finish')

    const stackCount = (snapshot: YutState) => {
      const counts = new Map<string, number>()
      snapshot.pieces.filter((piece) => !piece.finished && !['S', 'F'].includes(piece.location)).forEach((piece) => {
        const key = `${piece.ownerId}:${piece.location}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      })
      return Math.max(0, ...counts.values())
    }
    if (stackCount(state) > stackCount(before)) play('stack')
    if (before.status !== 'finished' && state.status === 'finished' && state.winnerId === selfId) play('victory')
  }, [play, selfId, state])

  return { bgmEnabled, sfxEnabled, play, toggleBgm, toggleSfx }
}
