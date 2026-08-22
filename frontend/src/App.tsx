import { useCallback, useEffect, useState } from 'react'
import { EmptyRoom } from './components/EmptyRoom'
import { GameRoom } from './components/GameRoom'
import { Lobby } from './components/Lobby'
import { MinigameHub } from './components/MinigameHub'
import { ProfileForm } from './components/ProfileForm'
import { SecretCardLobby } from './components/SecretCardLobby'
import { SecretCardRoom } from './components/SecretCardRoom'
import { YutApp } from './games/yut/YutApp'
import type { Profile, Session } from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? `${APP_BASE}/api`

type Route =
  | { kind: 'hub' }
  | { kind: 'omok' }
  | { kind: 'yut' }
  | { kind: 'secret-card' }
  | { kind: 'omok-room'; roomCode: string | null; invalid: boolean }
  | { kind: 'secret-card-room'; roomCode: string | null; invalid: boolean }

function routeFromPath(): Route {
  const normalized = location.pathname.replace(/\/+$/, '') || '/'
  if (normalized === APP_BASE || normalized === '/') return { kind: 'hub' }
  if (normalized === `${APP_BASE}/omok`) return { kind: 'omok' }
  if (normalized === `${APP_BASE}/yut` || normalized.startsWith(`${APP_BASE}/yut/`)) return { kind: 'yut' }
  if (normalized === `${APP_BASE}/secret-card`) return { kind: 'secret-card' }
  const escaped = APP_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const secretMatch = location.pathname.match(new RegExp(`${escaped}/secret-card/room/([^/?#]+)`, 'i'))
  const omokMatch = location.pathname.match(new RegExp(`${escaped}/room/([^/?#]+)`, 'i'))
  const match = secretMatch ?? omokMatch
  if (!match) return { kind: 'hub' }
  const roomCode = decodeURIComponent(match[1]).trim().toUpperCase()
  const valid = /^[A-Z0-9]{5}$/.test(roomCode)
  return secretMatch
    ? { kind: 'secret-card-room', roomCode: valid ? roomCode : null, invalid: !valid }
    : { kind: 'omok-room', roomCode: valid ? roomCode : null, invalid: !valid }
}

function sessionKey(kind: 'omok-room' | 'secret-card-room', roomCode: string) {
  return `${kind === 'omok-room' ? 'omok' : 'secret-card'}-session-${roomCode}`
}

function savedSession(kind: 'omok-room' | 'secret-card-room', roomCode: string): Session | null {
  try {
    const value = localStorage.getItem(sessionKey(kind, roomCode))
    return value ? JSON.parse(value) as Session : null
  } catch {
    return null
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromPath)
  const roomRoute = route.kind === 'omok-room' || route.kind === 'secret-card-room' ? route : null
  const [roomMissing, setRoomMissing] = useState(Boolean(roomRoute?.invalid))
  const [profile, setProfile] = useState<Profile | null>(() => roomRoute?.roomCode ? savedSession(roomRoute.kind, roomRoute.roomCode) : null)

  const applyRoute = useCallback((next: Route) => {
    setRoute(next)
    const nextRoom = next.kind === 'omok-room' || next.kind === 'secret-card-room' ? next : null
    setRoomMissing(Boolean(nextRoom?.invalid))
    setProfile(nextRoom?.roomCode ? savedSession(nextRoom.kind, nextRoom.roomCode) : null)
  }, [])

  const navigate = useCallback((path: string, next: Route) => {
    history.pushState({}, '', path)
    applyRoute(next)
  }, [applyRoute])

  useEffect(() => {
    const onPop = () => applyRoute(routeFromPath())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [applyRoute])

  useEffect(() => {
    if (!roomRoute || roomRoute.invalid || !roomRoute.roomCode) return
    let active = true
    const endpoint = roomRoute.kind === 'secret-card-room' ? 'secret-card/rooms' : 'rooms'
    setRoomMissing(false)
    fetch(`${API_BASE}/${endpoint}/${roomRoute.roomCode}`)
      .then((response) => { if (active && response.status === 404) setRoomMissing(true) })
      .catch(() => undefined)
    return () => { active = false }
  }, [roomRoute?.kind, roomRoute?.roomCode, roomRoute?.invalid])

  const goHub = () => navigate(`${APP_BASE}/`, { kind: 'hub' })
  const goOmok = () => navigate(`${APP_BASE}/omok`, { kind: 'omok' })
  const goYut = () => navigate(`${APP_BASE}/yut/`, { kind: 'yut' })
  const goSecretCard = () => navigate(`${APP_BASE}/secret-card`, { kind: 'secret-card' })
  const enterOmok = (roomCode: string) => navigate(`${APP_BASE}/room/${roomCode}`, { kind: 'omok-room', roomCode, invalid: false })
  const enterSecretCard = (roomCode: string) => navigate(`${APP_BASE}/secret-card/room/${roomCode}`, { kind: 'secret-card-room', roomCode, invalid: false })

  const saveSession = useCallback((kind: 'omok-room' | 'secret-card-room', session: Session) => {
    localStorage.setItem(sessionKey(kind, session.roomCode), JSON.stringify(session))
  }, [])

  if (roomMissing) return <EmptyRoom onHome={roomRoute?.kind === 'secret-card-room' ? goSecretCard : goOmok} />
  if (route.kind === 'hub') return <MinigameHub onOmok={goOmok} onSecretCard={goSecretCard} onYut={goYut} />
  if (route.kind === 'yut') return <YutApp />
  if (route.kind === 'omok') return <Lobby onEnter={enterOmok} />
  if (route.kind === 'secret-card') return <SecretCardLobby onEnter={enterSecretCard} onBack={goHub} />
  if (!roomRoute?.roomCode) return <EmptyRoom onHome={roomRoute?.kind === 'secret-card-room' ? goSecretCard : goOmok} />
  if (!profile) return <ProfileForm roomCode={roomRoute.roomCode} onSubmit={setProfile} onBack={roomRoute.kind === 'secret-card-room' ? goSecretCard : goOmok} />
  if (roomRoute.kind === 'secret-card-room') {
    return <SecretCardRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('secret-card-room', session)} onLeave={goSecretCard} onRoomMissing={() => setRoomMissing(true)} />
  }
  return <GameRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('omok-room', session)} onLeave={goOmok} onRoomMissing={() => setRoomMissing(true)} />
}
