import { useState, type FormEvent } from 'react'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? `${APP_BASE}/api`

interface Props {
  onEnter: (roomCode: string) => void
  onBack: () => void
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: string }
    return body.message ?? fallback
  } catch {
    return fallback
  }
}

export function BalloonLobby({ onEnter, onBack }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const createRoom = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/balloon/rooms`, { method: 'POST' })
      if (!response.ok) throw new Error(await responseMessage(response, '방을 만들지 못했어요.'))
      const data = await response.json() as { roomCode: string }
      onEnter(data.roomCode)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '오류가 발생했어요.')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault()
    const roomCode = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(roomCode)) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/balloon/rooms/${roomCode}`)
      if (!response.ok) throw new Error(await responseMessage(response, '존재하지 않는 방이에요.'))
      const data = await response.json() as { gameType: string }
      if (data.gameType !== 'balloon') throw new Error('터질까 말까! 방이 아니에요.')
      onEnter(roomCode)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '오류가 발생했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="balloon-lobby page-shell">
      <button className="balloon-back" type="button" onClick={onBack}>← 게임방</button>
      <section className="balloon-lobby__card">
        <div className="balloon-lobby__hero">
          <div className="balloon-lobby__balloon" aria-hidden="true">🎈</div>
          <div>
            <small>둘이서 욕심 대결</small>
            <h1>터질까 말까!</h1>
            <p>펌프를 마구 눌러 점수를 쌓고, 터지기 전에 그만!</p>
          </div>
        </div>
        <div className="balloon-rules" aria-label="게임 규칙">
          <span><b>1</b> 펌프를 다다다다!</span>
          <span><b>2</b> 그만! 누르면 점수 저장</span>
          <span><b>3</b> 팡! 터지면 이번 턴 0점</span>
        </div>
        <div className="balloon-lobby__facts">
          <span>🎯 먼저 100점</span>
          <span>⏱️ 한 턴 12초</span>
          <span>🤫 언제 터질지는 비밀</span>
        </div>
        <button className="balloon-start" type="button" disabled={busy} onClick={createRoom}>
          {busy ? '풍선을 준비하는 중…' : '새 방 만들기'}
        </button>
        <form className="balloon-join" onSubmit={joinRoom}>
          <label htmlFor="balloon-code">친구 방에 들어가기</label>
          <div>
            <input
              id="balloon-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              maxLength={5}
              placeholder="방 코드 5자리"
              autoComplete="off"
            />
            <button type="submit" disabled={busy || code.length !== 5}>입장</button>
          </div>
        </form>
        {error && <p className="balloon-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}
