import { useEffect, useMemo, useRef, useState } from 'react'

import { preloadCharacterAssets } from '../assets/characters/manifest'
import { useGameAudio } from '../hooks/useGameAudio'
import { useGameSocket } from '../hooks/useGameSocket'
import { useTurnCountdown } from '../hooks/useTurnCountdown'
import type { Point, Profile, Session } from '../types'
import { Board } from './Board'
import { CharacterAvatar } from './CharacterAvatar'
import { PlayerCard } from './PlayerCard'
import { ResultPanel } from './ResultPanel'

const REACTIONS = ['ㅋㅋㅋ', '헉!', '잠깐!!', '잘못뒀어ㅠ', '하품~', '빨리하세욧!', '👏', '😡']
const MOVE_ERROR_CODES = new Set(['occupied', 'wrong_turn', 'forbidden', 'first_move_center', 'game_not_playing', 'turn_expired'])
const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

interface Props {
  roomCode: string
  profile: Profile
  onSession: (session: Session) => void
  onLeave: () => void
  onRoomMissing?: () => void
}

const FORBIDDEN_COPY = {
  double_three: '3-3 금지수예요!',
  double_four: '4-4 금지수예요!',
  overline: '장목은 둘 수 없어요.',
} as const

function connectionLabel(status: string) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '다시 연결 중'
  if (status === 'disconnected') return '연결 끊김'
  return '연결 중'
}

