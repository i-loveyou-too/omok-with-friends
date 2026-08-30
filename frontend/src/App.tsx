import { useCallback, useEffect, useState } from 'react'
import { EmptyRoom } from './components/EmptyRoom'
import { FindMatchLobby } from './components/FindMatchLobby'
import { FindMatchRoom } from './components/FindMatchRoom'
import { GameRoom } from './components/GameRoom'
import { Lobby } from './components/Lobby'
import { MinigameHub } from './components/MinigameHub'
import { ProfileForm } from './components/ProfileForm'
import { SecretCardLobby } from './components/SecretCardLobby'
import { SecretCardRoom } from './components/SecretCardRoom'
import { CurlingApp } from './games/curling/CurlingApp'
import { YutApp } from './games/yut/YutApp'
import type { Profile, Session } from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? `${APP_BASE}/api`

type Route =
  | { kind: 'hub' }
  | { kind: 'omok' }
  | { kind: 'yut' }
  | { kind: 'curling' }
  | { kind: 'secret-card' }
  | { kind: 'find-match' }
  | { kind: 'omok-room'; roomCode: string | null; invalid: boolean }
  | { kind: 'secret-card-room'; roomCode: string | null; invalid: boolean }
  | { kind: 'find-match-room'; roomCode: string | null; invalid: boolean }

function routeFromPath(): Route {
  const normalized = location.pathname.replace(/\/+$/, '') || '/'
  if (normalized === APP_BASE || normalized === '/') return { kind: 'hub' }
  if (normalized === `${APP_BASE}/omok`) return { kind: 'omok' }
  if (normalized === `${APP_BASE}/yut` || normalized.startsWith(`${APP_BASE}/yut/`)) return { kind: 'yut' }
  if (normalized === `${APP_BASE}/curling` || normalized.startsWith(`${APP_BASE}/curling/`)) return { kind: 'curling' }
  if (normalized === `${APP_BASE}/secret-card`) return { kind: 'secret-card' }
  if (normalized === `${APP_BASE}/find-match`) return { kind: 'find-match' }
  const escaped = APP_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const findMatch = location.pathname.match(new RegExp(`${escaped}/find-match/room/([^/?#]+)`, 'i'))
  const secretMatch = location.pathname.match(new RegExp(`${escaped}/secret-card/room/([^/?#]+)`, 'i'))
  const omokMatch = location.pathname.match(new RegExp(`${escaped}/room/([^/?#]+)`, 'i'))
  const match = findMatch ?? secretMatch ?? omokMatch
  if (!match) return { kind: 'hub' }
  const roomCode = decodeURIComponent(match[1]).trim().toUpperCase()
  const valid = /^[A-Z0-9]{5}$/.test(roomCode)
  if (findMatch) return { kind: 'find-match-room', roomCode: valid ? roomCode : null, invalid: !valid }
  return secretMatch
    ? { kind: 'secret-card-room', roomCode: valid ? roomCode : null, invalid: !valid }
    : { kind: 'omok-room', roomCode: valid ? roomCode : null, invalid: !valid }
}

type RoomRouteKind = 'omok-room' | 'secret-card-room' | 'find-match-room'

function sessionKey(kind: RoomRouteKind, roomCode: string) {
  const game = kind === 'omok-room' ? 'omok' : kind === 'secret-card-room' ? 'secret-card' : 'find-match'
  return `${game}-session-${roomCode}`
}

