import { useEffect, useRef } from 'react'
import type { SecretCardState } from '../types'
import { useGameAudio, type AudioEffectConfig } from './useGameAudio'

export type SecretCardSound = 'check' | 'call' | 'raise' | 'allIn' | 'fold' | 'myTurn' | 'win' | 'lose' | 'timerWarning'

const CUES = `${import.meta.env.BASE_URL}audio/cues/`
const EFFECTS: Record<SecretCardSound, AudioEffectConfig> = {
  check: { src: `${CUES}check.wav`, volume: 0.6 },
  call: { src: `${CUES}call.wav`, volume: 0.62 },
  raise: { src: `${CUES}raise.wav`, volume: 0.65 },
  allIn: { src: `${CUES}all-in.wav`, volume: 0.72 },
  fold: { src: `${CUES}fold.wav`, volume: 0.55 },
  myTurn: { src: `${CUES}turn-alert.wav`, volume: 0.7 },
  win: { src: `${CUES}win.wav`, volume: 0.75 },
  lose: { src: `${CUES}lose.wav`, volume: 0.65 },
  timerWarning: { src: `${CUES}timer-warning.wav`, volume: 0.6 },
}

const ACTION_SOUND: Partial<Record<string, SecretCardSound>> = {
  check: 'check', call: 'call', raise: 'raise', all_in: 'allIn', fold: 'fold',
}

/**
 * Wires the shared game-room BGM plus secret-card-specific SFX (betting
 * actions, whose turn it is, round/game/match result, low-time warning).
 */
export function useSecretCardAudio(state: SecretCardState | null | undefined, selfId: string | null) {
  const { muted, toggleMute, playEffect } = useGameAudio<SecretCardSound>(EFFECTS)
  const previous = useRef<SecretCardState | null>(null)
  const warnedForDeadline = useRef<number | null>(null)

  useEffect(() => {
    if (!state) return
    const before = previous.current
    previous.current = state
    if (!before) return

    if (before.lastAction !== state.lastAction && state.lastAction) {
      const sound = ACTION_SOUND[state.lastAction.action]
      if (sound) playEffect(sound)
    }

    if (before.turnPlayerId !== selfId && state.turnPlayerId === selfId && state.status === 'playing') {
      playEffect('myTurn')
    }

    const finishedNow = state.status === 'round_finished' || state.status === 'game_finished' || state.status === 'finished'
    const wasFinished = before.status === 'round_finished' || before.status === 'game_finished' || before.status === 'finished'
    if (finishedNow && (!wasFinished || before.status !== state.status)) {
      const winnerId = state.status === 'finished' ? state.matchWinnerId : state.status === 'game_finished' ? state.gameWinnerId : state.roundWinnerId
      playEffect(winnerId === selfId ? 'win' : 'lose')
    }
  }, [state, selfId, playEffect])

  useEffect(() => {
    if (!state?.turnDeadline || state.turnPlayerId !== selfId || state.status !== 'playing') return
    if (warnedForDeadline.current === state.turnDeadline) return
    const msLeft = state.turnDeadline - Date.now()
    const warnAt = msLeft - 5000
    if (warnAt <= 0) return
    const timer = window.setTimeout(() => {
      warnedForDeadline.current = state.turnDeadline
      playEffect('timerWarning')
    }, warnAt)
    return () => window.clearTimeout(timer)
  }, [state?.turnDeadline, state?.turnPlayerId, state?.status, selfId, playEffect])

  return { muted, toggleMute }
}
