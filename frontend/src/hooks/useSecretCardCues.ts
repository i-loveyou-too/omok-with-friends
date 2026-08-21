import { useCallback, useRef } from 'react'
import { useGameAudio, type AudioEffectConfig } from './useGameAudio'

// Presentation-trigger points for the secret-card table, wired to the shared
// common SFX system (see gameAudioStore / useGameAudio). Call sites in
// SecretCardRoom already know exactly *when* something happened (an action
// resolved, cards flipped, a round ended, a skill fired, the timer crossed a
// threshold) from diffing server state, so this hook stays the single place
// that turns those moments into sound instead of re-deriving them from state.
export type SecretCardCue =
  | 'onAction'      // check/call/raise/all-in/fold confirmed (mine or opponent's)
  | 'onReveal'      // showdown card flip begins
  | 'onWin'         // round/game/match resolves in the viewer's favor
  | 'onLose'        // round/game/match resolves against the viewer
  | 'onSkill'       // any skill was used (mine or opponent's)
  | 'onCountdown'   // turn timer crosses an urgency threshold (10s/5s/3s)

export type SecretCardCuePayload = {
  onAction: { action: string; self: boolean; amount?: number }
  onReveal: { selfCard: number | null; opponentCard: number | null }
  onWin: { scope: 'round' | 'game' | 'match' }
  onLose: { scope: 'round' | 'game' | 'match' }
  onSkill: { skill: string; self: boolean }
  onCountdown: { secondsLeft: number }
}

type Sound = 'check' | 'call' | 'raise' | 'allIn' | 'fold' | 'win' | 'lose' | 'timerWarning'

const CUES = `${import.meta.env.BASE_URL}audio/cues/`
const EFFECTS: Record<Sound, AudioEffectConfig> = {
  check: { src: `${CUES}check.wav`, volume: 0.6 },
  call: { src: `${CUES}call.wav`, volume: 0.62 },
  raise: { src: `${CUES}raise.wav`, volume: 0.65 },
  allIn: { src: `${CUES}all-in.wav`, volume: 0.72 },
  fold: { src: `${CUES}fold.wav`, volume: 0.55 },
  win: { src: `${CUES}win.wav`, volume: 0.75 },
  lose: { src: `${CUES}lose.wav`, volume: 0.65 },
  timerWarning: { src: `${CUES}timer-warning.wav`, volume: 0.6 },
}

const ACTION_SOUND: Partial<Record<string, Sound>> = {
  check: 'check', call: 'call', raise: 'raise', all_in: 'allIn', fold: 'fold',
}

export function useSecretCardCues() {
  const { muted, toggleMute, playEffect } = useGameAudio<Sound>(EFFECTS)
  // Ref so callers can fire-and-forget without re-subscribing on every render.
  const playEffectRef = useRef(playEffect)
  playEffectRef.current = playEffect

  const trigger = useRef(<K extends SecretCardCue>(cue: K, payload: SecretCardCuePayload[K]) => {
    if (cue === 'onAction') {
      const { action } = payload as SecretCardCuePayload['onAction']
      const sound = ACTION_SOUND[action]
      if (sound) playEffectRef.current(sound)
    } else if (cue === 'onWin') {
      playEffectRef.current('win')
    } else if (cue === 'onLose') {
      playEffectRef.current('lose')
    } else if (cue === 'onCountdown') {
      const { secondsLeft } = payload as SecretCardCuePayload['onCountdown']
      if (secondsLeft <= 5) playEffectRef.current('timerWarning')
    }
    // onReveal / onSkill: no dedicated asset yet — stays a documented no-op hook point.
  })

  return { cue: trigger.current, muted, toggleMute }
}
