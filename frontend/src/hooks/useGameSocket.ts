import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus, GameState, PresenceEvent, Profile, ReactionEvent, Session } from '../types'

type ServerMessage =
  | { type: 'joined'; token: string; playerId: string; reconnected: boolean }
  | { type: 'game_state'; state: GameState }
  | { type: 'reaction'; playerId: string; value: string }
  | { type: 'presence'; playerId: string; status: 'disconnected' | 'reconnected' }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

function websocketUrl(roomCode: string) {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  if (configured) return `${configured.replace(/\/$/, '')}/rooms/${roomCode}`
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/omokwithfriend/ws/rooms/${roomCode}`
}

export function useGameSocket(
  roomCode: string,
  profile: Profile,
  onSession: (session: Session) => void,
) {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const retryRef = useRef<number | undefined>(undefined)
  const reactionTimerRef = useRef<number | undefined>(undefined)
  const presenceTimerRef = useRef<number | undefined>(undefined)
  const [state, setState] = useState<GameState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [selfId, setSelfId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reaction, setReaction] = useState<ReactionEvent | null>(null)
  const [presence, setPresence] = useState<PresenceEvent | null>(null)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession

  useEffect(() => {
    let active = true
    let attempts = 0

    const connect = () => {
      if (!active) return
      setStatus(attempts ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(websocketUrl(roomCode))
      socketRef.current = socket

      socket.onopen = () => {
        attempts = 0
        setStatus('connected')
        socket.send(JSON.stringify({
          type: 'join',
          nickname: profile.nickname,
          character: profile.character,
          token: tokenRef.current,
        }))
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage
        if (message.type === 'joined') {
          tokenRef.current = message.token
          setSelfId(message.playerId)
          onSessionRef.current({
            roomCode,
            nickname: profile.nickname,
            character: profile.character,
            token: message.token,
            playerId: message.playerId,
          })
          if (message.reconnected) {
            setPresence({ playerId: message.playerId, status: 'reconnected', nonce: Date.now() })
            if (presenceTimerRef.current) window.clearTimeout(presenceTimerRef.current)
            presenceTimerRef.current = window.setTimeout(() => setPresence(null), 2600)
          }
        } else if (message.type === 'game_state') {
          setState(message.state)
        } else if (message.type === 'reaction') {
          setReaction({ ...message, nonce: Date.now() })
          if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current)
          reactionTimerRef.current = window.setTimeout(() => setReaction(null), 2600)
        } else if (message.type === 'presence') {
          setPresence({ ...message, nonce: Date.now() })
          if (presenceTimerRef.current) window.clearTimeout(presenceTimerRef.current)
          presenceTimerRef.current = window.setTimeout(() => setPresence(null), 2600)
        } else if (message.type === 'error') {
          setError(message.message)
          window.setTimeout(() => setError(null), 3000)
        }
      }
      socket.onclose = (event) => {
        if (!active || event.code === 4000) {
          setStatus('disconnected')
          return
        }
        attempts += 1
        setStatus('reconnecting')
        retryRef.current = window.setTimeout(connect, Math.min(1000 * 2 ** attempts, 8000))
      }
      socket.onerror = () => socket.close()
    }

    connect()
    return () => {
      active = false
      if (retryRef.current) window.clearTimeout(retryRef.current)
      if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current)
      if (presenceTimerRef.current) window.clearTimeout(presenceTimerRef.current)
      socketRef.current?.close(1000)
    }
  }, [roomCode, profile.nickname, profile.character, profile.token])

  const send = useCallback((payload: object) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
      return true
    }
    setError('연결을 다시 확인하고 있어요.')
    return false
  }, [])

  return { state, status, selfId, error, reaction, presence, send }
}
