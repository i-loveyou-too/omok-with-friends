import { FormEvent, useState } from 'react'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? `${APP_BASE}/api`

interface Props {
  onEnter: (roomCode: string) => void
  onBack: () => void
}

export function SecretCardLobby({ onEnter, onBack }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const createRoom = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/secret-card/rooms`, { method: 'POST' })
      if (!response.ok) throw new Error()
      const data = await response.json() as { roomCode: string }
      onEnter(data.roomCode)
    } catch {
      setError('방을 만들지 못했어요. 서버 연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const join = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(normalized)) {
      setError('5자리 방 코드를 확인해 주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/secret-card/rooms/${normalized}`)
      if (!response.ok) throw new Error()
      onEnter(normalized)
    } catch {
      setError('존재하지 않거나 종료된 비밀카드 방이에요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="secret-lobby page-shell">
      <button className="secret-back" type="button" onClick={onBack}>← 게임방</button>
      <section className="secret-lobby__card">
        <img src={`${import.meta.env.BASE_URL}minigame/secret-card.png`} alt="두근두근 비밀카드" />
        <div>
          <p>2인 · 5판 3선승</p>
          <h1>두근두근 비밀카드</h1>
          <span>내 숫자는 모르고 상대 카드만 보는 아슬아슬 눈치 게임!</span>
          <ul><li>판마다 ⭐ 500 · 라운드 ante 10</li><li>체크 / 콜 / 레이즈 / 다이 / 올인</li><li>선택 시간 20초 · 재접속 유예 30초</li></ul>
        </div>
      </section>
      <section className="secret-lobby__actions">
        <button className="secret-create" type="button" onClick={createRoom} disabled={busy}>{busy ? '방 만드는 중…' : '✦ 방 만들기'}</button>
        <form onSubmit={join}>
          <label htmlFor="secret-room-code">초대받은 방 코드</label>
          <div><input id="secret-room-code" value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5))} placeholder="K3H7P" maxLength={5} autoCapitalize="characters" /><button disabled={busy}>입장</button></div>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}
