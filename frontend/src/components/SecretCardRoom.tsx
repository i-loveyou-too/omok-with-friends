import { useEffect, useMemo, useRef, useState } from 'react'
import type { CharacterId, Profile, ReactionEvent, SecretCardAction, SecretCardPlayer, SecretCardSkill, Session } from '../types'
import { useSecretCardSocket } from '../hooks/useSecretCardSocket'
import { useTurnCountdown } from '../hooks/useTurnCountdown'
import { useSecretCardCues } from '../hooks/useSecretCardCues'
import { CharacterAvatar } from './CharacterAvatar'

const REACTIONS = ['ㅋㅋㅋ', '헉!', '잠깐!!', '잘못뒀어ㅠ', '👏', '😡']
type DisplayAction = 'check' | 'call' | 'raise' | 'all_in' | 'fold' | 'win' | 'lose'
type Phase = 'dealing' | 'acting' | 'revealing' | 'result'

const ACTION_BUTTON_LABEL: Record<SecretCardAction, string> = {
  check: '지켜보기', call: '받기', raise: '더 걸기', all_in: '전부 걸기', fold: '포기',
}

const SKILL_LABEL: Record<SecretCardSkill, string> = {
  hint: '카드 힌트', poker_face: '표정 숨기기', pressure: '압박', risk_bet: '배팅 강화', insurance: '보험',
}
const SKILL_ICON: Record<SecretCardSkill, string> = {
  hint: '🔍', poker_face: '🎭', pressure: '⏱️', risk_bet: '🔥', insurance: '🛡️',
}
const HINT_BAND_LABEL: Record<string, string> = { low: '낮음 (1~3)', mid: '중간 (4~6)', high: '높음 (7~10)' }
const CHARACTER_TRAIT: Record<CharacterId, string> = {
  chiikawa: '보험에 강해요', hachiware: '힌트에 강해요', usagi: '배팅 강화에 강해요', momonga: '표정 숨기기에 강해요',
}

function latestReaction(events: ReactionEvent[], playerId?: string) {
  return events.filter((item) => item.playerId === playerId).at(-1)
}

function actionLabel(action?: string) {
  return ({ check: '체크', call: '콜', raise: '레이즈', fold: '다이', all_in: '올인', showdown: '카드 공개', turn_timeout: '시간 초과', reconnect_timeout: '재접속 시간 초과' } as Record<string, string>)[action ?? ''] ?? ''
}

function actionNarrative(action: string, amount: number, automatic: boolean, isSelf: boolean): string {
  const actor = isSelf ? '내가' : '상대가'
  const auto = automatic ? '자동으로 ' : ''
  switch (action) {
    case 'raise': return `${actor} ${auto}+${amount}을 걸었어요!`
    case 'all_in': return `${actor} ${auto}전부 걸었어요!`
    case 'fold': return `${actor} ${auto}포기했어요!`
    case 'call': return `${actor} ${auto}받았어요${amount ? ` ⭐${amount}` : ''}`
    case 'check': return `${actor} ${auto}지켜봤어요`
    case 'showdown': return '카드를 공개해요...'
    default: return ''
  }
}

