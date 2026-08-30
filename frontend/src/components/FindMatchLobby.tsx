import { useState, type FormEvent } from 'react'
import { DIFFICULTIES, findMatchAsset, type FindMatchDifficulty } from '../games/findMatch/manifest'

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

export function FindMatchLobby({ onEnter, onBack }: Props) {
  const [difficulty, setDifficulty] = useState<FindMatchDifficulty>('medium')
  const [winTarget, setWinTarget] = useState(10)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const createRoom = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        `${API_BASE}/find-match/rooms?difficulty=${difficulty}&win_target=${winTarget}`,
        { method: 'POST' },
      )
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
      const response = await fetch(`${API_BASE}/find-match/rooms/${roomCode}`)
      if (!response.ok) throw new Error(await responseMessage(response, '존재하지 않는 방이에요.'))
      const data = await response.json() as { gameType: string }
      if (data.gameType !== 'find_match') throw new Error('눈 크게 떠! 방이 아니에요.')
      onEnter(roomCode)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '오류가 발생했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="find-match-lobby page-shell">
      <button className="find-match-back" type="button" onClick={onBack}>← 게임방</button>
      <section className="find-match-lobby__card">
        <div className="find-match-lobby__hero">
          <img src={findMatchAsset('hero')} alt="카메라를 든 하치와레" />
          <div>
            <small>둘이서 동시에 찾기</small>
            <h1>눈 크게 떠!</h1>
            <p>두 카드에서 딱 하나뿐인 같은 그림을 먼저 눌러요.</p>
          </div>
        </div>
        <div className="find-match-rules" aria-label="게임 규칙">
          <span><b>1</b> 두 카드를 살펴보기</span>
          <span><b>2</b> 같은 그림 누르기</span>
          <span><b>3</b> 오답이면 1.2초 쉬기</span>
        </div>
        <fieldset className="find-match-setting">
          <legend>난이도</legend>
          <div>
            {(Object.entries(DIFFICULTIES) as Array<[FindMatchDifficulty, typeof DIFFICULTIES[FindMatchDifficulty]]>).map(([id, value]) => (
              <button key={id} type="button" className={difficulty === id ? 'is-active' : ''} onClick={() => setDifficulty(id)}>
                {value.label}<small>카드당 {value.count}개</small>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="find-match-setting">
          <legend>승리 점수</legend>
          <div>
            {[7, 10, 15].map((target) => (
              <button key={target} type="button" className={winTarget === target ? 'is-active' : ''} onClick={() => setWinTarget(target)}>{target}점</button>
            ))}
          </div>
        </fieldset>
        <button className="find-match-start" type="button" disabled={busy} onClick={createRoom}>
          {busy ? '방을 준비하는 중…' : '새 방 만들기'}
        </button>
        <form className="find-match-join" onSubmit={joinRoom}>
          <label htmlFor="find-match-code">친구 방에 들어가기</label>
          <div>
            <input
              id="find-match-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              maxLength={5}
              placeholder="방 코드 5자리"
              autoComplete="off"
            />
            <button type="submit" disabled={busy || code.length !== 5}>입장</button>
          </div>
        </form>
        {error && <p className="find-match-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}
