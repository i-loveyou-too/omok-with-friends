import { useCallback, useEffect, useRef, useState } from 'react'
import type { Profile, Session } from '../types'
import type { BalloonConnection, BalloonState } from '../games/balloon/types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

type ServerMessage =
  | { type: 'joined'; token: string; playerId: string; reconnected: boolean }
  | { type: 'game_state'; state: BalloonState }
  | { type: 'presence'; playerId: string; status: 'disconnected' | 'reconnected' }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

function websocketUrl(roomCode: string) {
  const configured = (import.meta.env.VITE_WS_BASE as string | undefined)?.replace(/\/$/, '')
  if (configured) return `${configured}/balloon/rooms/${roomCode}`
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${APP_BASE}/ws/balloon/rooms/${roomCode}`
}

export function useBalloonSocket(
  roomCode: string,
  profile: Profile,
  onSession: (session: Session) => void,
  onRoomMissing: () => void,
  onStateMessage?: (state: BalloonState) => void,
): BalloonConnection {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const selfIdRef = useRef<string | null>(null)
  const retryRef = useRef<number | undefined>(undefined)
  const noticeTimerRef = useRef<number | undefined>(undefined)
  const onSessionRef = useRef(onSession)
  const onRoomMissingRef = useRef(onRoomMissing)
  const onStateMessageRef = useRef(onStateMessage)
  const [state, setState] = useState<BalloonState | null>(null)
  const [status, setStatus] = useState<BalloonConnection['status']>('connecting')
  const [selfId, setSelfId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  onSessionRef.current = onSession
  onRoomMissingRef.current = onRoomMissing
  onStateMessageRef.current = onStateMessage

  const showNotice = useCallback((value: string, duration = 2800) => {
    setNotice(value)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), duration)
  }, [])

  useEffect(() => {
    let active = true
    let attempts = 0
    let pingTimer: number | undefined
    setState(null)
    setError(null)

    const connect = () => {
      if (!active) return
      setStatus(attempts ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(websocketUrl(roomCode))
      socketRef.current = socket

      socket.onopen = () => {
        attempts = 0
        setStatus('connected')
        setError(null)
        socket.send(JSON.stringify({
          type: 'join',
          nickname: profile.nickname,
          character: profile.character,
          token: tokenRef.current,
        }))
        if (pingTimer) window.clearInterval(pingTimer)
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }))
        }, 20_000)
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage
        if (message.type === 'joined') {
          tokenRef.current = message.token
          selfIdRef.current = message.playerId
          setSelfId(message.playerId)
          onSessionRef.current({
            roomCode,
            nickname: profile.nickname,
            character: profile.character,
            token: message.token,
            playerId: message.playerId,
          })
          if (message.reconnected) showNotice('게임에 다시 연결됐어요!')
        } else if (message.type === 'game_state') {
          onStateMessageRef.current?.(message.state)
          setState(message.state)
        } else if (message.type === 'presence') {
          if (message.playerId !== selfIdRef.current) {
            showNotice(message.status === 'reconnected'
              ? '친구가 돌아왔어요! 이어서 시작해요.'
              : '친구 연결이 끊겼어요. 타이머를 멈출게요.')
          }
        } else if (message.type === 'error') {
          if (message.code === 'room_not_found') {
            onRoomMissingRef.current()
            socket.close(1000)
            return
          }
          setError(message.message)
          showNotice(message.message, 3200)
        }
      }

      socket.onclose = (event) => {
        if (pingTimer) window.clearInterval(pingTimer)
        if (active && event.code === 4001) {
          setStatus('disconnected')
          setError('다른 화면에서 이 게임에 연결했어요.')
          return
        }
        if (!active || event.code === 4000) {
          setStatus('disconnected')
          return
        }
        attempts += 1
        setStatus('reconnecting')
        retryRef.current = window.setTimeout(connect, Math.min(750 * 2 ** attempts, 8000))
      }
      socket.onerror = () => socket.close()
    }

    connect()
    return () => {
      active = false
      if (retryRef.current) window.clearTimeout(retryRef.current)
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
      if (pingTimer) window.clearInterval(pingTimer)
      socketRef.current?.close(1000)
    }
  }, [roomCode, profile.nickname, profile.character, profile.token, showNotice])

  const send = useCallback((payload: object) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
      return true
    }
    showNotice('연결을 복구하고 있어요.')
    return false
  }, [showNotice])

  return { state, status, selfId, error, notice, send }
}