function skillNarrative(skill: SecretCardSkill, isSelf: boolean): string {
  const actor = isSelf ? '내가' : '상대가'
  return `${actor} '${SKILL_LABEL[skill]}' 스킬을 썼어요!`
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
  const bouncy = action === 'raise' || action === 'all_in' || action === 'win'
  const shaky = action === 'fold' || action === 'lose'
  return (
    <div className={`secret-action-avatar ${bouncy ? 'is-bouncy' : ''} ${shaky ? 'is-shaky' : ''}`} aria-label={`${player.nickname} ${actionLabel(action) || action}`}>
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

function FlipCard({ value, flipped, size }: { value: number | null; flipped: boolean; size: 'opponent' | 'self' }) {
  return (
    <div className={`secret-flipcard secret-flipcard--${size} ${flipped ? 'is-flipped' : ''}`}>
      <div className="secret-flipcard__inner">
        <img className="secret-flipcard__face secret-flipcard__face--back" src={`${import.meta.env.BASE_URL}minigame/card-back.png`} alt="비밀 카드" />
        <img className="secret-flipcard__face secret-flipcard__face--front" src={value ? `${import.meta.env.BASE_URL}minigame/cards/${value}.png` : `${import.meta.env.BASE_URL}minigame/card-back.png`} alt={value ? `카드 ${value}` : ''} />
      </div>
    </div>
  )
}

function PlayerBadge({ player, self, active, reaction, displayAction, maskExpression, trait }: {
  player?: SecretCardPlayer; self?: boolean; active?: boolean; reaction?: ReactionEvent; displayAction?: DisplayAction; maskExpression?: boolean; trait?: string
}) {
  if (!player) return <div className="secret-player-badge is-empty">친구를 기다리는 중…</div>
  const shownAction = maskExpression ? undefined : displayAction
  return (
    <div className={`secret-player-badge ${active ? 'is-active' : ''} ${!player.connected ? 'is-offline' : ''}`}>
      {shownAction
        ? <SecretActionAvatar player={player} action={shownAction} />
        : <CharacterAvatar character={player.character} mood={active ? 'myTurn' : 'waiting'} reaction={maskExpression ? undefined : reaction?.value} reactionNonce={reaction?.createdAt} />}
      {maskExpression && <span className="secret-mask-badge" title="표정을 숨기는 중">🎭</span>}
      <div><b>{player.nickname}</b><small>{self ? '나' : '친구'} · {player.connected ? '접속 중' : '재접속 대기'}{trait ? ` · ${trait}` : ''}</small></div>
      <span key={player.chips} className="secret-star-count">⭐ {player.chips}</span>
    </div>
  )
}

interface Props {
  roomCode: string
  profile: Profile
  onSession: (session: Session) => void
  onLeave: () => void
  onRoomMissing: () => void
}

export function SecretCardRoom({ roomCode, profile, onSession, onLeave, onRoomMissing }: Props) {
  const { state, status, selfId, error, reactions, skillEvents, presence, send } = useSecretCardSocket(roomCode, profile, onSession, onRoomMissing)
  const cues = useSecretCardCues()
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [pendingSkill, setPendingSkill] = useState<SecretCardSkill | null>(null)
  const [phase, setPhase] = useState<Phase>('acting')
  const remaining = useTurnCountdown(state?.turnDeadline, state?.serverNow)
  const transitionRemaining = useTurnCountdown(state?.transitionDeadline, state?.serverNow)
  const hintCooldown = useTurnCountdown(state?.skills?.hint.cooldownEndsAt ?? null, state?.serverNow)
  const pokerFaceCooldown = useTurnCountdown(state?.skills?.pokerFace.cooldownEndsAt ?? null, state?.serverNow)
  const pressureCooldown = useTurnCountdown(state?.skills?.pressure.cooldownEndsAt ?? null, state?.serverNow)
  const self = state?.players.find((player) => player.id === selfId)
  const opponent = state?.players.find((player) => player.id !== selfId)
  const myTurn = state?.status === 'playing' && state.turnPlayerId === selfId
  const owed = self && state ? Math.max(0, state.currentBet - (state.contributions[self.id] ?? 0)) : 0
  const opponentLimit = opponent && state ? (state.contributions[opponent.id] ?? 0) + opponent.chips : 0
  const selfContribution = self && state ? state.contributions[self.id] ?? 0 : 0
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}secret-card/room/${roomCode}`

  useEffect(() => setPending(false), [state?.turnPlayerId, state?.status, state?.lastAction?.playerId, state?.roundNumber])
  useEffect(() => setPendingSkill(null), [state?.skills])

  // --- Round-phase presentation state machine (client-only; server status stays authoritative) ---
  const roundKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!state) return
    const roundKey = `${state.gameNumber}-${state.roundNumber}`
    if (state.status === 'playing') {
      if (roundKeyRef.current !== roundKey) {
        roundKeyRef.current = roundKey
        setPhase('dealing')
        const timer = window.setTimeout(() => setPhase('acting'), 550)
        return () => window.clearTimeout(timer)
      }
      setPhase((current) => (current === 'dealing' ? current : 'acting'))
    } else if (state.status === 'round_finished' || state.status === 'game_finished' || state.status === 'finished') {
      setPhase('revealing')
      const timer = window.setTimeout(() => setPhase('result'), 900)
      return () => window.clearTimeout(timer)
    }
  }, [state?.status, state?.roundNumber, state?.gameNumber])

  // --- Sound/animation hook points ---
  const lastActionKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!state?.lastAction || !self) return
    const key = `${state.roundNumber}-${state.lastAction.playerId}-${state.lastAction.action}-${state.lastAction.amount}`
    if (lastActionKeyRef.current === key) return
    lastActionKeyRef.current = key
    cues('onAction', { action: state.lastAction.action, self: state.lastAction.playerId === self.id, amount: state.lastAction.amount })
  }, [state?.lastAction, state?.roundNumber, self, cues])

  const revealedRef = useRef(false)
  useEffect(() => {
    if (phase === 'revealing' && !revealedRef.current && state) {
      revealedRef.current = true
      cues('onReveal', { selfCard: state.cards.self, opponentCard: state.cards.opponent })
    }
    if (phase === 'dealing') revealedRef.current = false
  }, [phase, state, cues])

  const resultCuedRef = useRef<string | null>(null)
  const resultWinnerIdForCue = state?.matchWinnerId ?? state?.gameWinnerId ?? state?.roundWinnerId ?? null
  useEffect(() => {
    if (phase !== 'result' || !resultWinnerIdForCue || !self) return
    const key = `${state?.roundNumber}-${resultWinnerIdForCue}`
    if (resultCuedRef.current === key) return
    resultCuedRef.current = key
    const scope = state?.status === 'finished' ? 'match' : state?.status === 'game_finished' ? 'game' : 'round'
    cues(resultWinnerIdForCue === self.id ? 'onWin' : 'onLose', { scope })
  }, [phase, resultWinnerIdForCue, self, state?.roundNumber, state?.status, cues])

  const skillCuedIdsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const event of skillEvents) {
      if (skillCuedIdsRef.current.has(event.eventId)) continue
      skillCuedIdsRef.current.add(event.eventId)
      cues('onSkill', { skill: event.skill, self: event.playerId === selfId })
    }
  }, [skillEvents, selfId, cues])

  const countdownCuedRef = useRef<number | null>(null)
  useEffect(() => {
    if (remaining == null) { countdownCuedRef.current = null; return }
    if ([10, 5, 3].includes(remaining) && countdownCuedRef.current !== remaining) {
      countdownCuedRef.current = remaining
      cues('onCountdown', { secondsLeft: remaining })
    }
  }, [remaining, cues])

  const available = useMemo(() => ({
    check: myTurn && owed === 0,
    call: myTurn && owed > 0 && Boolean(self && self.chips >= owed),
    raise10: myTurn && Boolean(self && self.chips >= owed + 10 && state && state.currentBet + 10 <= opponentLimit),
    raise50: myTurn && Boolean(self && self.chips >= owed + 50 && state && state.currentBet + 50 <= opponentLimit),
    raise100: myTurn && Boolean(self && self.chips >= owed + 100 && state && state.currentBet + 100 <= opponentLimit),
    allIn: myTurn && Boolean(self?.chips),
    fold: myTurn,
  }), [myTurn, owed, self, state, opponentLimit])

  const skillButtons = useMemo(() => {
    if (!state?.skills || !self || state.status !== 'playing') return []
    const s = state.skills
    const defs: Array<{ id: SecretCardSkill; sub: string; available: boolean; preferred: boolean }> = [
      { id: 'hint', sub: s.hintBand ? `내 카드: ${HINT_BAND_LABEL[s.hintBand]}` : `⭐${s.hint.cost}`, available: !s.hint.usedThisRound && self.chips >= s.hint.cost, preferred: s.hint.preferred },
      { id: 'poker_face', sub: s.pokerFaceActive ? '숨기는 중…' : s.pokerFace.ready ? '무료' : `${pokerFaceCooldown ?? 0}초`, available: s.pokerFace.ready, preferred: s.pokerFace.preferred },
      { id: 'pressure', sub: s.pressure.ready ? `⭐${s.pressure.cost}` : `${pressureCooldown ?? 0}초`, available: s.pressure.ready && self.chips >= s.pressure.cost, preferred: s.pressure.preferred },
      { id: 'risk_bet', sub: s.riskBet.active ? '발동 중!' : s.riskBet.locked ? '상대가 사용 중' : '무료 · 고위험', available: !s.riskBet.usedThisRound && !s.riskBet.locked, preferred: s.riskBet.preferred },
      { id: 'insurance', sub: `⭐${s.insurance.cost}`, available: !s.insurance.usedThisRound && self.chips >= s.insurance.cost, preferred: s.insurance.preferred },
    ]
    return defs
      .sort((a, b) => Number(b.available) - Number(a.available) || Number(b.preferred) - Number(a.preferred))
      .slice(0, 3)
  }, [state?.skills, state?.status, self, hintCooldown, pokerFaceCooldown, pressureCooldown])

  const act = (action: SecretCardAction, amount?: number) => {
    if (pending) return
    if (send({ type: 'card_action', action, amount })) setPending(true)
  }
  const useSkill = (skill: SecretCardSkill) => {
    if (pendingSkill) return
    if (send({ type: 'skill_action', skill })) setPendingSkill(skill)
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
  const showResultPanel = phase === 'result' && (roundFinished || gameFinished || matchFinished)
  const displayActionFor = (player?: SecretCardPlayer): DisplayAction | undefined => {
    if (!player) return undefined
    if (showResultPanel && resultWinnerId) return player.id === resultWinnerId ? 'win' : 'lose'
    const action = state.lastAction?.playerId === player.id ? state.lastAction.action : undefined
    return ['check', 'call', 'raise', 'all_in', 'fold'].includes(action ?? '') ? action as DisplayAction : undefined
  }
  const stageLabel = phase === 'dealing'
    ? '카드를 나누는 중…'
    : phase === 'revealing'
      ? '카드 공개 중…'
      : showResultPanel
        ? (resultWinnerId === self.id ? '승리!' : '아쉬워요…')
        : (myTurn ? '내 선택 차례!' : '상대의 선택을 기다리는 중…')
  const opponentBannerText = state.lastAction && state.lastAction.playerId === opponent?.id && phase === 'acting'
    ? actionNarrative(state.lastAction.action, state.lastAction.amount, Boolean(state.lastAction.automatic), false)
    : null
  const skillBanner = skillEvents.at(-1)
  const skillBannerText = skillBanner && skillBanner.playerId === opponent?.id
    ? skillNarrative(skillBanner.skill, false)
    : null
  const potFlyDirection = showResultPanel && resultWinnerId ? (resultWinnerId === self.id ? 'down' : 'up') : null

  return (
    <main className="secret-room secret-room--table page-shell">
      <header className="secret-room__header">
        <button type="button" onClick={leave}>← 게임방</button>
        <div><b>두근두근 비밀카드</b><small>ROOM {roomCode}</small></div>
        <button type="button" onClick={copyInvite}>{copied ? '완료!' : '초대 링크'}</button>
      </header>

      <section className="secret-stage">
        <div className="secret-stage__top">
          <PlayerBadge
            player={opponent}
            active={state.turnPlayerId === opponent?.id && phase === 'acting'}
            reaction={opponentReaction}
            displayAction={displayActionFor(opponent)}
            maskExpression={Boolean(state.skills?.opponentPokerFaceActive) && !showResultPanel}
          />
          {(opponentBannerText || skillBannerText) && (
            <p key={opponentBannerText ?? skillBannerText} className="secret-banner secret-banner--opponent">{opponentBannerText ?? skillBannerText}</p>
          )}
        </div>

        <div className={`secret-stage__mid ${phase === 'dealing' ? 'is-dealing' : ''}`}>
          <div className="secret-mid__meta">
            <span>ROUND <b>{state.roundNumber}/{state.maxRounds}</b></span>
            <span className="secret-pot"><i>POT</i><b key={state.pot}>⭐ {state.pot}</b></span>
            <span>스코어 <b>{self.score} : {opponent?.score ?? 0}</b></span>
          </div>
          <div className={`secret-timer-badge ${remaining != null && remaining <= 10 ? 'is-warn' : ''} ${remaining != null && remaining <= 5 ? 'is-urgent' : ''} ${remaining != null && remaining <= 3 ? 'is-critical' : ''}`}>{remaining ?? '—'}</div>

          <div className="secret-cards">
            <div className="secret-card-zone secret-card-zone--opponent">
              <FlipCard value={state.cards.opponent} flipped={phase !== 'dealing'} size="opponent" />
              <span>상대 카드</span>
            </div>
            <div className="secret-stage-label" aria-live="polite">{stageLabel}</div>
            <div className="secret-card-zone secret-card-zone--self">
              <FlipCard value={state.cards.self} flipped={state.revealed} size="self" />
              <span>{state.revealed ? `내 카드 ${state.cards.self}` : '내 카드는 비밀!'}</span>
            </div>
          </div>

          {potFlyDirection && <span key={`${state.roundNumber}-${resultWinnerId}`} className={`secret-pot-fly secret-pot-fly--${potFlyDirection}`} aria-hidden="true">⭐</span>}

          <div className="secret-bet-line"><span>내 베팅 ⭐ {selfContribution}</span><span>받을 금액 ⭐ {owed}</span></div>
        </div>

        <div className="secret-stage__bottom">
          <PlayerBadge player={self} self active={myTurn && phase === 'acting'} reaction={selfReaction} displayAction={displayActionFor(self)} trait={CHARACTER_TRAIT[self.character]} />

          {state.status === 'playing' && phase === 'acting' && <div className="secret-actions" aria-label="베팅 선택">
            <button disabled={!available.check || pending} onClick={() => act('check')}>{ACTION_BUTTON_LABEL.check}</button>
            <button disabled={!available.call || pending} onClick={() => act('call')}>{ACTION_BUTTON_LABEL.call} {owed ? `⭐${owed}` : ''}</button>
            <button disabled={!available.raise10 || pending} onClick={() => act('raise', 10)}>+10</button>
            <button disabled={!available.raise50 || pending} onClick={() => act('raise', 50)}>+50</button>
            <button disabled={!available.raise100 || pending} onClick={() => act('raise', 100)}>+100</button>
            <button className="secret-actions__allin" disabled={!available.allIn || pending} onClick={() => act('all_in')}>{ACTION_BUTTON_LABEL.all_in}</button>
            <button className="secret-actions__fold" disabled={!available.fold || pending} onClick={() => act('fold')}>{ACTION_BUTTON_LABEL.fold}</button>
          </div>}

          {state.status === 'playing' && phase === 'acting' && skillButtons.length > 0 && (
            <div className="secret-skills" aria-label="스킬 사용">
              {skillButtons.map((skill) => (
                <button
                  key={skill.id}
                  className={`secret-skill ${skill.preferred ? 'is-preferred' : ''}`}
                  disabled={!skill.available || pendingSkill !== null}
                  onClick={() => useSkill(skill.id)}
                  title={SKILL_LABEL[skill.id]}
                >
                  <i>{SKILL_ICON[skill.id]}</i>
                  <b>{SKILL_LABEL[skill.id]}</b>
                  <small>{skill.sub}</small>
                </button>
              ))}
            </div>
          )}

          {state.lastAction && phase === 'acting' && <p className="secret-last-action">{state.lastAction.automatic ? '자동 ' : ''}{actionLabel(state.lastAction.action)} {state.lastAction.amount ? `⭐ ${state.lastAction.amount}` : ''}</p>}
        </div>

        {showResultPanel && <section className={`secret-result ${roundWon || gameWon || matchWon ? 'is-win' : 'is-lose'}`}>
          {matchFinished && matchWon && <img className="secret-result__victory" src={`${import.meta.env.BASE_URL}minigame/result/victory.png`} alt="최종 승리" />}
          <h2>{matchFinished ? (matchWon ? '최종 승리!' : '아쉬운 패배…') : gameFinished ? (gameWon ? '이번 판 승리!' : '이번 판은 아쉽게…') : (roundWon ? '라운드 승리!' : '이번 라운드는 아쉽게…')}</h2>
          <p>내 카드 <b>{state.cards.self}</b> · 상대 카드 <b>{state.cards.opponent}</b></p>
          {state.skillResult?.insurance && <p className="secret-skill-result">🛡️ 보험 발동! ⭐{state.skillResult.insurance.refund} 돌려받았어요</p>}
          {state.skillResult?.riskBet && <p className="secret-skill-result">🔥 배팅 강화 {state.skillResult.riskBet.won ? `성공! ⭐${state.skillResult.riskBet.amount} 추가 획득` : `실패… ⭐${state.skillResult.riskBet.amount} 추가 손실`}</p>}
          {matchFinished ? <>
            <div className="secret-stats"><span>최대 팟 <b>⭐ {state.maxPot}</b></span><span>레이즈 <b>{self.stats.raises}</b></span><span>올인 <b>{self.stats.allIns}</b></span><span>스킬 <b>{self.stats.skills}</b></span></div>
            <div><button disabled={rematchPending} onClick={() => send({ type: 'rematch_request' })}>{rematchPending ? '상대를 기다리는 중…' : '다시 대결'}</button><button onClick={leave}>메인으로</button></div>
          </> : <p className="secret-auto-next">{gameFinished ? '다음 판이' : '다음 라운드가'} {transitionRemaining ?? 0}초 뒤 자동으로 시작돼요.</p>}
        </section>}

        <div className="secret-reactions">{REACTIONS.map((reaction) => <button key={reaction} onClick={() => send({ type: 'reaction', value: reaction })}>{reaction}</button>)}</div>
      </section>
      {(error || presence || status !== 'connected') && <div className="secret-toast">{error ?? (presence?.status === 'reconnected' ? '다시 왔어요!' : presence ? '연결이 끊겼어요. 30초 동안 기다릴게요.' : '서버에 다시 연결 중…')}</div>}
    </main>
  )
}
