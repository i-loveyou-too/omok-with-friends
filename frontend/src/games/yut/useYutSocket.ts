import { useCallback, useEffect, useRef, useState } from 'react'
import type { YutProfile, YutSession, YutState, ConnectionStatus } from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const ACTION_GUARD_MS = 420

function socketUrl(roomCode: string) {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  if (configured) return `${configured.replace(/\/$/, '')}/yut/rooms/${roomCode}`
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${APP_BASE}/ws/yut/rooms/${roomCode}`
}

export function useYutSocket(roomCode: string, profile: YutProfile, onSession: (s: YutSession) => void) {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const retryRef = useRef<number | undefined>(undefined)
  const actionPendingRef = useRef(false)
  const actionSerialRef = useRef(0)
  const actionSentAtRef = useRef(0)
  const actionUnlockRef = useRef<number | undefined>(undefined)
  const [state, setState] = useState<YutState | null>(null)
  const [selfId, setSelfId] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession

  useEffect(() => {
    let active = true
    let attempts = 0
    const connect = () => {
      if (!active) return
      setStatus(attempts ? 'reconnecting' : 'connecting')
      const ws = new WebSocket(socketUrl(roomCode))
      socketRef.current = ws
      ws.onopen = () => {
        attempts = 0
        setStatus('connected')
        ws.send(JSON.stringify({ type: 'join', nickname: profile.nickname, character: profile.character, token: tokenRef.current }))
      }
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'joined') {
          tokenRef.current = message.token
          setSelfId(message.playerId)
          onSessionRef.current({ roomCode, nickname: profile.nickname, character: profile.character, token: message.token, playerId: message.playerId })
        } else if (message.type === 'game_state') {
          if (actionUnlockRef.current) window.clearTimeout(actionUnlockRef.current)
          const guardRemaining = ACTION_GUARD_MS - (performance.now() - actionSentAtRef.current)
          const unlock = () => {
            actionPendingRef.current = false
            setActionPending(false)
          }
          if (guardRemaining > 0) actionUnlockRef.current = window.setTimeout(unlock, guardRemaining)
          else unlock()
          setState(message.state)
        } else if (message.type === 'error') {
          actionPendingRef.current = false
          setActionPending(false)
          setError(message.message)
          window.setTimeout(() => setError(null), 2800)
        }
      }
      ws.onclose = (event) => {
        actionPendingRef.current = false
        setActionPending(false)
        if (!active || event.code === 4000) return setStatus('disconnected')
        attempts += 1
        setStatus('reconnecting')
        retryRef.current = window.setTimeout(connect, Math.min(800 * 2 ** attempts, 6000))
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      active = false
      if (retryRef.current) window.clearTimeout(retryRef.current)
      if (actionUnlockRef.current) window.clearTimeout(actionUnlockRef.current)
      socketRef.current?.close(1000)
    }
  }, [roomCode, profile.nickname, profile.character, profile.token])

  const send = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError('연결을 다시 확인하고 있어요.')
      return false
    }
    if (actionPendingRef.current) return false
    actionPendingRef.current = true
    setActionPending(true)
    actionSentAtRef.current = performance.now()
    actionSerialRef.current += 1
    const actionId = `${Date.now().toString(36)}-${actionSerialRef.current.toString(36)}`
    try {
      socketRef.current.send(JSON.stringify({ ...payload, actionId }))
    } catch {
      actionPendingRef.current = false
      setActionPending(false)
      setError('요청을 보내지 못했어요. 다시 눌러 주세요.')
      return false
    }
    return true
  }, [])

  return { state, selfId, status, error, actionPending, send }
}
