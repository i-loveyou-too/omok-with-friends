import { useMemo, useState } from 'react'
import type { Profile, Session } from '../types'
import { useGameSocket } from '../hooks/useGameSocket'
import { Board } from './Board'
import { PlayerCard } from './PlayerCard'

const REACTIONS = ['ㅋㅋㅋ', '헉!', '잠깐!!', '잘못뒀어ㅠ', '👏', '😡']

interface Props {
  roomCode: string
  profile: Profile
  onSession: (session: Session) => void
  onLeave: () => void
}

export function GameRoom({ roomCode, profile, onSession, onLeave }: Props) {
  const { state, status, selfId, error, reaction, presence, send } = useGameSocket(roomCode, profile, onSession)
  const [copied, setCopied] = useState(false)
  const [lastReactionAt, setLastReactionAt] = useState(0)

  const self = state?.players.find((player) => player.id === selfId)
  const opponent = state?.players.find((player) => player.id !== selfId)
  const selfTurn = state?.status === 'playing' && self?.color === state.turn
  const winner = state?.winnerId ? state.players.find((player) => player.id === state.winnerId) : null
  const title = state?.status === 'finished'
    ? winner?.id === selfId ? '승리!' : `${winner?.nickname ?? '상대'} 승리!`
    : state?.status === 'draw' ? '무승부!'
    : state?.status === 'waiting' ? '친구를 기다려요' : selfTurn ? '내 차례예요!' : '상대가 생각 중…'

  const forbidden = useMemo(() => {
    if (!state || self?.color !== 'black' || state.turn !== 'black') return []
    return state.forbidden
  }, [state, self?.color])

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${location.origin}/omok/room/${roomCode}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const sendReaction = (value: string) => {
    const now = Date.now()
    if (now - lastReactionAt < 1000) return
    setLastReactionAt(now)
    send({ type: 'reaction', value })
  }

  const undoIsMine = state?.undoRequestedBy === selfId
  const undoFromOpponent = Boolean(state?.undoRequestedBy && !undoIsMine)
  const rematchMine = Boolean(selfId && state?.rematchReady.includes(selfId))

  if (!state) {
    return <main className="loading-page page-shell"><div className="loading-stone" /><h1>방으로 가는 중…</h1><p>오목판을 예쁘게 닦고 있어요.</p>{error && <div className="toast">{error}</div>}</main>
  }

  return (
    <main className="game-page">
      <header className="game-header">
        <button className="brand" onClick={() => { if (confirm('진행 중인 방을 나갈까요?')) { send({ type: 'leave' }); onLeave() } }}>오목 한 판<span>?</span></button>
        <button className="room-code" onClick={copyInvite}><small>ROOM</small><b>{roomCode}</b><span>{copied ? '복사됨!' : '초대 링크 복사'}</span></button>
        <div className={`connection connection--${status}`}><i />{status === 'connected' ? '연결됨' : status === 'reconnecting' ? '다시 연결 중' : '연결 중'}</div>
      </header>

      <section className="game-layout">
        <aside className="players-panel">
          <PlayerCard player={self} self active={Boolean(selfTurn)} winner={winner?.id === selfId} loser={Boolean(winner && winner.id !== selfId)} reaction={reaction} />
          <div className="versus"><span>{self?.score ?? 0}</span><i>:</i><span>{opponent?.score ?? 0}</span></div>
          <PlayerCard player={opponent} self={false} active={Boolean(state.status === 'playing' && opponent?.color === state.turn)} winner={winner?.id === opponent?.id} loser={Boolean(winner && winner.id !== opponent?.id)} reaction={reaction} />
        </aside>

        <section className="board-panel">
          <div className="status-line"><span>GAME {state.gameNumber}</span><h1>{title}</h1><p>{state.firstMoveCenterOnly && selfTurn ? '첫 수는 가운데에 톡!' : ' '}</p></div>
          <Board
            board={state.board}
            forbidden={forbidden}
            lastMove={state.lastMove}
            winningLine={state.winningLine}
            centerOnly={state.firstMoveCenterOnly}
            disabled={!selfTurn}
            onMove={(row, col) => send({ type: 'move', row, col })}
          />

          {(state.status === 'finished' || state.status === 'draw') && (
            <div className="result-card">
              <b>{title}</b>
              <span>{self?.nickname} {self?.score} : {opponent?.score ?? 0} {opponent?.nickname ?? ''}</span>
              <button className="primary-button" disabled={rematchMine} onClick={() => send({ type: 'rematch_request' })}>
                {rematchMine ? '상대 선택을 기다려요…' : '다시 한 판!'}
              </button>
            </div>
          )}
        </section>

        <aside className="action-panel">
          <div className="reaction-box">
            <h2>한마디 톡!</h2>
            <div>{REACTIONS.map((item) => <button key={item} onClick={() => sendReaction(item)}>{item}</button>)}</div>
          </div>
          {undoFromOpponent && (
            <div className="undo-prompt"><b>상대가 한 수 무르기를 요청했어요.</b><div><button onClick={() => send({ type: 'undo_response', accept: false })}>거절</button><button onClick={() => send({ type: 'undo_response', accept: true })}>수락</button></div></div>
          )}
          <div className="utility-actions">
            <button disabled={state.status !== 'playing' || undoIsMine} onClick={() => send({ type: 'undo_request' })}>{undoIsMine ? '응답 기다리는 중…' : '↶ 무르기 요청'}</button>
            <button className="danger" disabled={state.status !== 'playing'} onClick={() => { if (confirm('정말 기권할까요? 상대에게 1승이 주어져요.')) send({ type: 'resign' }) }}>깃발 기권</button>
          </div>
          <p className="rule-note"><i>🚫</i><span><b>렌주 규칙</b>흑은 3-3, 4-4, 장목 금수</span></p>
        </aside>
      </section>

      <section className="mobile-actions">
        <div className="mobile-reactions">{REACTIONS.map((item) => <button key={item} onClick={() => sendReaction(item)}>{item}</button>)}</div>
        {undoFromOpponent && <div className="undo-prompt"><b>상대의 무르기 요청</b><div><button onClick={() => send({ type: 'undo_response', accept: false })}>거절</button><button onClick={() => send({ type: 'undo_response', accept: true })}>수락</button></div></div>}
        <div className="utility-actions"><button disabled={state.status !== 'playing' || undoIsMine} onClick={() => send({ type: 'undo_request' })}>↶ 무르기</button><button className="danger" disabled={state.status !== 'playing'} onClick={() => { if (confirm('정말 기권할까요?')) send({ type: 'resign' }) }}>깃발 기권</button></div>
      </section>
      {(error || presence) && <div className="toast" role="status">{error ?? presence}</div>}
    </main>
  )
}