function savedSession(kind: RoomRouteKind, roomCode: string): Session | null {
  try {
    const value = localStorage.getItem(sessionKey(kind, roomCode))
    return value ? JSON.parse(value) as Session : null
  } catch {
    return null
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromPath)
  const roomRoute = route.kind === 'omok-room' || route.kind === 'secret-card-room' || route.kind === 'find-match-room' ? route : null
  const [roomMissing, setRoomMissing] = useState(Boolean(roomRoute?.invalid))
  const [profile, setProfile] = useState<Profile | null>(() => roomRoute?.roomCode ? savedSession(roomRoute.kind, roomRoute.roomCode) : null)

  const applyRoute = useCallback((next: Route) => {
    setRoute(next)
    const nextRoom = next.kind === 'omok-room' || next.kind === 'secret-card-room' || next.kind === 'find-match-room' ? next : null
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
    const endpoint = roomRoute.kind === 'secret-card-room'
      ? 'secret-card/rooms'
      : roomRoute.kind === 'find-match-room' ? 'find-match/rooms' : 'rooms'
    setRoomMissing(false)
    fetch(`${API_BASE}/${endpoint}/${roomRoute.roomCode}`)
      .then((response) => { if (active && response.status === 404) setRoomMissing(true) })
      .catch(() => undefined)
    return () => { active = false }
  }, [roomRoute?.kind, roomRoute?.roomCode, roomRoute?.invalid])

  const goHub = () => navigate(`${APP_BASE}/`, { kind: 'hub' })
  const goOmok = () => navigate(`${APP_BASE}/omok`, { kind: 'omok' })
  const goYut = () => navigate(`${APP_BASE}/yut/`, { kind: 'yut' })
  const goCurling = () => navigate(`${APP_BASE}/curling/`, { kind: 'curling' })
  const goSecretCard = () => navigate(`${APP_BASE}/secret-card`, { kind: 'secret-card' })
  const goFindMatch = () => navigate(`${APP_BASE}/find-match`, { kind: 'find-match' })
  const enterOmok = (roomCode: string) => navigate(`${APP_BASE}/room/${roomCode}`, { kind: 'omok-room', roomCode, invalid: false })
  const enterSecretCard = (roomCode: string) => navigate(`${APP_BASE}/secret-card/room/${roomCode}`, { kind: 'secret-card-room', roomCode, invalid: false })
  const enterFindMatch = (roomCode: string) => navigate(`${APP_BASE}/find-match/room/${roomCode}`, { kind: 'find-match-room', roomCode, invalid: false })

  const saveSession = useCallback((kind: RoomRouteKind, session: Session) => {
    localStorage.setItem(sessionKey(kind, session.roomCode), JSON.stringify(session))
  }, [])

  const roomHome = roomRoute?.kind === 'secret-card-room' ? goSecretCard : roomRoute?.kind === 'find-match-room' ? goFindMatch : goOmok

  if (roomMissing) return <EmptyRoom onHome={roomHome} />
  if (route.kind === 'hub') return <MinigameHub onOmok={goOmok} onSecretCard={goSecretCard} onYut={goYut} onFindMatch={goFindMatch} onCurling={goCurling} />
  if (route.kind === 'yut') return <YutApp />
  if (route.kind === 'curling') return <CurlingApp />
  if (route.kind === 'omok') return <Lobby onEnter={enterOmok} />
  if (route.kind === 'secret-card') return <SecretCardLobby onEnter={enterSecretCard} onBack={goHub} />
  if (route.kind === 'find-match') return <FindMatchLobby onEnter={enterFindMatch} onBack={goHub} />
  if (!roomRoute?.roomCode) return <EmptyRoom onHome={roomHome} />
  if (!profile) return <ProfileForm roomCode={roomRoute.roomCode} onSubmit={setProfile} onBack={roomHome} />
  if (roomRoute.kind === 'find-match-room') {
    return <FindMatchRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('find-match-room', session)} onLeave={goFindMatch} onRoomMissing={() => setRoomMissing(true)} />
  }
  if (roomRoute.kind === 'secret-card-room') {
    return <SecretCardRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('secret-card-room', session)} onLeave={goSecretCard} onRoomMissing={() => setRoomMissing(true)} />
  }
  return <GameRoom roomCode={roomRoute.roomCode} profile={profile} onSession={(session) => saveSession('omok-room', session)} onLeave={goOmok} onRoomMissing={() => setRoomMissing(true)} />
}
