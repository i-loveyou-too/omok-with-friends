import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConnectionStatus,
  CurlingProfile,
  CurlingSession,
  CurlingShotFrame,
  CurlingShotResolved,
  CurlingState,
} from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function socketUrl(roomCode: string) {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  if (configured) return `${configured.replace(/\/$/, '')}/curling/rooms/${roomCode}`
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${APP_BASE}/ws/curling/rooms/${roomCode}`
}

export function useCurlingSocket(
  roomCode: string,
  profile: CurlingProfile,
  onSession: (session: CurlingSession) => void,
) {
  const socketRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(profile.token)
  const retryRef = useRef<number | undefined>(undefined)
  const intentionalCloseRef = useRef(false)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession

  const [state, setState] = useState<CurlingState | null>(null)
  const [selfId, setSelfId] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [fatalError, setFatalError] = useState<{ code: string; message: string } | null>(null)
  const [shot, setShot] = useState<CurlingShotResolved | null>(null)
  const [shotNonce, setShotNonce] = useState(0)
  const [liveFrame, setLiveFrame] = useState<CurlingShotFrame | null>(null)
  const [sweepActive, setSweepActive] = useState(false)
  const [serverOffsetMs, setServerOffsetMs] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let attempts = 0

    const connect = () => {
      if (!active) return
      intentionalCloseRef.current = false
      setStatus(attempts ? 'reconnecting' : 'connecting')
      const ws = new WebSocket(socketUrl(roomCode))
      socketRef.current = ws

      ws.onopen = () => {
        attempts = 0
        setFatalError(null)
        setStatus('connected')
        ws.send(JSON.stringify({
          type: 'join',
          nickname: profile.nickname,
          character: profile.character,
          token: tokenRef.current,
        }))
      }

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
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
        } else if (message.type === 'game_state') {
          setState(message.state)
          if (typeof message.state.serverNow === 'number') setServerOffsetMs(message.state.serverNow - Date.now())
          if (!message.state.shotInProgress) {
            setLiveFrame(null)
            setSweepActive(false)
          }
        } else if (message.type === 'shot_started') {
          setLiveFrame(message.shot.frame ?? null)
          setSweepActive(false)
        } else if (message.type === 'shot_frame') {
          setLiveFrame(message.frame)
          setSweepActive(Boolean(message.sweeping))
        } else if (message.type === 'sweep_state') {
          setSweepActive(Boolean(message.active))
        } else if (message.type === 'shot_resolved') {
          setShot(message.shot)
          setShotNonce((value) => value + 1)
          setLiveFrame(null)
          setSweepActive(false)
        } else if (message.type === 'turn_timeout') {
          setNotice('시간 초과! 이번 스톤은 미투구 처리됐어 ⏰')
          window.setTimeout(() => setNotice(null), 2200)
        } else if (message.type === 'reconnect_timeout') {
          setNotice('재접속 시간이 지나 경기가 종료됐어.')
          window.setTimeout(() => setNotice(null), 2600)
        } else if (message.type === 'forfeit') {
          setNotice('상대가 나가서 경기가 종료됐어.')
          window.setTimeout(() => setNotice(null), 2200)
        } else if (message.type === 'error') {
          if (message.code === 'room_not_found' || message.code === 'room_full') {
            setFatalError({ code: message.code, message: message.message })
          } else {
            setError(message.message)
            window.setTimeout(() => setError(null), 2800)
          }
        }
      }

      ws.onclose = (event) => {
        if (!active || intentionalCloseRef.current || event.code === 4000) {
          setStatus('disconnected')
          return
        }
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
      socketRef.current?.close(1000)
    }
  }, [roomCode, profile.character, profile.nickname, profile.token])

  const leaveRoom = useCallback(async () => {
    const ws = socketRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    intentionalCloseRef.current = true
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      ws.addEventListener('close', finish, { once: true })
      try {
        ws.send(JSON.stringify({ type: 'leave' }))
      } catch {
        finish()
      }
      window.setTimeout(finish, 350)
    })
  }, [])

  const send = useCallback((payload: object) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError('연결을 다시 확인하고 있어요.')
      return false
    }
    socketRef.current.send(JSON.stringify(payload))
    return true
  }, [])

  return { state, selfId, status, error, fatalError, notice, shot, shotNonce, liveFrame, sweepActive, serverOffsetMs, send, leaveRoom }
}
