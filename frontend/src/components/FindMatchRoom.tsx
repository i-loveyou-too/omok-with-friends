import { useEffect, useMemo, useRef, useState } from 'react'
import type { Profile, Session } from '../types'
import { useFindMatchSocket } from '../hooks/useFindMatchSocket'
import {
  DIFFICULTIES,
  findMatchAsset,
  findMatchCharacterSrc,
  symbolSrc,
  type FindMatchDifficulty,
} from '../games/findMatch/manifest'
import { layoutFor } from '../games/findMatch/layouts'

interface Props {
  roomCode: string
  profile: Profile
  onSession: (session: Session) => void
  onLeave: () => void
  onRoomMissing: () => void
}

export function FindMatchRoom({ roomCode, profile, onSession, onLeave, onRoomMissing }: Props) {
  const { state, status, selfId, error, notice, lockedUntil, lastWinnerId, send } = useFindMatchSocket(
    roomCode,
    profile,
    onSession,
    onRoomMissing,
  )
  const [now, setNow] = useState(Date.now())
  const [copied, setCopied] = useState(false)
  const preparedRound = useRef('')
  const preparingRound = useRef('')

  const round = state?.round
  useEffect(() => {
    if (!round || round.resolved || preparedRound.current === round.roundId || preparingRound.current === round.roundId || status !== 'connected') return
    let active = true
    preparingRound.current = round.roundId
    const sources = [...new Set([...round.left, ...round.right].map(symbolSrc))].filter(Boolean)
    Promise.all(sources.map((source) => new Promise<void>((resolve) => {
      const image = new Image()
      image.onload = image.onerror = () => resolve()
      image.src = source
    }))).then(() => {
      if (!active) return
      if (send({ type: 'round_ready', roundId: round.roundId })) preparedRound.current = round.roundId
      preparingRound.current = ''
    })
    return () => {
      active = false
      if (preparingRound.current === round.roundId) preparingRound.current = ''
    }
  }, [round?.roundId, round?.resolved, status, send])

  useEffect(() => {
    const revealAt = round?.revealedAt
    if (!revealAt) return
    const tick = () => setNow(Date.now())
    tick()
    if (Date.now() >= revealAt) return
    const timer = window.setInterval(() => {
      tick()
      if (Date.now() >= revealAt) window.clearInterval(timer)
    }, 40)
    return () => window.clearInterval(timer)
  }, [round?.roundId, round?.revealedAt])

  const me = state?.players.find((player) => player.id === selfId)
  const other = state?.players.find((player) => player.id !== selfId)
  const revealed = Boolean(round?.revealedAt && now >= round.revealedAt)
  const canGuess = Boolean(status === 'connected' && revealed && round && !round.resolved && Date.now() >= lockedUntil)
  const matchPoint = state ? Math.max(...state.players.map((player) => player.score), 0) === state.winTarget - 1 : false
  const finalRound = state ? state.players.length === 2 && state.players.every((player) => player.score === state.winTarget - 1) : false
  const countdown = round?.revealedAt ? Math.max(0, Math.ceil((round.revealedAt - now) / 1000)) : 0
  const difficultyChangeAllowed = Boolean(round?.resolved && state?.status === 'playing' && !state.pendingDifficulty)

  const leave = () => {
    send({ type: 'leave' })
    onLeave()
  }
  const guess = (symbolId: string) => {
    if (canGuess && round) send({ type: 'guess', symbolId, roundId: round.roundId })
  }
  const requestDifficulty = (difficulty: FindMatchDifficulty) => {
    if (difficultyChangeAllowed) send({ type: 'difficulty_request', difficulty })
  }
  const copyInvite = async () => {
    const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}find-match/room/${roomCode}`
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  if (!state || !me) {
    return (
      <main className="find-match-room find-match-room--loading">
        <img src={findMatchAsset('magnifier')} alt="" />
        <b>{error ? '방에 들어가지 못했어요.' : status === 'reconnecting' ? '다시 연결하고 있어요…' : '방에 들어가는 중…'}</b>
        {error && <><small>{error}</small><button type="button" onClick={onLeave}>눈 크게 떠! 메인으로</button></>}
      </main>
    )
  }

  if (state.status === 'waiting') {
    return (
      <main className={`find-match-room find-match-room--waiting theme-${me.character}`}>
        <button className="find-match-back" type="button" onClick={leave}>← 나가기</button>
        <section>
          <img src={findMatchCharacterSrc(me.character, 2)} alt="" />
          <small>눈 크게 떠! 방 코드</small>
          <h1>{roomCode}</h1>
          <b>친구가 들어오길 기다리고 있어요.</b>
          <button type="button" onClick={copyInvite}>{copied ? '초대 주소를 복사했어요' : '초대 주소 복사'}</button>
        </section>
      </main>
    )
  }

  const winner = state.players.find((player) => player.id === state.winnerId)
  const myRematchReady = state.rematchReadyIds.includes(me.id)
  return (
    <main className={`find-match-room theme-${me.character}`}>
      <header className="find-match-scoreboard">
        <button type="button" onClick={leave} aria-label="게임 나가기">←</button>
        <div className="find-match-score">
          <span className={!me.connected ? 'is-offline' : ''}>
            <img src={findMatchCharacterSrc(me.character, lastWinnerId === me.id ? 2 : 1)} alt="" />
            <small>{me.nickname}</small><b>{me.score}</b>
          </span>
          <strong>:</strong>
          <span className={!other?.connected ? 'is-offline' : ''}>
            <b>{other?.score ?? 0}</b><small>{other?.nickname ?? '친구'}</small>
            {other && <img src={findMatchCharacterSrc(other.character, lastWinnerId === other.id ? 2 : 1)} alt="" />}
          </span>
        </div>
        <details className="find-match-options">
          <summary>난이도</summary>
          <div>
            <small>{difficultyChangeAllowed ? '다음 라운드 난이도' : '라운드가 끝나면 변경 가능'}</small>
            {(Object.entries(DIFFICULTIES) as Array<[FindMatchDifficulty, typeof DIFFICULTIES[FindMatchDifficulty]]>).map(([id, difficulty]) => (
              <button key={id} type="button" disabled={!difficultyChangeAllowed || id === state.difficulty} onClick={() => requestDifficulty(id)}>{difficulty.label}</button>
            ))}
          </div>
        </details>
      </header>
      <section className="find-match-status" aria-live="polite">
        <span>{DIFFICULTIES[state.difficulty].label} · 카드당 {state.symbolCount}개</span>
        <b>{finalRound ? 'FINAL ROUND' : matchPoint ? 'MATCH POINT' : state.combo.count >= 3 ? `${state.combo.count} COMBO` : `먼저 ${state.winTarget}점`}</b>
        <span>ROUND {state.roundNumber}</span>
      </section>
      {round && (
        <div className={`find-match-board ${!revealed ? 'is-concealed' : ''} ${lockedUntil > Date.now() ? 'is-locked' : ''} ${lastWinnerId ? 'has-result' : ''}`}>
          <MatchCard side="left" ids={round.left} difficulty={state.difficulty} roundNumber={state.roundNumber} onGuess={guess} disabled={!canGuess} />
          <MatchCard side="right" ids={round.right} difficulty={state.difficulty} roundNumber={state.roundNumber} onGuess={guess} disabled={!canGuess} />
          {!round.revealedAt && <div className="find-match-ready">서로의 카드 준비를 기다리는 중…</div>}
        </div>
      )}
      {countdown > 0 && <div className="find-match-countdown" aria-live="assertive">{countdown}</div>}
      {lockedUntil > Date.now() && <div className="find-match-penalty">다시 한번 살펴봐요</div>}
      {lastWinnerId && <div className="find-match-flash">{lastWinnerId === me.id ? '찾았다!' : '아깝다!'}</div>}
      {status === 'reconnecting' && <div className="find-match-toast">연결을 복구하고 있어요…</div>}
      {notice && status !== 'reconnecting' && <div className="find-match-toast">{notice}</div>}
      {state.pendingDifficulty && (
        <div className="find-match-modal" role="dialog" aria-modal="true">
          <div>
            {state.pendingDifficulty.requestedBy === me.id
              ? <><h3>친구의 응답을 기다리고 있어요.</h3><p>{DIFFICULTIES[state.pendingDifficulty.difficulty].label} 난이도로 요청했어요.</p></>
              : <><h3>{DIFFICULTIES[state.pendingDifficulty.difficulty].label} 난이도로 바꿀까요?</h3><button type="button" onClick={() => send({ type: 'difficulty_response', accept: true })}>좋아요</button><button type="button" className="is-secondary" onClick={() => send({ type: 'difficulty_response', accept: false })}>지금대로 할래요</button></>}
          </div>
        </div>
      )}
      {state.status === 'finished' && winner && (
        <div className="find-match-modal" role="dialog" aria-modal="true">
          <div className="find-match-result">
            <img src={findMatchCharacterSrc(winner.character, winner.id === me.id ? 2 : 4)} alt="" />
            <h2>{winner.id === me.id ? '이번 판 승리!' : '다음 판엔 이길 수 있어요!'}</h2>
            <p>{state.players.map((player) => `${player.nickname} ${player.score}점`).join(' : ')}</p>
            <button type="button" disabled={myRematchReady} onClick={() => send({ type: 'rematch_request' })}>{myRematchReady ? '친구를 기다리는 중…' : '한 판 더'}</button>
            <button type="button" className="is-secondary" onClick={leave}>게임방으로</button>
          </div>
        </div>
      )}
    </main>
  )
}

function MatchCard({ side, ids, difficulty, roundNumber, onGuess, disabled }: {
  side: 'left' | 'right'
  ids: string[]
  difficulty: FindMatchDifficulty
  roundNumber: number
  onGuess: (id: string) => void
  disabled: boolean
}) {
  const slots = useMemo(() => layoutFor(difficulty, side, roundNumber), [difficulty, side, roundNumber])
  return (
    <section className={`find-match-card find-match-card--${side}`} aria-label={`${side === 'left' ? '왼쪽' : '오른쪽'} 그림 카드`}>
      {ids.map((id, index) => {
        const slot = slots[index % slots.length]
        const rotation = (roundNumber * 71 + index * 137 + (side === 'right' ? 53 : 0)) % 360
        return (
          <button
            key={`${id}-${index}`}
            type="button"
            data-card-side={side}
            data-symbol-id={id}
            aria-label={`${side === 'left' ? '왼쪽' : '오른쪽'} 카드 그림 ${index + 1}`}
            disabled={disabled}
            onClick={() => onGuess(id)}
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${slot.scale})`,
            }}
          >
            <img src={symbolSrc(id)} alt="" />
          </button>
        )
      })}
    </section>
  )
}
