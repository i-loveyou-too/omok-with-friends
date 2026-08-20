import { useCallback, useEffect, useState } from 'react'
import { GameRoom } from './components/GameRoom'
import { Lobby } from './components/Lobby'
import { ProfileForm } from './components/ProfileForm'
import type { Profile, Session } from './types'

function roomFromPath() {
  return location.pathname.match(/\/omok\/room\/([A-Z0-9]{5})/i)?.[1]?.toUpperCase() ?? null
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
  const [roomCode, setRoomCode] = useState(roomFromPath)
  const [profile, setProfile] = useState<Profile | null>(() => {
    const room = roomFromPath()
    return room ? savedSession(room) : null
  })

  useEffect(() => {
    const onPop = () => {
      const room = roomFromPath()
      setRoomCode(room)
      setProfile(room ? savedSession(room) : null)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const enterRoom = (code: string) => {
    history.pushState({}, '', `/omok/room/${code}`)
    setRoomCode(code)
    setProfile(savedSession(code))
  }

  const goHome = () => {
    history.pushState({}, '', '/omok/')
    setRoomCode(null)
    setProfile(null)
  }

  const saveSession = useCallback((session: Session) => {
    localStorage.setItem(`omok-session-${session.roomCode}`, JSON.stringify(session))
  }, [])

  if (!roomCode) return <Lobby onEnter={enterRoom} />
  if (!profile) return <ProfileForm roomCode={roomCode} onSubmit={setProfile} onBack={goHome} />
  return <GameRoom roomCode={roomCode} profile={profile} onSession={saveSession} onLeave={goHome} />
}

