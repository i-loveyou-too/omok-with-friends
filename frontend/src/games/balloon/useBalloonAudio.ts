import { useCallback, useEffect, useRef } from 'react'
import { useGameAudio, type GameEffect } from '../../hooks/useGameAudio'
import type { BalloonState } from './types'

function pumpEffect(pumpCount: number): GameEffect {
  if (pumpCount >= 45) return 'balloonPumpCritical'
  if (pumpCount >= 30) return 'balloonPumpDanger'
  return 'balloonPump'
}

export function useBalloonAudio() {
  const audio = useGameAudio({ bgm: false, effectSet: 'balloon' })
  const previousStateRef = useRef<BalloonState | null>(null)
  const turnTimerRef = useRef<number | undefined>(undefined)
  const winTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (turnTimerRef.current) window.clearTimeout(turnTimerRef.current)
    if (winTimerRef.current) window.clearTimeout(winTimerRef.current)
  }, [])

  const playPump = useCallback((balloonId: string, pumpCount: number) => {
    audio.playEffect(
      pumpEffect(pumpCount),
      `balloon:${balloonId}:pump:${pumpCount}`,
    )
  }, [audio.playEffect])

  const observeState = useCallback((next: BalloonState) => {
    const previous = previousStateRef.current
    previousStateRef.current = next
    if (!previous) return

    if (
      previous.balloon
      && next.balloon
      && previous.balloon.balloonId === next.balloon.balloonId
      && next.balloon.pumpCount > previous.balloon.pumpCount
    ) {
      for (let count = previous.balloon.pumpCount + 1; count <= next.balloon.pumpCount; count += 1) {
        playPump(next.balloon.balloonId, count)
      }
    }

    const outcome = next.lastOutcome
    const outcomeChanged = Boolean(outcome && outcome.turnId !== previous.lastOutcome?.turnId)
    if (outcomeChanged && outcome) {
      if (outcome.kind === 'pop') {
        if (previous.balloon) {
          playPump(previous.balloon.balloonId, previous.balloon.pumpCount + 1)
        }
        audio.playEffect('balloonBurst', `balloon:${outcome.turnId}:burst`)
      } else {
        audio.playEffect('balloonBank', `balloon:${outcome.turnId}:bank`)
      }
    }

    if (
      previous.turn?.turnId
      && next.turn?.turnId
      && previous.turn.turnId !== next.turn.turnId
      && next.status === 'playing'
    ) {
      if (turnTimerRef.current) window.clearTimeout(turnTimerRef.current)
      const delay = outcomeChanged ? (outcome?.kind === 'pop' ? 420 : 180) : 0
      turnTimerRef.current = window.setTimeout(() => {
        audio.playEffect('balloonTurnChange', `balloon:${next.turn?.turnId}:turn-change`)
      }, delay)
    }

    if (previous.status !== 'finished' && next.status === 'finished' && next.winnerId) {
      if (winTimerRef.current) window.clearTimeout(winTimerRef.current)
      winTimerRef.current = window.setTimeout(() => {
        audio.playEffect(
          'balloonWin',
          `balloon:${next.turn?.turnId ?? next.turnNumber}:win:${next.winnerId}`,
        )
      }, next.lastOutcome?.kind === 'bank' ? 360 : 0)
    }
  }, [audio.playEffect, playPump])

  const playCountdown = useCallback((turnId: string, second: number) => {
    if (second < 1 || second > 3) return
    audio.playEffect('balloonCountdown', `balloon:${turnId}:countdown:${second}`)
  }, [audio.playEffect])

  const resetObservedState = useCallback(() => {
    previousStateRef.current = null
    if (turnTimerRef.current) window.clearTimeout(turnTimerRef.current)
    if (winTimerRef.current) window.clearTimeout(winTimerRef.current)
  }, [])

  return {
    ...audio,
    observeState,
    playPump,
    playCountdown,
    resetObservedState,
  }
}
