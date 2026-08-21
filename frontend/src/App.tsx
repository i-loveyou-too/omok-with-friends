import { useCallback, useEffect, useState } from 'react'
import { GameRoom } from './components/GameRoom'
import { Lobby } from './components/Lobby'
import { MinigameHub } from './components/MinigameHub'
import { ProfileForm } from './components/ProfileForm'
import { SecretCardLobby } from './components/SecretCardLobby'
import { SecretCardRoom } from './components/SecretCardRoom'
import { YutApp } from './games/yut/YutApp'
import type { Profile, Session } from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

type Route =
  | { kind: 'hub' }
  | { kind: 'omok' }
  | { kind: 'yut' }
  | { kind: 'secret-card' }
  | { kind: 'omok-room'; roomCode: string | null }
  | { kind: 'secret-card-room'; roomCode: string | null }

function routeFromPath(): Route {
  const normalized = location.pathname.replace(/\/+$/, '') || '/'
  if (normalized === APP_BASE || normalized === '/') return { kind: 'hub' }
  if (normalized === `${APP_BASE}/omok`) return { kind: 'omok' }
  if (normalized.startsWith(`${APP_BASE}/yut`)) return { kind: 'yut' }
  if (normalized === `${APP_BASE}/secret-card`) return { kind: 'secret-card' }
  const escaped = APP_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const secretMatch = location.pathname.match(new RegExp(`${escaped}/secret-card/room/([A-Z0-9]{5})`, 'i'))
  const omokMatch = location.pathname.match(new RegExp(`${escaped}/room/([A-Z0-9]{5})`, 'i'))
  if (secretMatch) return { kind: 'secret-card-room', roomCode: secretMatch[1].toUpperCase() }
  if (omokMatch) return { kind: 'omok-room', roomCode: omokMatch[1].toUpperCase() }
  return { kind: 'hub' }
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
  const [profile, setProfile] = useState<Profile | null>(() => roomRoute?.roomCode ? savedSession(roomRoute.kind, roomRoute.roomCode) : null)

  const applyRoute = useCallback((next: Route) => {
    setRoute(next)
    const nextRoom = next.kind === 'omok-room' || next.kind === 'secret-card-room' ? next : null
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

  const goHub = () => navigate(`${APP_BASE}/`, { kind: 'hub' })
  const goOmok = () => navigate(`${APP_BASE}/omok`, { kind: 'omok' })
  const goYut = () => navigate(`${APP_BASE}/yut/`, { kind: 'yut' })
  const goSecretCard = () => navigate(`${APP_BASE}/secret-card`, { kind: 'secret-card' })
  const enterOmok = (roomCode: string) => navigate(`${APP_BASE}/room/${roomCode}`, { kind: 'omok-room', roomCode })
  const enterSecretCard = (roomCode: string) => navigate(`${APP_BASE}/secret-card/room/${roomCode}`, { kind: 'secret-card-room', roomCode })

  const saveSession = useCallback((kind: 'omok-room' | 'secret-card-room', session: Session) => {
    localStorage.setItem(sessionKey(kind, session.roomCode), JSON.stringify(session))
  }, [])

  if (route.kind === 'hub') return <MinigameHub onOmok={goOmok} onSecretCard={goSecretCard} onYut={goYut} />
  if (route.kind === 'yut') return <YutApp />
  if (route.kind === 'omok') return <Lobby onEnter={enterOmok} />
  if (route.kind === 'secret-card') return <SecretCardLobby onEnter={enterSecretCard} onBack={goHub} />
  if (!roomRoute?.roomCode) return <MinigameHub onOmok={goOmok} onSecretCard={goSecretCard} onYut={goYut} />
  if (!profile) return <ProfileForm roomCode={roomRoute.roomCode} onSubmit={setProfile} onBack={roomRoute.kind === 'secret-card-room' ? goSecretCard : goOmok} />
  if (roomRoute.kind === 'secret-card-room') {
    return <SecretCardRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('secret-card-room', session)} onLeave={goSecretCard} onRoomMissing={goSecretCard} />
  }
  return <GameRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('omok-room', session)} onLeave={goOmok} />
}
