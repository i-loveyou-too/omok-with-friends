import './curling.css'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { characterAssets } from '../../assets/characters/manifest'
import { CharacterAvatar } from '../../components/CharacterAvatar'
import type { CharacterId } from '../../types'
import { curlingConceptAsset } from './assets'
import { CurlingBoard } from './CurlingBoard'
import { useCurlingAudio } from './useCurlingAudio'
import { useCurlingSocket } from './useCurlingSocket'
import type { CurlingProfile, CurlingSession, CurlingState } from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? `${APP_BASE}/api`

function roomFromPath() {
  const escaped = APP_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return location.pathname.match(new RegExp(`${escaped}/curling/room/([A-Z0-9]{5})`, 'i'))?.[1]?.toUpperCase() ?? null
}

function loadSession(code: string): CurlingSession | null {
  try {
    return JSON.parse(sessionStorage.getItem(`curling-session-${code}`) ?? 'null')
  } catch {
    return null
  }
}

function distanceLabel(distance: number | null | undefined, attempted: boolean) {
  if (!attempted) return '—'
  if (distance === null || distance === undefined) return 'MISS'
  return `${Math.round(distance)}`
}

function isShootoutContext(state: CurlingState) {
  return state.status === 'shootout' || state.lastEndResult?.kind === 'shootout'
}