export function GameRoom({ roomCode, profile, onSession, onLeave, onRoomMissing }: Props) {
  const {
    state, status, selfId, error, errorEvent, reactions, presence,
    moveConfirmed, playerAwakened, undoRequested, undoResult, turnTimeout, send,
  } = useGameSocket(roomCode, profile, onSession, onRoomMissing)
  const { muted, needsGesture, startBgm, toggleMute, playEffect } = useGameAudio()
  const [copied, setCopied] = useState(false)
  const [lastReactionAt, setLastReactionAt] = useState(0)
  const [candidate, setCandidate] = useState<Point | null>(null)
  const [moveSubmitting, setMoveSubmitting] = useState(false)
  const [undoResponding, setUndoResponding] = useState(false)
  const [spicySubmitting, setSpicySubmitting] = useState(false)
  const [resultAction, setResultAction] = useState<'rematch' | 'home' | null>(null)
  const [systemNotice, setSystemNotice] = useState<{ id: string; text: string } | null>(null)
  const noticeTimerRef = useRef<number | undefined>(undefined)

  const self = state?.players.find((player) => player.id === selfId)
  const opponent = state?.players.find((player) => player.id !== selfId)
  const selfTurn = state?.status === 'playing' && self?.color === state.turn
  const selfAwakened = Boolean(self?.awakened)
  const winner = state?.winnerId ? state.players.find((player) => player.id === state.winnerId) : null
  const ended = state?.status === 'finished' || state?.status === 'draw'
  const remainingSeconds = useTurnCountdown(state?.turnDeadline, state?.serverNow)
  const characterPreloadKey = state?.players.map((player) => player.character).join(',') ?? profile.character
  const title = state?.status === 'finished'
    ? winner?.id === selfId ? '승리!' : `${winner?.nickname ?? '상대'} 승리!`
    : state?.status === 'draw' ? '무승부!'
    : selfTurn ? '내 차례예요!' : '상대가 생각 중…'

  const forbidden = useMemo(() => {
    if (!state || state.status !== 'playing' || self?.color !== state.turn) return []
    return state.forbidden
  }, [state, self?.color])
  const candidateForbidden = candidate
    ? forbidden.find((point) => point.row === candidate.row && point.col === candidate.col) ?? null
    : null
  const candidateMessage = candidateForbidden
    ? FORBIDDEN_COPY[candidateForbidden.reason]
    : candidate ? `${candidate.row + 1}행 ${candidate.col + 1}열을 선택했어요`
    : '빈 교차점을 먼저 선택해 주세요'

  const showSystemNotice = (id: string, text: string) => {
    setSystemNotice({ id, text })
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setSystemNotice(null), 2800)
  }

  useEffect(() => {
    const characters = state?.players.map((player) => player.character) ?? [profile.character]
    preloadCharacterAssets(characters)
  }, [characterPreloadKey])

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
  }, [])

  useEffect(() => {
    reactions.forEach((reaction) => playEffect('chatBubble', `reaction:${reaction.id}`))
  }, [reactions, playEffect])

  useEffect(() => {
    if (!moveConfirmed) return
    playEffect('stonePlace', `move:${moveConfirmed.eventId}`)
    if (moveConfirmed.playerId === selfId) {
      setCandidate(null)
      setMoveSubmitting(false)
    }
  }, [moveConfirmed, playEffect, selfId])

  useEffect(() => {
    if (!playerAwakened) return
    showSystemNotice(
      playerAwakened.eventId,
      playerAwakened.playerId === selfId ? '🔥 매운카레 각성!' : '상대가 매운카레로 각성했어요!'
    )
  }, [playerAwakened, selfId])

  useEffect(() => {
    if (!undoRequested || undoRequested.playerId === selfId) return
    playEffect('undoRequest', `undo-request:${undoRequested.requestId}`)
  }, [undoRequested, playEffect, selfId])

  useEffect(() => {
    if (!undoResult || !selfId) return
    const requester = undoResult.requesterId === selfId
    const text = undoResult.accepted
      ? requester ? '상대가 무르기를 받아줬어요!' : '무르기를 받아줬어요!'
      : requester ? '상대가 무르기를 거절했어요.' : '무르기 요청을 거절했어요.'
    showSystemNotice(undoResult.eventId, text)
    setCandidate(null)
    setMoveSubmitting(false)
    setUndoResponding(false)
  }, [undoResult, selfId])

  useEffect(() => {
    if (!turnTimeout) return
    showSystemNotice(
      turnTimeout.eventId,
      turnTimeout.playerId === selfId ? '시간이 지나 차례가 넘어갔어요.' : '상대의 시간이 지나 내 차례가 됐어요.',
    )
    setCandidate(null)
    setMoveSubmitting(false)
  }, [turnTimeout, selfId])

  useEffect(() => {
    setCandidate(null)
    setMoveSubmitting(false)
    setResultAction(null)
    setSpicySubmitting(false)
  }, [state?.gameNumber, state?.turn, state?.status, state?.lastMove?.row, state?.lastMove?.col, state?.undoRequestId])

  useEffect(() => {
    if (!errorEvent) return
    setMoveSubmitting(false)
    setSpicySubmitting(false)
    if (MOVE_ERROR_CODES.has(errorEvent.code)) setCandidate(null)
  }, [errorEvent])

  useEffect(() => {
    if (selfAwakened || status !== 'connected' || state?.status !== 'playing') setSpicySubmitting(false)
  }, [selfAwakened, status, state?.status])

  useEffect(() => {
    if (!state?.undoRequestedBy) setUndoResponding(false)
  }, [state?.undoRequestedBy])

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${location.origin}${APP_BASE}/room/${roomCode}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const sendReaction = (value: string) => {
    const now = Date.now()
    if (now - lastReactionAt < 1000) return
    setLastReactionAt(now)
    send({ type: 'reaction', value })
  }

  const useSpicyCurry = () => {
    if (state?.status !== 'playing' || selfAwakened || spicySubmitting || status !== 'connected') return
    if (send({ type: 'spicy_curry' })) setSpicySubmitting(true)
  }

  const confirmMove = () => {
    if (!candidate || candidateForbidden || !selfTurn || status !== 'connected' || moveSubmitting || ended) return
    if (send({ type: 'move', row: candidate.row, col: candidate.col })) setMoveSubmitting(true)
  }

  const respondUndo = (accept: boolean) => {
    if (undoResponding || status !== 'connected') return
    if (send({ type: 'undo_response', accept })) setUndoResponding(true)
  }

  const leaveRoom = (ask = true) => {
    if (ask && !confirm('진행 중인 방을 나갈까요?')) return
    send({ type: 'leave' })
    onLeave()
  }

  const requestRematch = () => {
    if (resultAction || status !== 'connected') return
    if (send({ type: 'rematch_request' })) setResultAction('rematch')
  }

  const goResultHome = () => {
    if (resultAction === 'home') return
    setResultAction('home')
    leaveRoom(false)
  }

  const soundButton = (
    <button className="sound-toggle" type="button" onClick={toggleMute} aria-label={muted ? '전체 소리 켜기' : '전체 소리 끄기'}>
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span><b>{muted ? '소리 켜기' : '소리 끄기'}</b>
    </button>
  )

  if (!state) {
    const mood = status === 'reconnecting' || status === 'disconnected' ? 'disconnected' : 'waiting'
    return (
      <main className="loading-page page-shell">
        <div className="loading-sound">{soundButton}</div>
        <CharacterAvatar character={profile.character} mood={mood} />
        <h1>방으로 가는 중…</h1>
        <p>오목판을 예쁘게 닦고 있어요.</p>
        {error && <div className="toast">{error}</div>}
      </main>
    )
  }

  if (state.status === 'waiting' && self) {
    const waitingMood = status !== 'connected'
      ? 'disconnected'
      : presence?.playerId === self.id && presence.status === 'reconnected' ? 'reconnected' : 'waiting'
    return (
      <main className="waiting-page page-shell">
        <div className="waiting-cloud waiting-cloud--one" aria-hidden="true" />
        <div className="waiting-cloud waiting-cloud--two" aria-hidden="true" />
        <button className="brand waiting-brand" onClick={() => leaveRoom(false)}>오목 한 판<span>?</span></button>
        <div className="waiting-sound">{soundButton}</div>
        <section className="waiting-card">
          <p className="room-chip">ROOM · {roomCode}</p>
          <h1>{self.nickname}의 오목방</h1>
          <div className="waiting-character"><CharacterAvatar character={self.character} mood={waitingMood} /></div>
          <div className="waiting-speech"><b>{status === 'connected' ? '친구를 기다리고 있어요...' : connectionLabel(status)}</b><span>초대 링크를 보내 함께 시작해요!</span></div>
          <button className="invite-button" onClick={copyInvite}><span>↗</span>{copied ? '초대 링크를 복사했어요!' : '초대 링크 복사'}</button>
          <button className="waiting-leave" onClick={() => leaveRoom(false)}>방 나가기</button>
        </section>
        {needsGesture && !muted && <button className="audio-hint" onClick={() => void startBgm()}>화면을 눌러 음악 켜기 ♪</button>}
        {(error || presence) && <div className="toast" role="status">{error ?? (presence?.status === 'reconnected' ? '다시 왔어요!' : '연결 끊김…')}</div>}
      </main>
    )
  }

  const undoIsMine = state.undoRequestedBy === selfId
  const undoFromOpponent = Boolean(state.undoRequestedBy && !undoIsMine)
  const rematchMine = Boolean(selfId && state.rematchReady.includes(selfId))
  const boardDisabled = !selfTurn || status !== 'connected' || moveSubmitting || ended
  const spicyCurryDisabled = state.status !== 'playing' || selfAwakened || spicySubmitting || status !== 'connected'
  const resultPanel = ended && self ? (
    <ResultPanel
      result={state.status === 'draw' ? 'draw' : winner?.id === selfId ? 'win' : 'lose'}
      self={self}
      opponent={opponent}
      rematchPending={rematchMine || resultAction === 'rematch'}
      homePending={resultAction === 'home'}
      onRematch={requestRematch}
      onHome={goResultHome}
    />
  ) : null

  return (
    <main className="game-page">
      <header className="game-header">
        <button className="brand" onClick={() => leaveRoom(true)}>오목 한 판<span>?</span></button>
        <button className="room-code" onClick={copyInvite} aria-label={`방 ${roomCode} 초대 링크 복사`}>
          <small>ROOM</small>
          <b>{roomCode}</b>
          <span className="room-copy-label">{copied ? '복사됨!' : '초대 링크 복사'}</span>
          <span className="room-copy-icon" aria-hidden="true">⧉</span>
        </button>
        <div className="game-tools">
          {soundButton}
          <div className={`connection connection--${status}`}><i />{connectionLabel(status)}</div>
        </div>
      </header>

      {needsGesture && !muted && <button className="audio-hint" onClick={() => void startBgm()}>화면을 눌러 음악 켜기 ♪</button>}
      {systemNotice && <div className="system-notice" key={systemNotice.id} role="status">{systemNotice.text}</div>}

      <section className={`game-layout ${ended ? 'game-layout--result' : ''}`}>
        <aside className="players-panel">
          <PlayerCard player={self} self active={Boolean(selfTurn)} winner={winner?.id === selfId} loser={Boolean(winner && winner.id !== selfId)} reactions={reactions} presence={presence} thinking={undoIsMine} connectionIssue={status !== 'connected'} />
          <div className="versus"><span>{self?.score ?? 0}</span><i>:</i><span>{opponent?.score ?? 0}</span></div>
          <PlayerCard player={opponent} self={false} active={Boolean(state.status === 'playing' && opponent?.color === state.turn)} winner={winner?.id === opponent?.id} loser={Boolean(winner && winner.id !== opponent?.id)} reactions={reactions} presence={presence} thinking={undoFromOpponent} />
        </aside>

        <section className="board-panel">
          <div className="status-line">
            <div className="status-meta"><span>GAME {state.gameNumber}</span>{remainingSeconds !== null && <b className={remainingSeconds <= 10 ? 'is-urgent' : ''}>⏱ {remainingSeconds}초</b>}</div>
            <h1>{title}</h1>
            <p>{state.firstMoveCenterOnly && selfTurn ? '첫 수는 가운데에 톡!' : ' '}</p>
          </div>
          {undoFromOpponent && !ended && (
            <div className="undo-request-overlay" role="dialog" aria-label="상대의 무르기 요청">
              <b>상대가 무르기를 요청했어요</b>
              <div><button disabled={undoResponding || status !== 'connected'} onClick={() => respondUndo(false)}>거절</button><button disabled={undoResponding || status !== 'connected'} onClick={() => respondUndo(true)}>수락</button></div>
            </div>
          )}
          {resultPanel && <div className="board-result-overlay" role="dialog" aria-modal="true"><div className="board-result-dim" aria-hidden="true" />{resultPanel}</div>}
          <Board board={state.board} forbidden={forbidden} lastMove={state.lastMove} winningLine={state.winningLine} centerOnly={state.firstMoveCenterOnly} candidate={candidate} candidateColor={self?.color ?? null} disabled={boardDisabled} onMove={(row, col) => setCandidate({ row, col })} />
          {!ended && (
            <div className={`move-confirm-bar ${candidateForbidden ? 'is-forbidden' : ''}`}>
              <span>{candidateMessage}</span>
              <button disabled={!candidate || Boolean(candidateForbidden) || boardDisabled} onClick={confirmMove}>{moveSubmitting ? '확인 중…' : '여기에 놓기'}</button>
            </div>
          )}
        </section>

        {!ended && (
          <aside className="action-panel">
            <div className="reaction-box"><h2>한마디 톡!</h2><div>{REACTIONS.map((item) => <button key={item} onClick={() => sendReaction(item)}>{item}</button>)}</div></div>
            <button className="spicy-curry-button" disabled={spicyCurryDisabled} onClick={useSpicyCurry}>{selfAwakened ? '🔥 각성중' : spicySubmitting ? '🔥 각성 중…' : '🌶️ 매운카레'}</button>
            <div className="utility-actions">
              <button disabled={state.status !== 'playing' || undoIsMine || status !== 'connected'} onClick={() => send({ type: 'undo_request' })}>{undoIsMine ? '응답 기다리는 중…' : '↶ 무르기 요청'}</button>
              <button className="danger" disabled={state.status !== 'playing'} onClick={() => { if (confirm('정말 기권할까요? 상대에게 1승이 주어져요.')) send({ type: 'resign' }) }}>⚑ 기권</button>
            </div>
            <p className="rule-note"><i>🚫</i><span><b>공통 금지</b>흑/백 모두 3-3, 4-4, 장목 금수</span></p>
          </aside>
        )}
      </section>

      {!ended && (
        <section className="mobile-actions">
          <div className="mobile-reactions">{REACTIONS.map((item) => <button key={item} onClick={() => sendReaction(item)}>{item}</button>)}</div>
          <button className="spicy-curry-button" disabled={spicyCurryDisabled} onClick={useSpicyCurry}>{selfAwakened ? '🔥 각성중' : spicySubmitting ? '🔥 각성 중…' : '🌶️ 매운카레'}</button>
          <div className="utility-actions"><button disabled={state.status !== 'playing' || undoIsMine || status !== 'connected'} onClick={() => send({ type: 'undo_request' })}>↶ 무르기</button><button className="danger" disabled={state.status !== 'playing'} onClick={() => { if (confirm('정말 기권할까요?')) send({ type: 'resign' }) }}>⚑ 기권</button></div>
        </section>
      )}
      {(error || presence) && <div className="toast" role="status">{error ?? (presence?.status === 'reconnected' ? '다시 왔어요!' : '연결 끊김…')}</div>}
    </main>
  )
}
