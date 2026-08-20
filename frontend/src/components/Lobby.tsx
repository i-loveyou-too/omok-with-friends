import { FormEvent, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/omok/api'

interface Props {
  onEnter: (roomCode: string) => void
}

export function Lobby({ onEnter }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const createRoom = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/rooms`, { method: 'POST' })
      if (!response.ok) throw new Error()
      const data = await response.json() as { roomCode: string }
      onEnter(data.roomCode)
    } catch {
      setError('방을 만들지 못했어요. 서버 연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const join = (event: FormEvent) => {
    event.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(normalized)) {
      setError('5자리 방 코드를 확인해 주세요.')
      return
    }
    onEnter(normalized)
  }

  return (
    <main className="lobby page-shell">
      <div className="cloud cloud--one" />
      <div className="cloud cloud--two" />
      <section className="lobby-card">
        <div className="mini-flower" aria-hidden="true">✿</div>
        <p className="eyebrow">친구와 실시간으로</p>
        <h1>오목 한 판<span>?</span></h1>
        <p className="lobby-copy">초대 링크 하나면 준비 끝.<br />천천히, 귀엽게, 제대로 한 판!</p>
        <button className="primary-button" onClick={createRoom} disabled={busy}>
          <span>＋</span> {busy ? '방 만드는 중…' : '방 만들기'}
        </button>
        <div className="or"><span>또는</span></div>
        <form className="code-form" onSubmit={join}>
          <label htmlFor="room-code">방 코드로 입장</label>
          <div>
            <input
              id="room-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5))}
              placeholder="K3H7P"
              autoCapitalize="characters"
              maxLength={5}
            />
            <button type="submit" aria-label="입장하기">→</button>
          </div>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <div className="meadow" aria-hidden="true"><span>✿</span><span>✾</span><span>✿</span></div>
    </main>
  )
}

