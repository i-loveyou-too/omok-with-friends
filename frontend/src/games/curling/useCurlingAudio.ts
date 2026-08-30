import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus, CurlingShotResolved, CurlingState } from './types'

export type CurlingSound =
  | 'launch'
  | 'tap'
  | 'impact'
  | 'takeout'
  | 'sweep'
  | 'perfect'
  | 'end'
  | 'tick'
  | 'timeout'
  | 'shootout'
  | 'victory'
  | 'defeat'

interface CurlingAudioOptions {
  state: CurlingState | null
  selfId: string | null
  status: ConnectionStatus
  shot: CurlingShotResolved | null
  shotNonce: number
  sweepActive: boolean
  serverOffsetMs: number
  notice: string | null
}

const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/curling/`
const SOUND_FILES: Record<CurlingSound, { file: string; volume: number }> = {
  launch: { file: 'launch.wav', volume: 0.5 },
  tap: { file: 'tap.wav', volume: 0.5 },
  impact: { file: 'impact.wav', volume: 0.58 },
  takeout: { file: 'takeout.wav', volume: 0.68 },
  sweep: { file: 'sweep-loop.wav', volume: 0.34 },
  perfect: { file: 'perfect.wav', volume: 0.6 },
  end: { file: 'end.wav', volume: 0.5 },
  tick: { file: 'tick.wav', volume: 0.42 },
  timeout: { file: 'timeout.wav', volume: 0.55 },
  shootout: { file: 'shootout.wav', volume: 0.58 },
  victory: { file: 'victory.wav', volume: 0.62 },
  defeat: { file: 'defeat.wav', volume: 0.5 },
}

function mobileVolume(volume: number) {
  return window.matchMedia('(max-width: 760px), (pointer: coarse)').matches ? volume * 0.72 : volume
}

export function useCurlingAudio({
  state,
  selfId,
  status,
  shot,
  shotNonce,
  sweepActive,
  serverOffsetMs,
  notice,
}: CurlingAudioOptions) {
  const soundsRef = useRef(new Map<CurlingSound, HTMLAudioElement>())
  const playedEventIdsRef = useRef(new Set<string>())
  const primedRef = useRef(false)
  const sweepPlayingRef = useRef(false)
  const previousStateRef = useRef<CurlingState | null>(null)
  const previousStatusRef = useRef(status)
  const awaitingReconnectSnapshotRef = useRef(true)
  const reconnectStateRef = useRef<CurlingState | null>(state)
  const timeoutNoticeActiveRef = useRef(false)
  const gameNumberRef = useRef(state?.gameNumber)
  const [localSweepHeld, setLocalSweepHeld] = useState(false)
  gameNumberRef.current = state?.gameNumber

  const stopSweep = useCallback(() => {
    const audio = soundsRef.current.get('sweep')
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    sweepPlayingRef.current = false
  }, [])

  const playOnce = useCallback((sound: Exclude<CurlingSound, 'sweep'>, eventId: string) => {
    if (playedEventIdsRef.current.has(eventId)) return
    playedEventIdsRef.current.add(eventId)
    const audio = soundsRef.current.get(sound)
    if (!audio) return
    audio.currentTime = 0
    audio.dataset.playCount = String(Number(audio.dataset.playCount ?? 0) + 1)
    void audio.play().catch(() => undefined)
  }, [])

  const prime = useCallback(() => {
    if (primedRef.current) return
    primedRef.current = true
    const attempts = Array.from(soundsRef.current.values()).map(async (audio) => {
      audio.muted = true
      try {
        await audio.play()
        audio.pause()
        audio.currentTime = 0
      } catch {
        primedRef.current = false
      } finally {
        audio.muted = false
      }
    })
    void Promise.all(attempts)
  }, [])

  useEffect(() => {
    ;(Object.entries(SOUND_FILES) as Array<[CurlingSound, (typeof SOUND_FILES)[CurlingSound]]>).forEach(([sound, config]) => {
      const audio = new Audio(`${AUDIO_BASE}${config.file}`)
      audio.hidden = true
      audio.preload = 'auto'
      audio.loop = sound === 'sweep'
      audio.volume = mobileVolume(config.volume)
      audio.dataset.curlingSound = sound
      audio.dataset.playCount = '0'
      document.body.appendChild(audio)
      soundsRef.current.set(sound, audio)
    })

    const unlock = () => prime()
    const stopTransientAudio = () => {
      setLocalSweepHeld(false)
      stopSweep()
    }
    const stopWhenHidden = () => {
      if (document.hidden) stopTransientAudio()
    }

    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    window.addEventListener('blur', stopTransientAudio)
    window.addEventListener('pagehide', stopTransientAudio)
    document.addEventListener('visibilitychange', stopWhenHidden)

    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('blur', stopTransientAudio)
      window.removeEventListener('pagehide', stopTransientAudio)
      document.removeEventListener('visibilitychange', stopWhenHidden)
      stopSweep()
      soundsRef.current.forEach((audio) => {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        audio.remove()
      })
      soundsRef.current.clear()
      primedRef.current = false
    }
  }, [prime, stopSweep])

  useEffect(() => {
    const wasConnected = previousStatusRef.current === 'connected'
    if (!wasConnected || status !== 'connected') {
      awaitingReconnectSnapshotRef.current = true
      reconnectStateRef.current = state
    }
    previousStatusRef.current = status
    if (status !== 'connected') {
      setLocalSweepHeld(false)
      stopSweep()
    }
  }, [state, status, stopSweep])

  useEffect(() => {
    if (!state || status !== 'connected') return
    if (awaitingReconnectSnapshotRef.current) {
      if (state === reconnectStateRef.current) return
      awaitingReconnectSnapshotRef.current = false
      previousStateRef.current = state
      return
    }

    const previous = previousStateRef.current
    previousStateRef.current = state
    if (!previous || previous.gameNumber !== state.gameNumber) return

    if (state.activeShot && previous.activeShot?.id !== state.activeShot.id) {
      playOnce('launch', `${state.gameNumber}:shot:${state.activeShot.id}:launch`)
    }
    if (
      state.status === 'end_finished'
      && previous.status !== 'end_finished'
      && state.lastEndResult?.kind === 'end'
    ) {
      playOnce('end', `${state.gameNumber}:end:${state.endNumber}`)
    }
    if (
      state.status === 'shootout'
      && state.shootoutRound === 1
      && previous.status !== 'shootout'
    ) {
      playOnce('shootout', `${state.gameNumber}:shootout:start`)
    }
    if (state.status === 'finished' && previous.status !== 'finished' && state.winnerId) {
      playOnce(
        state.winnerId === selfId ? 'victory' : 'defeat',
        `${state.gameNumber}:finished:${state.winnerId}:${selfId}`,
      )
    }
  }, [playOnce, selfId, state, status])

  useEffect(() => {
    const gameNumber = gameNumberRef.current
    if (!shot || !shotNonce || gameNumber === undefined) return
    const eventBase = `${gameNumber}:shot:${shot.id}`
    if (shot.impactCount > 0) {
      if (shot.maxImpactSpeed >= 260) playOnce('impact', `${eventBase}:impact`)
      else playOnce('tap', `${eventBase}:tap`)
    }
    if (shot.opponentTakeoutCount > 0) playOnce('takeout', `${eventBase}:takeout`)
    if (shot.perfect || shot.landingPoints === 50) playOnce('perfect', `${eventBase}:perfect`)
  }, [playOnce, shot, shotNonce])

  useEffect(() => {
    if (!notice?.startsWith('시간 초과')) {
      timeoutNoticeActiveRef.current = false
      return
    }
    if (timeoutNoticeActiveRef.current || !state) return
    timeoutNoticeActiveRef.current = true
    const playerId = String(state.lastEvent?.playerId ?? 'unknown')
    playOnce(
      'timeout',
      `${state.gameNumber}:timeout:${state.endNumber}:${state.shootoutRound}:${state.throwNumber}:${playerId}`,
    )
  }, [notice, playOnce, state])

  useEffect(() => {
    if (!state || status !== 'connected' || awaitingReconnectSnapshotRef.current) return
    let previousSecond: number | null = null
    const updateTick = () => {
      if (
        !state.turnDeadline
        || state.shotInProgress
        || state.pausedForReconnect
        || !['playing', 'shootout'].includes(state.status)
      ) return
      const second = Math.ceil(Math.max(0, state.turnDeadline - (Date.now() + serverOffsetMs)) / 1000)
      if (second === previousSecond) return
      previousSecond = second
      if (second >= 1 && second <= 5) {
        playOnce('tick', `${state.gameNumber}:turn:${state.turnSerial}:tick:${second}`)
      }
    }
    updateTick()
    const timer = window.setInterval(updateTick, 100)
    return () => window.clearInterval(timer)
  }, [playOnce, serverOffsetMs, state, status])

  const selfIsSweeper = state?.activeShotPlayerId === selfId
  const shouldSweep = status === 'connected'
    && Boolean(state?.shotInProgress)
    && (selfIsSweeper ? localSweepHeld : sweepActive)

  useEffect(() => {
    const audio = soundsRef.current.get('sweep')
    if (!audio) return
    if (!shouldSweep) {
      stopSweep()
      return
    }
    if (sweepPlayingRef.current) return
    sweepPlayingRef.current = true
    audio.currentTime = 0
    audio.dataset.playCount = String(Number(audio.dataset.playCount ?? 0) + 1)
    void audio.play().catch(() => {
      sweepPlayingRef.current = false
    })
  }, [shouldSweep, stopSweep])

  const setSweepHeld = useCallback((active: boolean) => {
    setLocalSweepHeld(active)
    if (!active) stopSweep()
  }, [stopSweep])

  return { setSweepHeld }
}
