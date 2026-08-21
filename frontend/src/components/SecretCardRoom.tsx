import { useEffect, useMemo, useState } from 'react'
import type { Profile, ReactionEvent, SecretCardAction, SecretCardPlayer, Session } from '../types'
import { useSecretCardSocket } from '../hooks/useSecretCardSocket'
import { useTurnCountdown } from '../hooks/useTurnCountdown'
import { CharacterAvatar } from './CharacterAvatar'

const REACTIONS = ['ㅋㅋㅋ', '헉!', '잠깐!!', '잘못뒀어ㅠ', '👏', '😡']
type DisplayAction = 'check' | 'call' | 'raise' | 'all_in' | 'fold' | 'win' | 'lose'

interface Props {
  roomCode: string
  profile: Profile
  onSession: (session: Session) => void
  onLeave: () => void
  onRoomMissing: () => void
}

function latestReaction(events: ReactionEvent[], playerId?: string) {
  return events.filter((item) => item.playerId === playerId).at(-1)
}

function actionLabel(action?: string) {
  return ({ check: '체크', call: '콜', raise: '레이즈', fold: '다이', all_in: '올인', showdown: '카드 공개', turn_timeout: '시간 초과', reconnect_timeout: '재접속 시간 초과' } as Record<string, string>)[action ?? ''] ?? ''
}

function actionCrop(character: SecretCardPlayer['character'], action: DisplayAction) {
  if (character === 'usagi') {
    const position: Record<DisplayAction, [number, number]> = {
      check: [0, 0], call: [1, 0], raise: [2, 0], all_in: [1, 1], fold: [0, 2], win: [1, 2], lose: [2, 2],
    }
    return { cols: 3, rows: 3, position: position[action], ratio: 1 }
  }
  if (character === 'chiikawa' && ['all_in', 'fold', 'win', 'lose'].includes(action)) {
    const position = { all_in: [0, 1], fold: [1, 1], win: [2, 1], lose: [3, 1] } as const
    return { cols: 4, rows: 2, position: position[action as keyof typeof position], ratio: 2 / 3 }
  }
  const topPosition = { check: [0, 0], call: [1, 0], raise: [2, 0], win: [2, 0] } as const
  const bottomPosition = { all_in: [0, 1], fold: [1, 1], lose: [2, 1] } as const
  const position = action in bottomPosition
    ? bottomPosition[action as keyof typeof bottomPosition]
    : topPosition[action as keyof typeof topPosition]
  const ratio = character === 'chiikawa' ? 8 / 9 : 2 / 3
  return { cols: 3, rows: 2, position, ratio }
}

function SecretActionAvatar({ player, action }: { player: SecretCardPlayer; action: DisplayAction }) {
  const crop = actionCrop(player.character, action)
  const [col, row] = crop.position
  return (
    <div className="secret-action-avatar" aria-label={`${player.nickname} ${actionLabel(action) || action}`}>
      <div className="secret-action-crop" style={{ aspectRatio: crop.ratio }}>
        <img
          src={`${import.meta.env.BASE_URL}minigame/reactions/${player.character}.png`}
          alt=""
          style={{ width: `${crop.cols * 100}%`, height: `${crop.rows * 100}%`, left: `${-col * 100}%`, top: `${-row * 100}%` }}
        />
      </div>
    </div>
  )
}

function PlayerBadge({ player, self, active, reaction, displayAction }: { player?: SecretCardPlayer; self?: boolean; active?: boolean; reaction?: ReactionEvent; displayAction?: DisplayAction }) {
  if (!player) return <div className="secret-player-badge is-empty">친구를 기다리는 중…</div>
  return (
    <div className={`secret-player-badge ${active ? 'is-active' : ''} ${!player.connected ? 'is-offline' : ''}`}>
      {displayAction
        ? <SecretActionAvatar player={player} action={displayAction} />
        : <CharacterAvatar character={player.character} mood={active ? 'myTurn' : 'waiting'} reaction={reaction?.value} />}
      <div><b>{player.nickname}</b><small>{self ? '나' : '친구'} · {player.connected ? '접속 중' : '재접속 대기'}</small></div>
      <span>⭐ {player.chips}</span>
    </div>
  )
}

