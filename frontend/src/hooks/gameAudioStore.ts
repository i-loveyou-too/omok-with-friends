/**
 * Module-level singleton for the shared game-room BGM (frontend/public/audio/game-bgm.mp3).
 *
 * The <audio> element and the mute flag live here, at module scope, instead of inside a
 * React component. That's the whole trick: React components (GameRoom, SecretCardRoom, the
 * yut app) mount and unmount as the user navigates between hub / omok / secret-card / yut,
 * but this element never gets torn down and recreated on that navigation, so playback never
 * restarts from 0 and never doubles up — and the ON/OFF flag is one shared value everywhere.
 */

const BGM_SRC = `${import.meta.env.BASE_URL}audio/game-bgm.mp3`
const MUTE_KEY = 'game-bgm-muted'
const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (pointer: coarse)').matches

let bgmEl: HTMLAudioElement | null = null
let muted = typeof window !== 'undefined' && window.localStorage.getItem(MUTE_KEY) === 'true'
let gestureUnlockAttached = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

function ensureBgmElement(): HTMLAudioElement | null {
  if (bgmEl || typeof window === 'undefined') return bgmEl
  const el = new Audio(BGM_SRC)
  el.loop = true
  el.preload = 'auto'
  el.volume = isMobile() ? 0.14 : 0.22
  bgmEl = el
  return el
}

function attemptPlay(): void {
  const el = ensureBgmElement()
  if (!el || muted || !el.paused) return
  void el.play().catch(() => undefined)
}

function attachGestureUnlock(): void {
  if (gestureUnlockAttached || typeof window === 'undefined') return
  gestureUnlockAttached = true
  const unlock = () => attemptPlay()
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

/** Call while a screen wants the shared BGM active. Safe to call many times (e.g. once per
 * mounted room) — it never restarts playback that's already running. Returns an unsubscribe
 * function; call it on unmount (playback itself is left running for the next screen). */
export function subscribeGameBgm(onMuteChange?: () => void): () => void {
  attachGestureUnlock()
  attemptPlay()
  if (onMuteChange) listeners.add(onMuteChange)
  return () => {
    if (onMuteChange) listeners.delete(onMuteChange)
  }
}

/** Nudge playback again (e.g. before firing a one-shot SFX) without subscribing. */
export function playGameBgm(): void {
  attachGestureUnlock()
  attemptPlay()
}

export function isGameBgmMuted(): boolean {
  return muted
}

export function toggleGameBgmMute(): void {
  muted = !muted
  if (typeof window !== 'undefined') window.localStorage.setItem(MUTE_KEY, String(muted))
  if (muted) bgmEl?.pause()
  else attemptPlay()
  notify()
}
