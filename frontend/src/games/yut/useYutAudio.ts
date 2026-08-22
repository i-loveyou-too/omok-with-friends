import { useCallback, useEffect, useRef, useState } from 'react'
import type { YutState } from './types'

export type YutSound = 'throw' | 'landing' | 'smallResult' | 'bigResult' | 'backdo' | 'luckyCard' | 'jackpotCard' | 'dangerCard' | 'capture' | 'stack' | 'finish' | 'victory'

interface AudioManifest {
  basePath: string
  bgm: string | null
  sfx: Record<YutSound, string | null>
}

const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/yut/audio/`
const MANIFEST_URL = `${AUDIO_BASE}manifest.json`
const isMobile = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches

function storedFlag(key: string, fallback: boolean) {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

export function useYutAudio(state: YutState | null, selfId: string | null) {
  const [bgmEnabled, setBgmEnabled] = useState(() => storedFlag('yut-bgm-enabled', true))
  const [sfxEnabled, setSfxEnabled] = useState(() => storedFlag('yut-sfx-enabled', true))
  const manifest = useRef<AudioManifest | null>(null)
  const sounds = useRef(new Map<string, HTMLAudioElement>())
  const bgm = useRef<HTMLAudioElement | null>(null)
  const previous = useRef<YutState | null>(null)
  const bgmEnabledRef = useRef(bgmEnabled)
  const sfxEnabledRef = useRef(sfxEnabled)

  useEffect(() => { bgmEnabledRef.current = bgmEnabled }, [bgmEnabled])
  useEffect(() => { sfxEnabledRef.current = sfxEnabled }, [sfxEnabled])

  useEffect(() => {
    let active = true
    fetch(MANIFEST_URL)
      .then((response) => response.ok ? response.json() : null)
      .then((data: AudioManifest | null) => { if (active && data) manifest.current = data })
      .catch(() => undefined)
    return () => {
      active = false
      bgm.current?.pause()
      bgm.current?.remove()
      bgm.current = null
      sounds.current.forEach((audio) => audio.pause())
    }
  }, [])

  const sourceUrl = useCallback((source: string | null | undefined) => {
    if (!source || !manifest.current) return null
    return new URL(source, new URL(AUDIO_BASE, window.location.origin)).toString()
  }, [])

  const startBgm = useCallback(() => {
    if (!bgmEnabledRef.current) return
    const url = sourceUrl(manifest.current?.bgm)
    if (!url) return
    if (!bgm.current) {
      bgm.current = new Audio(url)
      bgm.current.dataset.yutBgm = 'true'
      bgm.current.hidden = true
      bgm.current.loop = true
      bgm.current.volume = isMobile() ? 0.12 : 0.22
      document.body.append(bgm.current)
    }
    void bgm.current.play().catch(() => undefined)
  }, [sourceUrl])

  const play = useCallback((name: YutSound) => {
    startBgm()
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
  }, [sourceUrl, startBgm])

  const toggleBgm = useCallback(() => {
    setBgmEnabled((enabled) => {
      const next = !enabled
      localStorage.setItem('yut-bgm-enabled', String(next))
      bgmEnabledRef.current = next
      if (next) window.setTimeout(startBgm, 0)
      else bgm.current?.pause()
      return next
    })
  }, [startBgm])

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
