import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConnectionStatus,
  GameErrorEvent,
  GameState,
  MoveConfirmedEvent,
  PresenceEvent,
  Profile,
  ReactionEvent,
  Session,
  TurnTimeoutEvent,
  UndoRequestEvent,
  UndoResultEvent,
} from '../types'

type ServerMessage =
  | { type: 'joined'; token: string; playerId: string; reconnected: boolean }
  | { type: 'game_state'; state: GameState }
  | ({ type: 'reaction' } & ReactionEvent)
  | ({ type: 'move_confirmed' } & MoveConfirmedEvent)
  | ({ type: 'undo_requested' } & UndoRequestEvent)
  | ({ type: 'undo_result' } & UndoResultEvent)
  | ({ type: 'turn_timeout' } & TurnTimeoutEvent)
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
  onRoomMissing?: () => void,
) {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const retryRef = useRef<number | undefined>(undefined)
  const reactionTimersRef = useRef(new Map<string, number>())
  const presenceTimerRef = useRef<number | undefined>(undefined)
  const errorTimerRef = useRef<number | undefined>(undefined)
  const seenEventIdsRef = useRef(new Set<string>())
  const [state, setState] = useState<GameState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [selfId, setSelfId] = useState<string | null>(null)
  const [errorEvent, setErrorEvent] = useState<GameErrorEvent | null>(null)
  const [reactions, setReactions] = useState<ReactionEvent[]>([])
  const [presence, setPresence] = useState<PresenceEvent | null>(null)
  const [moveConfirmed, setMoveConfirmed] = useState<MoveConfirmedEvent | null>(null)
  const [undoRequested, setUndoRequested] = useState<UndoRequestEvent | null>(null)
  const [undoResult, setUndoResult] = useState<UndoResultEvent | null>(null)
  const [turnTimeout, setTurnTimeout] = useState<TurnTimeoutEvent | null>(null)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const onRoomMissingRef = useRef(onRoomMissing)
  onRoomMissingRef.current = onRoomMissing

  useEffect(() => {
    let active = true
    let attempts = 0
    seenEventIdsRef.current.clear()
    setReactions([])
    setMoveConfirmed(null)
    setUndoRequested(null)
    setUndoResult(null)
    setTurnTimeout(null)

    const acceptEvent = (id: string) => {
      if (seenEventIdsRef.current.has(id)) return false
      seenEventIdsRef.current.add(id)
      return true
    }

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
          if (!acceptEvent(message.id)) return
          setReactions((current) => [...current, message])
          const lifetime = Math.max(0, message.expiresAt - message.createdAt)
          reactionTimersRef.current.set(message.id, window.setTimeout(() => {
            setReactions((current) => current.filter((item) => item.id !== message.id))
            reactionTimersRef.current.delete(message.id)
          }, lifetime))
        } else if (message.type === 'move_confirmed') {
          if (acceptEvent(message.eventId)) setMoveConfirmed(message)
        } else if (message.type === 'undo_requested') {
          if (acceptEvent(message.requestId)) setUndoRequested(message)
        } else if (message.type === 'undo_result') {
          if (acceptEvent(message.eventId)) setUndoResult(message)
        } else if (message.type === 'turn_timeout') {
          if (acceptEvent(message.eventId)) setTurnTimeout(message)
        } else if (message.type === 'presence') {
          setPresence({ ...message, nonce: Date.now() })
          if (presenceTimerRef.current) window.clearTimeout(presenceTimerRef.current)
          presenceTimerRef.current = window.setTimeout(() => setPresence(null), 2600)
        } else if (message.type === 'error') {
          if (message.code === 'room_not_found') {
            onRoomMissingRef.current?.()
            socket.close(1000)
            return
          }
          setErrorEvent({ code: message.code, message: message.message, nonce: Date.now() })
          if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current)
          errorTimerRef.current = window.setTimeout(() => setErrorEvent(null), 3000)
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
      reactionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      reactionTimersRef.current.clear()
      if (presenceTimerRef.current) window.clearTimeout(presenceTimerRef.current)
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current)
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
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(() => setErrorEvent(null), 3000)
    return false
  }, [])

  return {
    state,
    status,
    selfId,
    error: errorEvent?.message ?? null,
    errorEvent,
    reactions,
    presence,
    moveConfirmed,
    undoRequested,
    undoResult,
    turnTimeout,
    send,
  }
}
