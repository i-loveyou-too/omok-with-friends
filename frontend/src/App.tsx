import { useCallback, useEffect, useState } from 'react'
import { EmptyRoom } from './components/EmptyRoom'
import { GameRoom } from './components/GameRoom'
import { Lobby } from './components/Lobby'
import { ProfileForm } from './components/ProfileForm'
import type { Profile, Session } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/omok/api'

function roomFromPath(): { roomCode: string | null; invalidRoomPath: boolean } {
  const match = location.pathname.match(/\/omok\/room\/([^/?#]+)/i)
  if (!match) return { roomCode: null, invalidRoomPath: false }
  const candidate = decodeURIComponent(match[1]).trim().toUpperCase()
  if (/^[A-Z0-9]{5}$/.test(candidate)) return { roomCode: candidate, invalidRoomPath: false }
  return { roomCode: null, invalidRoomPath: true }
}

function savedSession(roomCode: string): Session | null {
  try {
    const value = localStorage.getItem(`omok-session-${roomCode}`)
    return value ? JSON.parse(value) as Session : null
  } catch {
    return null
  }
}

export default function App() {
  const [route, setRoute] = useState(roomFromPath)
  const [roomMissing, setRoomMissing] = useState(route.invalidRoomPath)
  const roomCode = route.roomCode
  const [profile, setProfile] = useState<Profile | null>(() => {
    const { roomCode: room } = roomFromPath()
    return room ? savedSession(room) : null
  })

  useEffect(() => {
    const onPop = () => {
      const nextRoute = roomFromPath()
      setRoute(nextRoute)
      setRoomMissing(nextRoute.invalidRoomPath)
      setProfile(nextRoute.roomCode ? savedSession(nextRoute.roomCode) : null)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (route.invalidRoomPath) {
      setRoomMissing(true)
      return
    }
    if (!roomCode) {
      setRoomMissing(false)
      return
    }

    let active = true
    setRoomMissing(false)
    fetch(`${API_BASE}/rooms/${roomCode}`)
      .then((response) => {
        if (active && response.status === 404) setRoomMissing(true)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [route.invalidRoomPath, roomCode])

  const enterRoom = (code: string) => {
    history.pushState({}, '', `/omok/room/${code}`)
    setRoute({ roomCode: code, invalidRoomPath: false })
    setRoomMissing(false)
    setProfile(savedSession(code))
  }

  const goHome = () => {
    history.pushState({}, '', '/omok/')
    setRoute({ roomCode: null, invalidRoomPath: false })
    setRoomMissing(false)
    setProfile(null)
  }

  const saveSession = useCallback((session: Session) => {
    localStorage.setItem(`omok-session-${session.roomCode}`, JSON.stringify(session))
  }, [])

  if (roomMissing) return <EmptyRoom onHome={goHome} />
  if (!roomCode) return <Lobby onEnter={enterRoom} />
  if (!profile) return <ProfileForm roomCode={roomCode} onSubmit={setProfile} onBack={goHome} />
  return <GameRoom roomCode={roomCode} profile={profile} onSession={saveSession} onLeave={goHome} onRoomMissing={() => setRoomMissing(true)} />
}
