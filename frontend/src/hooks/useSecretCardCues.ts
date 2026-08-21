import { useRef } from 'react'

// Presentation-only trigger points for the secret-card table.
//
// This intentionally does NOT play any audio itself — another branch may be
// wiring up BGM/SFX in parallel, and this hook just gives the UI a single,
// documented place to call into once that lands. Each trigger currently
// no-ops; swap the bodies for `useGameAudio()`-style playback when ready.
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

export function useSecretCardCues() {
  // Ref so callers can fire-and-forget without re-subscribing on every render.
  const trigger = useRef(<K extends SecretCardCue>(_cue: K, _payload: SecretCardCuePayload[K]) => {
    // no-op — hook point only, see file header.
  })
  return trigger.current
}
