import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Profile, Session } from '../types'
import { CharacterAvatar } from './CharacterAvatar'
import { useBalloonAudio } from '../games/balloon/useBalloonAudio'
import { useBalloonSocket } from '../hooks/useBalloonSocket'
import { useTurnCountdown } from '../hooks/useTurnCountdown'

interface Props {
  roomCode: string
  profile: Profile
  onSession: (session: Session) => void
  onLeave: () => void
  onRoomMissing: () => void
}

export function BalloonRoom({ roomCode, profile, onSession, onLeave, onRoomMissing }: Props) {
  const balloonAudio = useBalloonAudio()
  const { state, status, selfId, error, notice, send } = useBalloonSocket(
    roomCode,
    profile,
    onSession,
    onRoomMissing,
    balloonAudio.observeState,
  )
  const [copied, setCopied] = useState(false)
  const [optimisticPumps, setOptimisticPumps] = useState(0)
  const [optimisticTurnScore, setOptimisticTurnScore] = useState(0)
  const [localActionClosed, setLocalActionClosed] = useState(false)
  const optimisticBalloonRef = useRef<string | null>(null)
  const optimisticPumpRef = useRef(0)
  const optimisticTurnRef = useRef<string | null>(null)
  const actionClosedRef = useRef(false)

  const me = state?.players.find((player) => player.id === selfId)
  const other = state?.players.find((player) => player.id !== selfId)
  const balloon = state?.balloon
  const turn = state?.turn
  const remainingSeconds = useTurnCountdown(turn?.deadlineAt, state?.serverNow) ?? 0
  const isMyTurn = Boolean(me && turn?.playerId === me.id)
  const canAct = Boolean(
    state?.status === 'playing'
    && turn
    && isMyTurn
    && !turn.resolved
    && !state.paused
    && !localActionClosed
    && remainingSeconds > 0
    && status === 'connected',
  )

  useEffect(() => {
    const balloonId = balloon?.balloonId ?? null
    if (optimisticBalloonRef.current !== balloonId) {
      optimisticBalloonRef.current = balloonId
      optimisticPumpRef.current = balloon?.pumpCount ?? 0
      setOptimisticPumps(optimisticPumpRef.current)
    } else {
      optimisticPumpRef.current = Math.max(optimisticPumpRef.current, balloon?.pumpCount ?? 0)
      setOptimisticPumps(optimisticPumpRef.current)
    }

    const turnId = turn?.turnId ?? null
    if (optimisticTurnRef.current !== turnId) {
      optimisticTurnRef.current = turnId
      actionClosedRef.current = Boolean(turn?.resolved)
      setLocalActionClosed(Boolean(turn?.resolved))
      setOptimisticTurnScore(turn?.turnScore ?? 0)
      return
    }
    setOptimisticTurnScore((current) => Math.max(current, turn?.turnScore ?? 0))
    if (turn?.resolved) {
      actionClosedRef.current = true
      setLocalActionClosed(true)
    }
  }, [balloon?.balloonId, balloon?.pumpCount, turn?.turnId, turn?.turnScore, turn?.resolved])

  const displayedPumpCount = Math.max(balloon?.pumpCount ?? 0, optimisticPumps)
  const displayedTurnScore = Math.max(turn?.turnScore ?? 0, optimisticTurnScore)
  const balloonScale = 0.72 + Math.min(0.55, (1 - Math.exp(-displayedPumpCount / 18)) * 0.62)
  const balloonStyle = { '--balloon-scale': balloonScale.toFixed(3) } as CSSProperties
  const outcome = state?.lastOutcome
  const showOutcome = Boolean(outcome && turn?.resolved && outcome.turnId === turn.turnId)
  const showPop = Boolean(showOutcome && outcome?.kind === 'pop')

  useEffect(() => {
    if (status !== 'connected') balloonAudio.resetObservedState()
  }, [status, balloonAudio.resetObservedState])

  useEffect(() => {
    if (!turn || turn.resolved || state?.paused || state?.status !== 'playing') return
    balloonAudio.playCountdown(turn.turnId, remainingSeconds)
  }, [remainingSeconds, turn?.turnId, turn?.resolved, state?.paused, state?.status, balloonAudio.playCountdown])

  const leave = () => {
    send({ type: 'leave' })
    onLeave()
  }
  const pump = () => {
    if (!canAct || !turn || !balloon || actionClosedRef.current) return
    const nextPumpCount = optimisticPumpRef.current + 1
    if (!send({ type: 'pump', turnId: turn.turnId })) return
    optimisticPumpRef.current = nextPumpCount
    setOptimisticPumps(nextPumpCount)
    setOptimisticTurnScore((current) => current + 1)
    balloonAudio.playPump(balloon.balloonId, nextPumpCount)
  }
  const bank = () => {
    if (!canAct || !turn || displayedTurnScore <= 0 || actionClosedRef.current) return
    actionClosedRef.current = true
    setLocalActionClosed(true)
    if (!send({ type: 'bank', turnId: turn.turnId })) {
      actionClosedRef.current = false
      setLocalActionClosed(false)
    }
  }
  const copyInvite = async () => {
    const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}balloon/room/${roomCode}`
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const statusCopy = useMemo(() => {
    if (!state || !turn || !me) return ''
    if (state.paused) return '친구가 돌아오면 이어서 시작해요!'
    if (turn.resolved) return outcome?.kind === 'pop' ? '팡!! 💥' : '점수 저장 완료! ✨'
    return isMyTurn ? '내 차례! 다다다다 누르다가 적당할 때 멈춰!' : `${other?.nickname ?? '친구'} 차례! 제발 터져라… 👀`
  }, [state?.paused, turn?.turnId, turn?.resolved, isMyTurn, outcome?.kind, me?.id, other?.nickname])

  if (!state || !me) {
    return (
      <main className="balloon-room balloon-room--loading">
        <div className="balloon-loading-icon">🎈</div>
        <b>{error ? '방에 들어가지 못했어요.' : status === 'reconnecting' ? '다시 연결하고 있어요…' : '풍선을 준비하는 중…'}</b>
        {error && <><small>{error}</small><button type="button" onClick={onLeave}>터질까 말까! 메인으로</button></>}
      </main>
    )
  }

  if (state.status === 'waiting') {
    return (
      <main className={`balloon-room balloon-room--waiting theme-${me.character}`}>
        <button className="balloon-back" type="button" onClick={leave}>← 나가기</button>
        <button className="balloon-waiting-sound" type="button" onClick={balloonAudio.toggleMute} aria-label={balloonAudio.muted ? '효과음 켜기' : '효과음 끄기'}>
          {balloonAudio.muted ? '🔇' : '🔊'}
        </button>
        <section>
          <CharacterAvatar character={me.character} mood="idle" active />
          <small>터질까 말까! 방 코드</small>
          <h1>{roomCode}</h1>
          <b>친구가 들어오길 기다리고 있어요.</b>
          <button type="button" onClick={copyInvite}>{copied ? '초대 주소를 복사했어요' : '초대 주소 복사'}</button>
        </section>
        {balloonAudio.needsGesture && !balloonAudio.muted && (
          <button className="balloon-audio-hint" type="button" onClick={balloonAudio.enableAudio}>소리 켜기 ♪</button>
        )}
      </main>
    )
  }

  const winner = state.players.find((player) => player.id === state.winnerId)
  const myRematchReady = state.rematchReadyIds.includes(me.id)
  const myProgress = Math.min(100, (me.score / state.targetScore) * 100)
  const otherProgress = other ? Math.min(100, (other.score / state.targetScore) * 100) : 0

  return (
    <main className={`balloon-room theme-${me.character} ${showPop ? 'is-pop-impact' : ''}`}>
      <header className="balloon-scoreboard">
        <div className="balloon-scoreboard__tools">
          <button type="button" onClick={leave} aria-label="게임 나가기">←</button>
          <button type="button" onClick={balloonAudio.toggleMute} aria-label={balloonAudio.muted ? '효과음 켜기' : '효과음 끄기'}>
            {balloonAudio.muted ? '🔇' : '🔊'}
          </button>
        </div>
        <div className="balloon-player balloon-player--me">
          <CharacterAvatar character={me.character} mood={isMyTurn ? 'thinking' : 'idle'} active={isMyTurn} />
          <div><small>{me.nickname}</small><b>{me.score}</b></div>
          <span><i style={{ width: `${myProgress}%` }} /></span>
        </div>
        <strong>먼저 {state.targetScore}점</strong>
        <div className="balloon-player balloon-player--other">
          <div><small>{other?.nickname ?? '친구'}</small><b>{other?.score ?? 0}</b></div>
          {other && <CharacterAvatar character={other.character} mood={!isMyTurn ? 'thinking' : 'idle'} active={!isMyTurn} />}
          <span><i style={{ width: `${otherProgress}%` }} /></span>
        </div>
      </header>

      <section className="balloon-turn-banner" aria-live="polite">
        <b>{statusCopy}</b>
        <span>TURN {state.turnNumber}</span>
      </section>

      <section className={`balloon-stage ${displayedPumpCount >= 30 ? 'is-tense' : ''} ${displayedPumpCount >= 45 ? 'is-critical' : ''} ${showPop ? 'is-popped' : ''}`}>
        <div className="balloon-timer" aria-label={`남은 시간 ${remainingSeconds}초`}>
          <b>{turn?.resolved || state.paused ? '—' : remainingSeconds}</b><small>초</small>
        </div>
        <div className="balloon-turn-score">
          <small>이번 턴</small>
          <b>+{displayedTurnScore}</b>
        </div>
        <div className="balloon-visual-wrap">
          <div key={balloon?.balloonId} className="balloon-visual" style={balloonStyle} aria-label={`현재 ${displayedPumpCount}번 펌프한 풍선`}>
            <div className="balloon-shine" />
            <div className="balloon-knot" />
            <div className="balloon-string" />
          </div>
          <span className="balloon-pump-count">{displayedPumpCount ? `${displayedPumpCount}번` : '준비!'}</span>
        </div>

        {showOutcome && outcome && (
          <div className={`balloon-outcome balloon-outcome--${outcome.kind}`} aria-live="assertive">
            {outcome.kind === 'pop'
              ? <><b>💥 팡!!</b><span>이번 턴 +{outcome.turnScore}점이 날아갔어요!</span></>
              : outcome.kind === 'timeout'
                ? <><b>⏰ 시간 끝!</b><span>+{outcome.points}점 자동 저장!</span></>
                : <><b>🙌 여기까지!</b><span>+{outcome.points}점 안전하게 저장!</span></>}
          </div>
        )}
      </section>

      <section className="balloon-actions">
        <button className="balloon-pump-button" type="button" disabled={!canAct} onClick={pump}>
          <span>🎈</span><b>{isMyTurn ? '펌프!' : '친구 차례'}</b><small>{canAct ? '다다다다 연타!' : '잠깐 기다려요'}</small>
        </button>
        <button className="balloon-bank-button" type="button" disabled={!canAct || displayedTurnScore <= 0} onClick={bank}>
          <b>🙌 그만!</b><span>+{displayedTurnScore}점 저장</span>
        </button>
      </section>

      {state.paused && <div className="balloon-toast">친구 연결을 기다리는 중… 타이머는 멈췄어요.</div>}
      {status === 'reconnecting' && <div className="balloon-toast">연결을 복구하고 있어요…</div>}
      {notice && status !== 'reconnecting' && <div className="balloon-toast">{notice}</div>}
      {balloonAudio.needsGesture && !balloonAudio.muted && (
        <button className="balloon-audio-hint" type="button" onClick={balloonAudio.enableAudio}>소리 켜기 ♪</button>
      )}

      {state.status === 'finished' && winner && (
        <div className="balloon-modal" role="dialog" aria-modal="true">
          <div className="balloon-result">
            <CharacterAvatar character={winner.character} mood="win" active />
            <small>FINAL SCORE</small>
            <h2>{winner.id === me.id ? '🎉 내가 이겼다!' : `${winner.nickname} 승리!`}</h2>
            <p>{state.players.map((player) => `${player.nickname} ${player.score}점`).join(' : ')}</p>
            <button type="button" disabled={myRematchReady} onClick={() => send({ type: 'rematch_request' })}>
              {myRematchReady ? '친구를 기다리는 중…' : '한 판 더!'}
            </button>
            <button type="button" className="is-secondary" onClick={leave}>게임방으로</button>
          </div>
        </div>
      )}
    </main>
  )
}