export function SecretCardRoom({ roomCode, profile, onSession, onLeave, onRoomMissing }: Props) {
  const { state, status, selfId, error, reactions, presence, send } = useSecretCardSocket(roomCode, profile, onSession, onRoomMissing)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const remaining = useTurnCountdown(state?.turnDeadline, state?.serverNow)
  const transitionRemaining = useTurnCountdown(state?.transitionDeadline, state?.serverNow)
  const self = state?.players.find((player) => player.id === selfId)
  const opponent = state?.players.find((player) => player.id !== selfId)
  const myTurn = state?.status === 'playing' && state.turnPlayerId === selfId
  const owed = self && state ? Math.max(0, state.currentBet - (state.contributions[self.id] ?? 0)) : 0
  const opponentLimit = opponent && state ? (state.contributions[opponent.id] ?? 0) + opponent.chips : 0
  const selfContribution = self && state ? state.contributions[self.id] ?? 0 : 0
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}secret-card/room/${roomCode}`

  useEffect(() => setPending(false), [state?.turnPlayerId, state?.status, state?.lastAction?.playerId, state?.roundNumber])

  const available = useMemo(() => ({
    check: myTurn && owed === 0,
    call: myTurn && owed > 0 && Boolean(self && self.chips >= owed),
    raise10: myTurn && Boolean(self && self.chips >= owed + 10 && state && state.currentBet + 10 <= opponentLimit),
    raise50: myTurn && Boolean(self && self.chips >= owed + 50 && state && state.currentBet + 50 <= opponentLimit),
    raise100: myTurn && Boolean(self && self.chips >= owed + 100 && state && state.currentBet + 100 <= opponentLimit),
    allIn: myTurn && Boolean(self?.chips),
    fold: myTurn,
  }), [myTurn, owed, self, state, opponentLimit])

  const act = (action: SecretCardAction, amount?: number) => {
    if (pending) return
    if (send({ type: 'card_action', action, amount })) setPending(true)
  }
  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const leave = () => {
    send({ type: 'leave' })
    onLeave()
  }

  if (!state || !self) {
    return <main className="secret-room secret-room--loading"><div className="secret-loading"><span>♡</span><b>{error ? '방에 들어가지 못했어요' : '비밀카드 방으로 가는 중…'}</b><small>{error ?? (status === 'reconnecting' ? '다시 연결하고 있어요.' : '잠시만 기다려 주세요.')}</small>{error && <button type="button" onClick={onLeave}>비밀카드 메인으로</button>}</div></main>
  }

  if (state.status === 'waiting') {
    return (
      <main className="secret-room secret-room--waiting">
        <button className="secret-back" type="button" onClick={leave}>← 나가기</button>
        <section className="secret-waiting-card">
          <p>비밀카드 방 코드</p><h1>{roomCode}</h1>
          <PlayerBadge player={self} self />
          <img src={`${import.meta.env.BASE_URL}minigame/card-back.png`} alt="비밀 카드" />
          <b>친구가 들어오길 기다리고 있어요…</b>
          <button type="button" onClick={copyInvite}>{copied ? '복사했어요!' : '🔗 초대 링크 복사'}</button>
        </section>
        {error && <div className="secret-toast">{error}</div>}
      </main>
    )
  }

  const selfReaction = latestReaction(reactions, self.id)
  const opponentReaction = latestReaction(reactions, opponent?.id)
  const roundFinished = state.status === 'round_finished'
  const gameFinished = state.status === 'game_finished'
  const matchFinished = state.status === 'finished'
  const roundWon = state.roundWinnerId === self.id
  const gameWon = state.gameWinnerId === self.id
  const matchWon = state.matchWinnerId === self.id
  const rematchPending = state.rematchReady.includes(self.id)
  const resultWinnerId = matchFinished ? state.matchWinnerId : gameFinished ? state.gameWinnerId : roundFinished ? state.roundWinnerId : null
  const displayActionFor = (player?: SecretCardPlayer): DisplayAction | undefined => {
    if (!player) return undefined
    if (resultWinnerId) return player.id === resultWinnerId ? 'win' : 'lose'
    const action = state.lastAction?.playerId === player.id ? state.lastAction.action : undefined
    return ['check', 'call', 'raise', 'all_in', 'fold'].includes(action ?? '') ? action as DisplayAction : undefined
  }

  return (
    <main className="secret-room page-shell">
      <header className="secret-room__header">
        <button type="button" onClick={leave}>← 게임방</button>
        <div><b>두근두근 비밀카드</b><small>ROOM {roomCode}</small></div>
        <button type="button" onClick={copyInvite}>{copied ? '완료!' : '초대 링크'}</button>
      </header>
      <section className="secret-game-stage">
        <PlayerBadge player={opponent} active={state.turnPlayerId === opponent?.id} reaction={opponentReaction} displayAction={displayActionFor(opponent)} />
        <div className="secret-card-zone secret-card-zone--opponent">
          {state.cards.opponent ? <img src={`${import.meta.env.BASE_URL}minigame/cards/${state.cards.opponent}.png`} alt={`상대 카드 ${state.cards.opponent}`} /> : <img src={`${import.meta.env.BASE_URL}minigame/card-back.png`} alt="상대 카드 준비 중" />}
          <span>상대 카드는 보여요</span>
        </div>
        <section className="secret-table-panel">
          <div className="secret-round-strip">
            <span>팟 <b>⭐ {state.pot}</b></span><span>판 <b>{state.gameNumber} / {state.maxGames}</b></span><span>라운드 <b>{state.roundNumber} / {state.maxRounds}</b></span><span>스코어 <b>{self.score} : {opponent?.score ?? 0}</b></span><span>남은 시간 <b>{remaining ?? '—'}초</b></span>
          </div>
          <div className="secret-bet-line"><span>내 베팅 ⭐ {selfContribution}</span><strong>{myTurn ? '내 선택 차례!' : '상대의 선택을 기다리는 중…'}</strong><span>받을 금액 ⭐ {owed}</span></div>
          {state.lastAction && <p className="secret-last-action">{state.lastAction.automatic ? '자동 ' : ''}{actionLabel(state.lastAction.action)} {state.lastAction.amount ? `⭐ ${state.lastAction.amount}` : ''}</p>}
        </section>
        <div className="secret-card-zone secret-card-zone--self">
          <img src={state.revealed && state.cards.self ? `${import.meta.env.BASE_URL}minigame/cards/${state.cards.self}.png` : `${import.meta.env.BASE_URL}minigame/card-back.png`} alt={state.revealed && state.cards.self ? `내 카드 ${state.cards.self}` : '내 비밀 카드'} />
          <span>{state.revealed ? `내 카드 ${state.cards.self}` : '내 카드는 비밀!'}</span>
        </div>
        <PlayerBadge player={self} self active={myTurn} reaction={selfReaction} displayAction={displayActionFor(self)} />

        {state.status === 'playing' && <div className="secret-actions" aria-label="베팅 선택">
          <button disabled={!available.check || pending} onClick={() => act('check')}>체크</button>
          <button disabled={!available.call || pending} onClick={() => act('call')}>콜 {owed ? `⭐${owed}` : ''}</button>
          <button disabled={!available.raise10 || pending} onClick={() => act('raise', 10)}>+10</button>
          <button disabled={!available.raise50 || pending} onClick={() => act('raise', 50)}>+50</button>
          <button disabled={!available.raise100 || pending} onClick={() => act('raise', 100)}>+100</button>
          <button className="secret-actions__allin" disabled={!available.allIn || pending} onClick={() => act('all_in')}>올인</button>
          <button className="secret-actions__fold" disabled={!available.fold || pending} onClick={() => act('fold')}>다이</button>
        </div>}

        {(roundFinished || gameFinished || matchFinished) && <section className={`secret-result ${roundWon || gameWon || matchWon ? 'is-win' : 'is-lose'}`}>
          {matchFinished && matchWon && <img className="secret-result__victory" src={`${import.meta.env.BASE_URL}minigame/result/victory.png`} alt="최종 승리" />}
          <h2>{matchFinished ? (matchWon ? '최종 승리!' : '아쉬운 패배…') : gameFinished ? (gameWon ? '이번 판 승리!' : '이번 판은 아쉽게…') : (roundWon ? '라운드 승리!' : '이번 라운드는 아쉽게…')}</h2>
          <p>내 카드 <b>{state.cards.self}</b> · 상대 카드 <b>{state.cards.opponent}</b></p>
          {matchFinished ? <>
            <div className="secret-stats"><span>최대 팟 <b>⭐ {state.maxPot}</b></span><span>레이즈 <b>{self.stats.raises}</b></span><span>올인 <b>{self.stats.allIns}</b></span><span>다이 <b>{self.stats.folds}</b></span></div>
            <div><button disabled={rematchPending} onClick={() => send({ type: 'rematch_request' })}>{rematchPending ? '상대를 기다리는 중…' : '다시 대결'}</button><button onClick={leave}>메인으로</button></div>
          </> : <p className="secret-auto-next">{gameFinished ? '다음 판이' : '다음 라운드가'} {transitionRemaining ?? 0}초 뒤 자동으로 시작돼요.</p>}
        </section>}

        <div className="secret-reactions">{REACTIONS.map((reaction) => <button key={reaction} onClick={() => send({ type: 'reaction', value: reaction })}>{reaction}</button>)}</div>
      </section>
      {(error || presence || status !== 'connected') && <div className="secret-toast">{error ?? (presence?.status === 'reconnected' ? '다시 왔어요!' : presence ? '연결이 끊겼어요. 30초 동안 기다릴게요.' : '서버에 다시 연결 중…')}</div>}
    </main>
  )
}
