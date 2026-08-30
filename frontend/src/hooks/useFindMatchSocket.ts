import { useCallback, useEffect, useRef, useState } from 'react'
import type { Profile, Session } from '../types'
import type { FindMatchConnection, FindMatchState } from '../games/findMatch/types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

type ServerMessage =
  | { type: 'joined'; token: string; playerId: string; reconnected: boolean }
  | { type: 'game_state'; state: FindMatchState }
  | { type: 'guess_result'; correct: boolean; playerId: string; lockMs?: number; lockedUntil?: number }
  | { type: 'presence'; playerId: string; status: 'disconnected' | 'reconnected' }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

function websocketUrl(roomCode: string) {
  const configured = (import.meta.env.VITE_WS_BASE as string | undefined)?.replace(/\/$/, '')
  if (configured) return `${configured}/find-match/rooms/${roomCode}`
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${APP_BASE}/ws/find-match/rooms/${roomCode}`
}

export function useFindMatchSocket(
  roomCode: string,
  profile: Profile,
  onSession: (session: Session) => void,
  onRoomMissing: () => void,
): FindMatchConnection {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const selfIdRef = useRef<string | null>(null)
  const retryRef = useRef<number | undefined>(undefined)
  const lockTimerRef = useRef<number | undefined>(undefined)
  const noticeTimerRef = useRef<number | undefined>(undefined)
  const winnerTimerRef = useRef<number | undefined>(undefined)
  const onSessionRef = useRef(onSession)
  const onRoomMissingRef = useRef(onRoomMissing)
  const [state, setState] = useState<FindMatchState | null>(null)
  const [status, setStatus] = useState<FindMatchConnection['status']>('connecting')
  const [selfId, setSelfId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [lastWinnerId, setLastWinnerId] = useState<string | null>(null)

  onSessionRef.current = onSession
  onRoomMissingRef.current = onRoomMissing

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
        }, 20000)
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
          if (message.reconnected) showNotice('게임에 다시 연결됐어요.')
        } else if (message.type === 'game_state') {
          setState(message.state)
        } else if (message.type === 'guess_result') {
          if (!message.correct && message.playerId === selfIdRef.current) {
            const until = message.lockedUntil ?? Date.now() + (message.lockMs ?? 1200)
            setLockedUntil(until)
            if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current)
            lockTimerRef.current = window.setTimeout(() => setLockedUntil(0), Math.max(0, until - Date.now()) + 20)
          }
          if (message.correct) {
            setLastWinnerId(message.playerId)
            if (winnerTimerRef.current) window.clearTimeout(winnerTimerRef.current)
            winnerTimerRef.current = window.setTimeout(() => setLastWinnerId(null), 1400)
          }
        } else if (message.type === 'presence') {
          const subject = message.playerId === selfIdRef.current ? '내 연결이' : '친구 연결이'
          showNotice(message.status === 'reconnected' ? `${subject} 복구됐어요.` : `${subject} 끊겼어요. 재접속을 기다릴게요.`)
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
          showNotice('다른 화면에서 이 게임에 연결했어요.')
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
      if (pingTimer) window.clearInterval(pingTimer)
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current)
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
      if (winnerTimerRef.current) window.clearTimeout(winnerTimerRef.current)
      socketRef.current?.close(1000)
    }
  }, [roomCode, profile.nickname, profile.character, profile.token, showNotice])

  const send = useCallback((payload: object) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
      return true
    }
    showNotice('연결을 복구하고 있어요. 잠시만 기다려 주세요.')
    return false
  }, [showNotice])

  return { state, status, selfId, error, notice, lockedUntil, lastWinnerId, send }
}
