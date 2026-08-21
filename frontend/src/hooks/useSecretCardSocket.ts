import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus, GameErrorEvent, PresenceEvent, Profile, ReactionEvent, SecretCardState, Session } from '../types'

type ServerMessage =
  | { type: 'joined'; token: string; playerId: string; reconnected: boolean }
  | { type: 'game_state'; state: SecretCardState }
  | ({ type: 'reaction' } & ReactionEvent)
  | { type: 'presence'; playerId: string; status: 'disconnected' | 'reconnected' }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' | 'card_action_confirmed' | 'round_timeout' | 'reconnect_timeout' | 'auto_advanced'; eventId?: string }

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function websocketUrl(roomCode: string) {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  if (configured) return `${configured.replace(/\/$/, '')}/secret-card/rooms/${roomCode}`
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${APP_BASE}/ws/secret-card/rooms/${roomCode}`
}

export function useSecretCardSocket(roomCode: string, profile: Profile, onSession: (session: Session) => void, onRoomMissing?: () => void) {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const retryRef = useRef<number | undefined>(undefined)
  const reactionTimersRef = useRef(new Map<string, number>())
  const noticeTimerRef = useRef<number | undefined>(undefined)
  const [state, setState] = useState<SecretCardState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [selfId, setSelfId] = useState<string | null>(null)
  const [errorEvent, setErrorEvent] = useState<GameErrorEvent | null>(null)
  const [reactions, setReactions] = useState<ReactionEvent[]>([])
  const [presence, setPresence] = useState<PresenceEvent | null>(null)
  const onSessionRef = useRef(onSession)
  const onRoomMissingRef = useRef(onRoomMissing)
  onSessionRef.current = onSession
  onRoomMissingRef.current = onRoomMissing

  useEffect(() => {
    let active = true
    let attempts = 0
    setState(null)
    setReactions([])

    const connect = () => {
      if (!active) return
      setStatus(attempts ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(websocketUrl(roomCode))
      socketRef.current = socket
      socket.onopen = () => {
        attempts = 0
        setStatus('connected')
        socket.send(JSON.stringify({ type: 'join', nickname: profile.nickname, character: profile.character, token: tokenRef.current }))
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage
        if (message.type === 'joined') {
          tokenRef.current = message.token
          setSelfId(message.playerId)
          onSessionRef.current({ roomCode, nickname: profile.nickname, character: profile.character, token: message.token, playerId: message.playerId })
          if (message.reconnected) setPresence({ playerId: message.playerId, status: 'reconnected', nonce: Date.now() })
        } else if (message.type === 'game_state') {
          setState(message.state)
        } else if (message.type === 'reaction') {
          setReactions((current) => [...current.filter((item) => item.id !== message.id), message])
          const timer = window.setTimeout(() => setReactions((current) => current.filter((item) => item.id !== message.id)), Math.max(0, message.expiresAt - message.createdAt))
          reactionTimersRef.current.set(message.id, timer)
        } else if (message.type === 'presence') {
          setPresence({ ...message, nonce: Date.now() })
          if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
          noticeTimerRef.current = window.setTimeout(() => setPresence(null), 2800)
        } else if (message.type === 'error') {
          if (message.code === 'room_not_found') {
            onRoomMissingRef.current?.()
            socket.close(1000)
            return
          }
          setErrorEvent({ code: message.code, message: message.message, nonce: Date.now() })
          if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
          noticeTimerRef.current = window.setTimeout(() => setErrorEvent(null), 3000)
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
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
      reactionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      reactionTimersRef.current.clear()
      socketRef.current?.close(1000)
    }
  }, [roomCode, profile.nickname, profile.character, profile.token])

  const send = useCallback((payload: object) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
      return true
    }
    setErrorEvent({ code: 'socket_unavailable', message: '연결을 다시 확인하고 있어요.', nonce: Date.now() })
    return false
  }, [])

  return { state, status, selfId, error: errorEvent?.message ?? null, reactions, presence, send }
}