export function CurlingApp() {
  const [roomCode, setRoomCode] = useState(roomFromPath)
  const [profile, setProfile] = useState<CurlingProfile | null>(() => {
    const code = roomFromPath()
    return code ? loadSession(code) : null
  })
  const [roomCheck, setRoomCheck] = useState<'idle' | 'checking' | 'ok' | 'missing' | 'full'>(() => roomFromPath() ? 'checking' : 'idle')

  useEffect(() => {
    const onPop = () => {
      const code = roomFromPath()
      setRoomCode(code)
      setProfile(code ? loadSession(code) : null)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])


  useEffect(() => {
    if (!roomCode) {
      setRoomCheck('idle')
      return
    }
    let active = true
    setRoomCheck('checking')
    fetch(`${API_BASE}/curling/rooms/${roomCode}`)
      .then(async (response) => {
        if (!active) return
        if (response.status === 404) {
          setRoomCheck('missing')
          return
        }
        if (!response.ok) {
          // Do not block play on a transient status-check failure; the WebSocket remains authoritative.
          setRoomCheck('ok')
          return
        }
        const data = await response.json()
        if (!active) return
        setRoomCheck(!data.available && !profile?.token ? 'full' : 'ok')
      })
      .catch(() => { if (active) setRoomCheck('ok') })
    return () => { active = false }
  }, [roomCode, profile?.token])

  const enter = (code: string) => {
    history.pushState({}, '', `${APP_BASE}/curling/room/${code}`)
    setRoomCode(code)
    setProfile(loadSession(code))
  }

  const home = () => {
    if (roomCode) sessionStorage.removeItem(`curling-session-${roomCode}`)
    history.pushState({}, '', `${APP_BASE}/curling/`)
    setRoomCode(null)
    setProfile(null)
  }

  const save = useCallback((session: CurlingSession) => {
    sessionStorage.setItem(`curling-session-${session.roomCode}`, JSON.stringify(session))
  }, [])

  if (!roomCode) return <CurlingLobby onEnter={enter} />
  if (roomCheck === 'checking') return <CurlingRoomCheck />
  if (roomCheck === 'missing' || roomCheck === 'full') return <CurlingUnavailable roomCode={roomCode} kind={roomCheck} onBack={home} />
  if (!profile) return <CurlingProfileForm roomCode={roomCode} onSubmit={setProfile} onBack={home} />
  return <CurlingGame roomCode={roomCode} profile={profile} onSession={save} onLeave={home} />
}


function CurlingRoomCheck() {
  return (
    <main className="curling-page curling-loading">
      <div className="curling-loading__stone">🥌</div>
      <h1>방 확인하는 중…</h1>
      <p>빙판 상태를 보고 있어!</p>
    </main>
  )
}

function CurlingUnavailable({ roomCode, kind, onBack }: { roomCode: string; kind: 'missing' | 'full'; onBack: () => void }) {
  return (
    <main className="curling-page curling-loading">
      <section className="curling-panel curling-unavailable">
        <div className="curling-loading__stone">🥌</div>
        <p className="curling-room-chip">ROOM · {roomCode}</p>
        <h1>{kind === 'missing' ? '앗! 없는 방이야' : '앗! 이미 꽉 찼어'}</h1>
        <p>{kind === 'missing' ? '방 코드가 만료됐거나 존재하지 않아.' : '이미 두 명이 플레이 중인 방이야.'}</p>
        <button className="curling-primary" type="button" onClick={onBack}>컬링 로비로</button>
      </section>
    </main>
  )
}

function CurlingLobby({ onEnter }: { onEnter: (code: string) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/curling/rooms`, { method: 'POST' })
      if (!response.ok) throw new Error()
      const data = await response.json()
      onEnter(data.roomCode)
    } catch {
      setError('컬링 방을 만들지 못했어요.')
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
    <main className="curling-page curling-lobby">
      <section className="curling-panel curling-lobby__card">
        <p className="curling-eyebrow">먼작귀게임방</p>
        <div className="curling-logo" aria-label="쓩! 치이컬링">
          <span>쓩!</span>
          <strong>치이컬링</strong>
          <i>🥌</i>
        </div>
        <p className="curling-lobby__copy">밀고! 막고! 쳐내고!<br />빙판 위에서 한 판 붙자~</p>

        <img className="curling-concept-preview" src={curlingConceptAsset} alt="쓩 치이컬링 캐릭터 스톤 미리보기" />

        <div className="curling-howto">
          <div><b>1</b><span>뒤로 당겨 조준</span></div>
          <div><b>2</b><span>놓으면 쓩! · 싹싹!</span></div>
          <div><b>3</b><span>50·30·20·10점 전부 합산</span></div>
        </div>

        <div className="curling-rule-chips" aria-label="게임 규칙 요약">
          <span>3엔드</span><span>각 3스톤</span><span>20초</span><span>자유 테이크아웃</span>
        </div>

        <button className="curling-primary" type="button" onClick={create} disabled={busy}>
          {busy ? '빙판 준비 중…' : '방 만들기'}
        </button>
        <form className="curling-join" onSubmit={join}>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 5))}
            placeholder="방 코드"
            aria-label="방 코드"
          />
          <button type="submit">입장</button>
        </form>
        {error && <p className="form-error">{error}</p>}
        <a className="curling-back" href={`${APP_BASE}/`}>← 게임방으로</a>
      </section>
    </main>
  )
}

function CurlingProfileForm({
  roomCode,
  onSubmit,
  onBack,
}: {
  roomCode: string
  onSubmit: (profile: CurlingProfile) => void
  onBack: () => void
}) {
  const [nickname, setNickname] = useState('')
  const [character, setCharacter] = useState<CharacterId>('chiikawa')

  return (
    <main className="curling-page curling-profile">
      <form
        className="curling-panel curling-profile__card"
        onSubmit={(event) => {
          event.preventDefault()
          if (nickname.trim()) onSubmit({ nickname: nickname.trim(), character })
        }}
      >
        <button type="button" className="curling-text-button" onClick={onBack}>← 돌아가기</button>
        <p className="curling-room-chip">ROOM · {roomCode}</p>
        <h1>누구랑 쓩~ 할까요?</h1>
        <input
          className="curling-nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value.slice(0, 12))}
          placeholder="닉네임"
          autoFocus
        />
        <div className="curling-character-grid">
          {(Object.keys(characterAssets) as CharacterId[]).map((id) => (
            <button
              type="button"
              key={id}
              className={character === id ? 'selected' : ''}
              onClick={() => setCharacter(id)}
            >
              <CharacterAvatar character={id} />
              <span>{characterAssets[id].label}</span>
            </button>
          ))}
        </div>
        <button className="curling-primary" disabled={!nickname.trim()}>이 방에 들어가기</button>
      </form>
    </main>
  )
}

function CurlingGame({
  roomCode,
  profile,
  onSession,
  onLeave,
}: {
  roomCode: string
  profile: CurlingProfile
  onSession: (session: CurlingSession) => void
  onLeave: () => void
}) {
  const {
    state,
    selfId,
    status,
    error,
    fatalError,
    notice,
    shot,
    shotNonce,
    liveFrame,
    sweepActive,
    serverOffsetMs,
    send,
    leaveRoom,
  } = useCurlingSocket(roomCode, profile, onSession)
  const { setSweepHeld } = useCurlingAudio({
    state,
    selfId,
    status,
    shot,
    shotNonce,
    sweepActive,
    serverOffsetMs,
    notice,
  })
  const [localNow, setLocalNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [feedbackActive, setFeedbackActive] = useState(false)
  const [showRules, setShowRules] = useState(false)

  const handleShoot = useCallback((angle: number, power: number, curl: 'left' | 'straight' | 'right') => {
    return send({ type: 'shoot', angle, power, curl })
  }, [send])

  const handleSweep = useCallback((active: boolean) => {
    setSweepHeld(active)
    if (!send({ type: active ? 'sweep_start' : 'sweep_stop' })) setSweepHeld(false)
  }, [send, setSweepHeld])

  useEffect(() => {
    if ((!state?.turnDeadline && !state?.pausedForReconnect) || state.shotInProgress || !['playing', 'shootout', 'end_finished'].includes(state.status)) return
    setLocalNow(Date.now())
    const timer = window.setInterval(() => setLocalNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [state?.pausedForReconnect, state?.shotInProgress, state?.status, state?.turnDeadline, state?.turnSerial])

  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}${APP_BASE}/curling/room/${roomCode}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (!state && fatalError) {
    return <CurlingUnavailable roomCode={roomCode} kind={fatalError.code === 'room_full' ? 'full' : 'missing'} onBack={onLeave} />
  }

  if (!state) {
    return (
      <main className="curling-page curling-loading">
        <div className="curling-loading__stone">🥌</div>
        <h1>빙판 닦는 중…</h1>
        <p>{status === 'reconnecting' ? '다시 연결하고 있어요.' : '잠깐만!'}</p>
        {error && <div className="toast">{error}</div>}
      </main>
    )
  }

  const self = state.players.find((player) => player.id === selfId)
  const opponent = state.players.find((player) => player.id !== selfId)
  const winner = state.players.find((player) => player.id === state.winnerId)
  const myTurn = state.turnPlayerId === selfId && ['playing', 'shootout'].includes(state.status)
  const canShoot = myTurn && !animating && !state.shotInProgress && !state.pausedForReconnect && status === 'connected'
  const canSweep = state.shotInProgress && state.activeShotPlayerId === selfId && status === 'connected'
  const readyCount = state.rematchReady.length
  const shootoutContext = isShootoutContext(state)

  const turnRemainingMs = state.turnDeadline && !state.shotInProgress
    ? Math.max(0, state.turnDeadline - (localNow + serverOffsetMs))
    : null
  const turnRemainingSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const timerDanger = turnRemainingSeconds !== null && turnRemainingSeconds <= 5
  const reconnectDeadline = opponent ? state.reconnectDeadlines[opponent.id] : undefined
  const reconnectRemainingSeconds = reconnectDeadline
    ? Math.max(0, Math.ceil((reconnectDeadline - (localNow + serverOffsetMs)) / 1000))
    : null

  const attemptedIds = new Set(state.shootoutAttemptedPlayerIds)
  const opponentShootoutAttempted = opponent ? attemptedIds.has(opponent.id) : false
  const opponentShootoutDistance = opponent ? state.shootoutAttempts[opponent.id] : undefined
  const shootoutTargetCopy = opponentShootoutAttempted
    ? opponentShootoutDistance == null
      ? '상대가 MISS! 빙판에 남기기만 해도 유리해!'
      : `상대 기록 ${Math.round(opponentShootoutDistance)} · 더 가까이 붙여봐!`
    : null

  const turnCopy = state.status === 'waiting'
    ? '상대를 기다리고 있어요!'
    : state.pausedForReconnect
      ? `${opponent?.nickname ?? '상대'} 연결을 기다리는 중…`
      : state.status === 'shootout'
      ? myTurn
        ? shootoutTargetCopy ?? '쓩! 한방 승부 — 네 차례!'
        : '쓩! 한방 승부 — 상대 차례'
      : state.status === 'playing'
        ? state.shotInProgress
          ? state.activeShotPlayerId === selfId
            ? sweepActive ? '싹싹싹!! 더 멀리, 더 곧게! 🧹' : '쓩~! 필요하면 싹싹 버튼을 눌러!'
            : `${opponent?.nickname ?? '상대'}의 스톤이 쓩~!`
          : myTurn
            ? '네 차례! 스톤을 뒤로 당겼다가 놓아줘 ✨'
            : `${opponent?.nickname ?? '상대'}가 조준 중…`
        : state.status === 'end_finished'
          ? state.lastEndResult?.kind === 'shootout' ? '한방 승부 결과 확인 중!' : '이번 엔드 결과 확인 중!'
          : winner?.id === selfId ? '우승이다아아! 🎉' : `${winner?.nickname ?? '상대'} 승리!`

  const scoreboard = state.players.map((player) => ({
    ...player,
    isSelf: player.id === selfId,
    throwsUsed: state.throwsUsedByPlayer[player.id] ?? 0,
    throwsRemaining: state.throwsRemainingByPlayer[player.id] ?? 0,
  }))
  const throwLimit = shootoutContext ? 1 : state.stonesPerPlayer

  const leave = async () => {
    if (['playing', 'shootout'].includes(state.status) && !window.confirm('지금 나가면 기권 처리돼. 정말 나갈까?')) return
    await leaveRoom()
    onLeave()
  }

  return (
    <main className="curling-page curling-game">
      <header className="curling-game__header">
        <div className="curling-brand" aria-label="쓩 치이컬링">쓩! 치이컬링</div>
        <div className="curling-room-actions">
          <button type="button" onClick={() => setShowRules(true)}>룰</button>
          <button type="button" onClick={copy}>ROOM {roomCode}</button>
          <button type="button" className="curling-room-actions__leave" onClick={leave}>나가기</button>
          <span>{copied ? '복사했어!' : status === 'connected' ? '● 연결됨' : '○ 재연결 중'}</span>
        </div>
      </header>

      <section className="curling-scorebar" aria-label="점수">
        {scoreboard.map((player) => (
          <div
            key={player.id}
            className={`curling-score-player ${player.isSelf ? 'is-self' : ''} ${!player.connected ? 'is-offline' : ''}`}
          >
            <CharacterAvatar character={player.character} mood={state.winnerId === player.id ? 'win' : 'idle'} />
            <span>
              <small>
                {player.isSelf ? '나' : '상대'}
                {state.starterPlayerId === player.id && <em>선공</em>}
              </small>
              <b>{player.nickname}</b>
            </span>
            <strong>{player.score}</strong>
            <div className="curling-throw-dots" aria-label={`남은 스톤 ${player.throwsRemaining}개`}>
              {Array.from({ length: throwLimit }, (_, index) => (
                <i key={index} className={index < player.throwsUsed ? 'is-used' : ''}>●</i>
              ))}
            </div>
          </div>
        ))}
        <div className="curling-end-chip">
          {shootoutContext
            ? <><small>ONE SHOT</small><b>한방 승부 {state.shootoutRound}</b></>
            : <><small>END</small><b>{state.endNumber} / {state.maxEnds}</b></>}
        </div>
      </section>

      {state.endHistory.length > 0 && (
        <section className="curling-end-history" aria-label="엔드별 점수">
          <b>END SCORE</b>
          {Array.from({ length: state.maxEnds }, (_, index) => {
            const end = state.endHistory.find((item) => item.endNumber === index + 1)
            return (
              <span key={index}>
                <small>{index + 1}</small>
                <strong>{state.players.map((player) => end?.playerPoints[player.id] ?? '·').join(' : ')}</strong>
              </span>
            )
          })}
        </section>
      )}

      <section className={`curling-turn-banner ${timerDanger ? 'is-danger' : ''}`}>
        <div className="curling-turn-banner__main">
          <b>{turnCopy}</b>
          {turnRemainingSeconds !== null && ['playing', 'shootout'].includes(state.status) && !state.shotInProgress && (
            <strong className="curling-turn-timer" aria-label={`남은 시간 ${turnRemainingSeconds}초`}>
              <small>TIME</small>{turnRemainingSeconds}
            </strong>
          )}
        </div>
        {state.status === 'playing' && <span>각자 {state.stonesPerPlayer}개 · {state.turnDurationSeconds}초 · 가드/테이크아웃 전부 자유!</span>}
        {state.status === 'shootout' && <span>각자 독립 1구 · 먼저 던진 스톤은 치울 수 없어 · 중앙에 더 가까우면 승리!</span>}
      </section>

      {state.status === 'waiting' && (
        <section className="curling-waiting-strip">
          <b>ROOM {roomCode}</b>
          <span>링크를 보내고 상대가 들어오면 바로 시작해!</span>
          <button type="button" onClick={copy}>{copied ? '복사 완료!' : '초대 링크 복사'}</button>
        </section>
      )}

      {state.pausedForReconnect && opponent && (
        <section className="curling-reconnect-strip" role="status">
          <CharacterAvatar character={opponent.character} mood="disconnected" />
          <span>
            <b>{opponent.nickname} 다시 연결 중…</b>
            <small>연결이 돌아오면 남은 시간부터 이어서 플레이해.</small>
          </span>
          <strong>{reconnectRemainingSeconds ?? state.reconnectGraceSeconds}</strong>
        </section>
      )}

      {shootoutContext && state.status !== 'finished' && (
        <section className="curling-shootout-record" aria-label="한방 승부 기록">
          {state.players.map((player) => (
            <span key={player.id}>
              <b>{player.id === selfId ? '나' : player.nickname}</b>
              <strong>{distanceLabel(state.shootoutAttempts[player.id], attemptedIds.has(player.id))}</strong>
              <small>{state.shootoutAttempts[player.id] === null && attemptedIds.has(player.id) ? '' : '중앙 거리'}</small>
            </span>
          ))}
        </section>
      )}

      <CurlingBoard
        state={state}
        selfId={selfId}
        shot={shot}
        shotNonce={shotNonce}
        liveFrame={liveFrame}
        canShoot={canShoot}
        canSweep={canSweep}
        sweepActive={sweepActive}
        onAnimatingChange={setAnimating}
        onFeedbackChange={setFeedbackActive}
        onShoot={handleShoot}
        onSweep={handleSweep}
      />

      <footer className="curling-game__footer">
        <p><b>TIP</b> 0점 가드도 살아 있어! 중앙 길목을 막거나 상대 50점을 쳐내봐.</p>
        <button type="button" className="curling-text-button" onClick={leave}>나가기</button>
      </footer>

      {showRules && (
        <div className="curling-rules-backdrop" role="dialog" aria-modal="true" aria-label="쓩 치이컬링 룰">
          <section className="curling-rules-card">
            <button type="button" className="curling-rules-close" onClick={() => setShowRules(false)} aria-label="룰 닫기">×</button>
            <p className="curling-eyebrow">HOW TO PLAY</p>
            <h2>쓩! 치이컬링 룰</h2>
            <div className="curling-rules-grid">
              <span><b>🥌 3 × 3</b><small>3엔드 · 한 사람당 매 엔드 3스톤</small></span>
              <span><b>🎯 50·30·20·10</b><small>스톤 중심이 들어간 링 점수를 전부 합산</small></span>
              <span><b>🛡️ 가드도 살아!</b><small>하우스 밖은 0점이지만 장애물로 계속 남아</small></span>
              <span><b>💥 자유 테이크아웃</b><small>첫 투구부터 상대 스톤을 언제든 쳐낼 수 있어</small></span>
              <span><b>↶ 컬 + 🧹 싹싹</b><small>좌/직진/우 회전, 스위핑은 더 멀고 더 곧게</small></span>
              <span><b>⏰ 20초 · ONE SHOT</b><small>시간 초과는 MISS, 최종 동점은 중앙 거리 1구 승부</small></span>
            </div>
            <button type="button" className="curling-primary" onClick={() => setShowRules(false)}>오케이, 쓩!</button>
          </section>
        </div>
      )}

      {state.status === 'end_finished' && state.lastEndResult && !animating && !feedbackActive && (
        <div className="curling-overlay" role="status">
          <section className="curling-result-card">
            {state.lastEndResult.kind === 'shootout' ? (
              <>
                <span className="curling-result-emoji">🥌</span>
                <h2>{state.lastEndResult.tie ? '헉! 거의 똑같아!' : '한방 승부!'}</h2>
                <div className="curling-shootout-result-grid">
                  {state.players.map((player) => (
                    <span key={player.id}>
                      <b>{player.id === selfId ? '나' : player.nickname}</b>
                      <strong>{distanceLabel(state.lastEndResult?.distances?.[player.id], true)}</strong>
                    </span>
                  ))}
                </div>
                <p>{state.lastEndResult.tie ? '선공을 바꿔서 한 번 더 간다아~' : '중앙에 더 가까운 스톤이 승리!'}</p>
              </>
            ) : (
              <>
                <span className="curling-result-emoji">🎯</span>
                <h2>{state.lastEndResult.winnerId ? '이번 엔드 득점!' : '이번 엔드는 동점!'}</h2>
                <div className="curling-end-points">
                  {state.players.map((player) => (
                    <span key={player.id}>
                      <b>{player.id === selfId ? '나' : player.nickname}</b>
                      <strong>+{state.lastEndResult?.playerPoints?.[player.id] ?? 0}</strong>
                    </span>
                  ))}
                </div>
                <p>
                  {state.endNumber >= state.maxEnds
                    ? '3엔드 누적 점수로 최종 승부를 확인해!'
                    : state.lastEndResult.nextStarterId
                      ? `${state.players.find((player) => player.id === state.lastEndResult?.nextStarterId)?.nickname ?? '다음 플레이어'} 선공으로 다음 엔드!`
                      : '다음 엔드 준비 중!'}
                </p>
              </>
            )}
          </section>
        </div>
      )}

      {state.status === 'finished' && !animating && !feedbackActive && (
        <div className="curling-overlay curling-overlay--final">
          <section className="curling-result-card curling-result-card--final">
            {winner && <CharacterAvatar character={winner.character} mood={winner.id === selfId ? 'win' : 'selected'} />}
            <p className="curling-eyebrow">{state.lastEndResult?.kind === 'shootout' ? 'ONE SHOT WINNER' : 'FINAL SCORE'}</p>
            <h2>{winner?.id === selfId ? '내가 빙판 왕! 🏆' : `${winner?.nickname} 승리!`}</h2>
            <div className="curling-final-score">
              {state.players.map((player) => <span key={player.id}><b>{player.nickname}</b><strong>{player.score}</strong></span>)}
            </div>
            <div className="curling-final-history">
              <span><b>END</b>{state.endHistory.map((end) => <i key={end.endNumber}>{end.endNumber}</i>)}</span>
              {state.players.map((player) => (
                <span key={player.id}><b>{player.nickname}</b>{state.endHistory.map((end) => <i key={end.endNumber}>{end.playerPoints[player.id] ?? 0}</i>)}</span>
              ))}
            </div>
            {state.lastEndResult?.kind === 'shootout' && (
              <p className="curling-final-shootout">누적 동점 → 한방 승부로 결정!</p>
            )}
            <button type="button" className="curling-primary" onClick={() => send({ type: 'rematch_request' })}>
              {state.rematchReady.includes(selfId ?? '') ? `상대 기다리는 중… (${readyCount}/2)` : '재대결!'}
            </button>
            <button type="button" className="curling-text-button" onClick={leave}>게임방으로</button>
          </section>
        </div>
      )}

      {(error || notice) && <div className="toast">{error ?? notice}</div>}
    </main>
  )
}
