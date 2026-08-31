import './yut.css'
import { FormEvent, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { characterAssets } from '../../assets/characters/manifest'
import { CharacterAvatar } from '../../components/CharacterAvatar'
import type { CharacterId } from '../../types'
import { yutAssets, yutCardAsset, yutResultAsset, yutTileAsset, type YutTileKind } from './assets'
import { ROLL_LABEL } from './board'
import type { YutPieceSelectionMode } from './YutBoard'
import { YutBoard } from './YutBoard'
import { useYutAudio, type YutSound } from './useYutAudio'
import { useYutSocket } from './useYutSocket'
import type { YutCardDefinition, YutMode, YutPiece, YutProfile, YutRollResult, YutSession, YutState } from './types'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? `${APP_BASE}/api`
const AUTO_CARDS = new Set(['reroll', 'extra_turn', 'nothing', 'last_place_boost', 'chaos_swap'])
const OPPONENT_CARDS = new Set(['opponent_back', 'split'])
const TARGETED_DANGER_CARDS = new Set(['minus_three', 'forced_split'])

interface CardTargetMode {
  source: 'drawn' | 'hand'
  cardId: string
  instanceId?: string
  ownPieceId?: number
}

function roomFromPath() {
  const escaped = APP_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return location.pathname.match(new RegExp(`${escaped}/yut/room/([A-Z0-9]{5})`, 'i'))?.[1]?.toUpperCase() ?? null
}

function loadSession(code: string): YutSession | null {
  try {
    return JSON.parse(sessionStorage.getItem(`yut-session-${code}`) ?? 'null')
  } catch {
    return null
  }
}

function useSharedRollPresentation(state: YutState | null, playSound: (sound: YutSound) => void) {
  const [presenting, setPresenting] = useState<YutRollResult | null>(null)
  const [showResult, setShowResult] = useState(false)
  const seenRollId = useRef<number | null>(null)
  const initialized = useRef(false)
  const roll = state?.lastEvent?.type === 'roll' ? state.lastEvent.roll : undefined
  const hasState = state !== null

  useEffect(() => {
    if (!state) return
    if (!initialized.current) {
      initialized.current = true
      seenRollId.current = roll?.id ?? null
      return
    }
    if (!roll || seenRollId.current === roll.id) return
    seenRollId.current = roll.id
    setPresenting(roll)
    setShowResult(false)
    playSound('throw')
    const reveal = window.setTimeout(() => {
      setShowResult(true)
      playSound('landing')
      playSound(['yut', 'mo'].includes(roll.name) ? 'bigResult' : roll.name === 'backdo' ? 'backdo' : 'smallResult')
    }, 620)
    const done = window.setTimeout(() => setPresenting(null), 1280)
    return () => {
      window.clearTimeout(reveal)
      window.clearTimeout(done)
    }
  }, [hasState, playSound, roll?.id])

  return { presenting, showResult }
}

export function YutApp() {
  const [roomCode, setRoomCode] = useState(roomFromPath)
  const [profile, setProfile] = useState<YutProfile | null>(() => {
    const code = roomFromPath()
    return code ? loadSession(code) : null
  })

  useEffect(() => {
    const onPop = () => {
      const code = roomFromPath()
      setRoomCode(code)
      setProfile(code ? loadSession(code) : null)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const enter = (code: string) => {
    history.pushState({}, '', `${APP_BASE}/yut/room/${code}`)
    setRoomCode(code)
    setProfile(loadSession(code))
  }
  const home = () => {
    history.pushState({}, '', `${APP_BASE}/yut/`)
    setRoomCode(null)
    setProfile(null)
  }
  const save = useCallback((session: YutSession) => {
    sessionStorage.setItem(`yut-session-${session.roomCode}`, JSON.stringify(session))
  }, [])

  if (!roomCode) return <YutLobby onEnter={enter} />
  if (!profile) return <YutProfileForm roomCode={roomCode} onSubmit={setProfile} onBack={home} />
  return <YutGame key={roomCode} roomCode={roomCode} profile={profile} onSession={save} onLeave={home} />
}

function YutLobby({ onEnter }: { onEnter: (code: string) => void }) {
  const [mode, setMode] = useState<YutMode>('lucky')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/yut/rooms?mode=${mode}`, { method: 'POST' })
      if (!response.ok) throw new Error()
      const data = await response.json()
      onEnter(data.roomCode)
    } catch {
      setError('윷놀이 방을 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  const join = (event: FormEvent) => {
    event.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(normalized)) return setError('5자리 방 코드를 확인해 주세요.')
    onEnter(normalized)
  }
  return <main className="yut-page yut-lobby">
    <section className="yut-card yut-hero">
      <img className="yut-lobby-title" src={yutAssets.ui.titleSign} alt="운빨 윷놀이" />
      <img className="yut-lobby-bag" src={yutAssets.ui.yutBag} alt="윷 주머니" />
      <p className="eyebrow">먼작귀게임방</p><h1 className="yut-visual-title">운빨윷놀이</h1><p>오늘 운 좋은 사람 누구야?</p>
      <div className="yut-mode-grid">
        <button className={mode === 'classic' ? 'selected' : ''} onClick={() => setMode('classic')}><img src={yutTileAsset('normal')} alt="" /><b>기본모드</b><small>정통 윷놀이 한 판!</small></button>
        <button className={mode === 'lucky' ? 'selected' : ''} onClick={() => setMode('lucky')}><span className="yut-mode-tiles"><img src={yutTileAsset('lucky')} alt="" /><img src={yutTileAsset('jackpot')} alt="" /><img src={yutTileAsset('danger')} alt="" /></span><b>운빨모드</b><small>판 전체가 사고뭉치!</small></button>
      </div>
      <button className="yut-primary" onClick={create} disabled={busy}>{busy ? '방 만드는 중…' : '방 만들기'}</button>
      <form className="yut-join" onSubmit={join}><input value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 5))} placeholder="방 코드" /><button>입장</button></form>
      {error && <p className="form-error">{error}</p>}
      <a className="yut-back-link" href={`${APP_BASE}/`}>← 게임방으로</a>
    </section>
  </main>
}

function YutProfileForm({ roomCode, onSubmit, onBack }: { roomCode: string; onSubmit: (profile: YutProfile) => void; onBack: () => void }) {
  const [nickname, setNickname] = useState('')
  const [character, setCharacter] = useState<CharacterId>('chiikawa')
  return <main className="yut-page yut-profile"><form className="yut-card" onSubmit={(event) => { event.preventDefault(); if (nickname.trim()) onSubmit({ nickname: nickname.trim(), character }) }}>
    <button type="button" className="yut-text-button" onClick={onBack}>← 돌아가기</button><p className="room-chip">ROOM · {roomCode}</p><h1>누구로 놀까요?</h1>
    <input className="nickname-input" value={nickname} onChange={(event) => setNickname(event.target.value.slice(0, 12))} placeholder="닉네임" autoFocus />
    <div className="yut-character-grid">{(Object.keys(characterAssets) as CharacterId[]).map((id) => <button type="button" key={id} className={character === id ? 'selected' : ''} onClick={() => setCharacter(id)}><CharacterAvatar character={id} /><span>{characterAssets[id].label}</span></button>)}</div>
    <button className="yut-primary" disabled={!nickname.trim()}>이 방에 들어가기</button>
  </form></main>
}

function YutGame({ roomCode, profile, onSession, onLeave }: { roomCode: string; profile: YutProfile; onSession: (session: YutSession) => void; onLeave: () => void }) {
  const { state, selfId, status, error, actionPending, send } = useYutSocket(roomCode, profile, onSession)
  const audio = useYutAudio(state, selfId)
  const { presenting, showResult } = useSharedRollPresentation(state, audio.play)
  const [copied, setCopied] = useState(false)
  const [selectedRollId, setSelectedRollId] = useState<number | null>(null)
  const [cardTarget, setCardTarget] = useState<CardTargetMode | null>(null)
  const boardColumnRef = useRef<HTMLDivElement | null>(null)
  const previousCanRoll = useRef(false)

  const myTurn = Boolean(state && state.turnPlayerId === selfId && state.status === 'playing')
  const blocking = Boolean(state?.pendingCapture || state?.pendingCard)
  const canRoll = Boolean(state && myTurn && state.mustRoll && !blocking && !presenting && !actionPending)

  useEffect(() => {
    if (canRoll && !previousCanRoll.current) audio.play('cta')
    previousCanRoll.current = canRoll
  }, [audio.play, canRoll])

  useEffect(() => {
    if (!state || state.mustRoll) {
      setSelectedRollId(null)
      return
    }
    if (selectedRollId !== null && state.pendingRolls.some((roll) => roll.id === selectedRollId)) return
    setSelectedRollId(state.pendingRolls.length === 1 ? state.pendingRolls[0].id : null)
  }, [selectedRollId, state?.mustRoll, state?.pendingRolls])

  useEffect(() => {
    if (state?.mode !== 'lucky') {
      setCardTarget(null)
      return
    }
    if (!state?.pendingCard && cardTarget?.source === 'drawn') setCardTarget(null)
    if (cardTarget?.source === 'hand' && !state?.hands[selfId ?? '']?.some((card) => card.instanceId === cardTarget.instanceId)) setCardTarget(null)
  }, [cardTarget, selfId, state?.hands, state?.pendingCard])

  useEffect(() => {
    if (state?.mode !== 'lucky') return
    const pending = state?.pendingCard
    if (!pending || pending.ownerId !== selfId) return
    const definition = state.cards.find((card) => card.id === pending.cardId)
    if (definition?.tier !== '💀' || !TARGETED_DANGER_CARDS.has(definition.id)) return
    setCardTarget((current) => current?.source === 'drawn' && current.cardId === definition.id
      ? current
      : { source: 'drawn', cardId: definition.id })
  }, [selfId, state?.cards, state?.pendingCard])

  const shouldFocusBoard = Boolean(presenting) || Boolean(state?.mode === 'lucky' && cardTarget) || Boolean(
    state
    && state.status === 'playing'
    && state.turnPlayerId === selfId
    && !state.mustRoll
    && !state.pendingCapture
    && !state.pendingCard
    && selectedRollId !== null
    && !presenting,
  )

  useEffect(() => {
    if (!shouldFocusBoard || !window.matchMedia('(max-width: 760px)').matches) return
    const frame = window.requestAnimationFrame(() => {
      boardColumnRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [cardTarget, selectedRollId, shouldFocusBoard])

  if (!state) return <main className="yut-page yut-loading"><img className="yut-loading-stick" src={yutAssets.results.yut} alt="윷" /><h1>윷판 펴는 중…</h1>{error && <div className="toast">{error}</div>}</main>

  const self = state.players.find((player) => player.id === selfId)
  const isLucky = state.mode === 'lucky'
  const activeCardTarget = isLucky ? cardTarget : null
  const opponent = state.players.find((player) => player.id !== selfId)
  const canMove = myTurn && !state.mustRoll && !blocking && selectedRollId !== null && !presenting && !activeCardTarget && !actionPending
  const hand = isLucky && selfId ? state.hands[selfId] ?? [] : []
  const winner = state.players.find((player) => player.id === state.winnerId)
  const selfHome = state.pieces.filter((piece) => piece.ownerId === selfId && piece.location === 'S' && !piece.finished)
  const opponentWaiting = opponent
    ? state.pieces.filter((piece) => piece.ownerId === opponent.id && piece.location === 'S' && !piece.finished).length
    : 0
  const pendingCardDefinition = state.cards.find((card) => card.id === state.pendingCard?.cardId)
  const selectedRoll = state.pendingRolls.find((roll) => roll.id === selectedRollId)
  const selectedMoveIsBackdo = selectedRoll?.steps === -1

  const stackSize = (piece: YutPiece) => state.pieces.filter((candidate) => (
    candidate.ownerId === piece.ownerId
    && !candidate.finished
    && candidate.location === piece.location
    && !['S', 'F'].includes(candidate.location)
  )).length

  const isSelectableForCard = (piece: YutPiece) => {
    if (!activeCardTarget || piece.finished || actionPending) return false
    const isMine = piece.ownerId === selfId
    const isOnBoard = !['S', 'F'].includes(piece.location)
    if (activeCardTarget.cardId === 'swap') return activeCardTarget.ownPieceId === undefined ? isMine && isOnBoard : !isMine && isOnBoard
    if (activeCardTarget.cardId === 'merge') return isMine && (activeCardTarget.ownPieceId === undefined || piece.id !== activeCardTarget.ownPieceId)
    if (activeCardTarget.cardId === 'split') return !isMine && isOnBoard && stackSize(piece) >= 2
    if (activeCardTarget.cardId === 'opponent_back') return !isMine && isOnBoard
    if (activeCardTarget.cardId === 'minus_three') return isMine && isOnBoard
    if (activeCardTarget.cardId === 'forced_split') return isMine && isOnBoard && stackSize(piece) >= 2
    return isMine
  }

  const selectablePieceKeys = activeCardTarget
    ? state.pieces.filter(isSelectableForCard).map((piece) => `${piece.ownerId}:${piece.id}`)
    : undefined

  const cardPayload = (target: CardTargetMode, pieceId?: number, targetPieceId?: number) => target.source === 'drawn'
    ? { type: 'card_choice', choice: 'use', pieceId, targetPieceId }
    : { type: 'use_card', instanceId: target.instanceId, pieceId, targetPieceId }

  const beginCardUse = (target: CardTargetMode) => {
    if (actionPending) return
    audio.play('select')
    if (AUTO_CARDS.has(target.cardId)) {
      send(cardPayload(target))
      return
    }
    setCardTarget(target)
  }

  const selectPiece = (selected: YutPiece) => {
    if (actionPending) return
    audio.play('select')
    if (!activeCardTarget) {
      if (selected.location === 'S' && selectedMoveIsBackdo) return
      if (selectedRollId !== null && send({ type: 'move', pieceId: selected.id, rollId: selectedRollId })) setSelectedRollId(null)
      return
    }
    if (activeCardTarget.cardId === 'swap') {
      if (activeCardTarget.ownPieceId === undefined) return setCardTarget({ ...activeCardTarget, ownPieceId: selected.id })
      send(cardPayload(activeCardTarget, activeCardTarget.ownPieceId, selected.id))
    } else if (activeCardTarget.cardId === 'merge') {
      if (activeCardTarget.ownPieceId === undefined) return setCardTarget({ ...activeCardTarget, ownPieceId: selected.id })
      if (selected.id === activeCardTarget.ownPieceId) return
      send(cardPayload(activeCardTarget, activeCardTarget.ownPieceId, selected.id))
    } else if (OPPONENT_CARDS.has(activeCardTarget.cardId)) {
      send(cardPayload(activeCardTarget, undefined, selected.id))
    } else {
      send(cardPayload(activeCardTarget, selected.id))
    }
  }

  let selectionMode: YutPieceSelectionMode = canMove ? 'move' : null
  if (activeCardTarget) {
    if (OPPONENT_CARDS.has(activeCardTarget.cardId) || (activeCardTarget.cardId === 'swap' && activeCardTarget.ownPieceId !== undefined)) selectionMode = 'opponent'
    else selectionMode = 'own'
  }

  const cardGuide = activeCardTarget
    ? activeCardTarget.cardId === 'minus_three'
      ? '💀 벌칙! 뒤로 갈 말을 골라줘!'
      : activeCardTarget.cardId === 'forced_split'
        ? '💀 벌칙! 해산할 말을 골라줘!'
        : activeCardTarget.cardId === 'swap'
      ? activeCardTarget.ownPieceId === undefined ? '자리 바꿀 내 말을 골라줘!' : '자리 바꿀 상대 말을 골라줘!'
      : activeCardTarget.cardId === 'merge'
        ? activeCardTarget.ownPieceId === undefined ? '합체의 기준이 될 내 말을 골라줘!' : '함께 합칠 내 말을 하나 더 골라줘!'
        : OPPONENT_CARDS.has(activeCardTarget.cardId) ? '카드를 적용할 상대 말을 골라줘!' : '카드를 적용할 내 말을 골라줘!'
    : null

  const event = state.lastEvent
  const autoBackdoReroll = Boolean(event?.autoReroll && presenting?.id === event.roll?.id)
  const eventCard = state.cards.find((card) => card.id === (event?.cardId ?? event?.code))
  const eventTileKind: YutTileKind = eventCard?.tier === '✨' ? 'jackpot' : eventCard?.tier === '💀' ? 'danger' : 'lucky'
  const rollNow = () => {
    if (!canRoll) return
    audio.play('press')
    send({ type: 'roll' })
  }
  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}${APP_BASE}/yut/room/${roomCode}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <main className={`yut-page yut-game ${myTurn ? 'is-my-turn' : ''}`}>
    <header className="yut-header"><button className="yut-brand" onClick={() => { if (confirm('방을 나갈까요?')) onLeave() }}><img src={yutAssets.ui.titleSign} alt="운빨 윷놀이" /></button><button className="yut-room" onClick={copy}>{roomCode} · {copied ? '복사됨!' : '초대'}</button><div className="yut-audio-controls"><button type="button" aria-pressed={audio.bgmEnabled} onClick={audio.toggleBgm}>BGM {audio.bgmEnabled ? 'ON' : 'OFF'}</button><button type="button" aria-pressed={audio.sfxEnabled} onClick={audio.toggleSfx}>효과음 {audio.sfxEnabled ? 'ON' : 'OFF'}</button><span>{status === 'connected' ? '연결됨' : '연결 중'}</span></div></header>
    <section className="yut-player-row">
      <div className={`yut-player-card ${myTurn ? 'active' : ''}`}>{self && <><CharacterAvatar character={self.character} active={myTurn} /><div><b>{self.nickname}</b><small>완주 {state.pieces.filter((piece) => piece.ownerId === self.id && piece.finished).length}/4</small></div></>}</div>
      <div className="yut-vs">{self?.score ?? 0} : {opponent?.score ?? 0}</div>
      <div className={`yut-player-card ${state.turnPlayerId === opponent?.id ? 'active' : ''}`}>{opponent ? <><CharacterAvatar character={opponent.character} active={state.turnPlayerId === opponent.id} /><div><b>{opponent.nickname}</b><small>완주 {state.pieces.filter((piece) => piece.ownerId === opponent.id && piece.finished).length}/4 · 출발 대기 {opponentWaiting}</small></div></> : <b>친구 기다리는 중…</b>}</div>
    </section>
    <section className="yut-main-grid">
      <div ref={boardColumnRef} className="yut-board-column">
        {state.pendingCapture && state.pendingCapture.ownerId !== selfId && <div className="yut-selection-guide">상대가 잡기를 확인하는 중…</div>}
        {isLucky && state.pendingCard && state.pendingCard.ownerId !== selfId && <div className="yut-selection-guide">상대가 운빨카드를 고르는 중…</div>}
        {cardGuide && <div className={`yut-selection-guide ${pendingCardDefinition?.tier === '💀' ? 'is-danger' : ''}`} role="status">{cardGuide}</div>}
        {!activeCardTarget && myTurn && state.mustRoll && !blocking && <div className="yut-selection-guide">{state.pendingRolls.length ? '윷/모가 나왔어요! 추가 윷부터 모두 던져줘!' : '윷을 던져줘!'}</div>}
        {!activeCardTarget && myTurn && !state.mustRoll && state.pendingRolls.length > 1 && selectedRollId === null && !blocking && <div className="yut-selection-guide">사용할 윷 결과를 먼저 골라줘!</div>}
        {canMove && <div className="yut-selection-guide">{selectedRoll ? `${ROLL_LABEL[selectedRoll.name]} 선택됨 · ${selectedMoveIsBackdo ? '판 위의 말을 골라줘!' : '움직일 말을 골라줘!'}` : '움직일 말을 골라줘!'}</div>}
        <div className="yut-board-stage">
          <YutBoard state={state} selfId={selfId} selectionMode={selectionMode} selectedPieceIds={activeCardTarget?.ownPieceId === undefined ? [] : [activeCardTarget.ownPieceId]} selectablePieceKeys={selectablePieceKeys} onSelect={selectPiece} onHop={() => audio.play('move')} />

          {canRoll && (
            <div className="yut-board-roll-cta-layer">
              <button className="yut-board-roll-cta" type="button" aria-label="내 차례야! 윷을 던져줘" onClick={rollNow}>
                <span>내 차례야! 윷을 던져줘</span>
                <img src={yutAssets.ui.rollButton} alt="" />
              </button>
            </div>
          )}

          {presenting && (
            <div className={`yut-board-throw-overlay is-${presenting.name}`}>
              <div className="yut-throw-stage" aria-label="윷을 던지는 중">
                {[0, 1, 2, 3].map((stick) => (
                  <img
                    key={stick}
                    style={{ '--stick': stick } as CSSProperties}
                    src={yutResultAsset(presenting.name) ?? yutAssets.results.do}
                    alt=""
                  />
                ))}
              </div>

              {showResult && (
                <div className={`yut-roll-readout is-${presenting.name}`} role="status">
                  <strong>{ROLL_LABEL[presenting.name]}!</strong>
                  <span>{autoBackdoReroll ? '움직일 말이 없어서 다시 던져!' : `${presenting.steps}칸 이동`}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <aside className="yut-controls">
        <div className={`yut-status ${myTurn ? 'is-my-turn' : ''}`}><img src={state.status === 'finished' ? yutAssets.ui.finish : myTurn ? yutAssets.ui.myTurn : yutAssets.ui.opponentTurn} alt="" /><span>{state.mode === 'lucky' ? '운빨모드' : '기본모드'}</span><h2>{state.status === 'waiting' ? '친구를 기다려요' : state.status === 'finished' ? `${winner?.nickname ?? ''} 승리!` : myTurn ? '내 차례!' : '상대 차례…'}</h2></div>
        {self && selfHome.length > 0 && (
          <section className="yut-home-panel" aria-label={`내 출발 대기 말 ${selfHome.length}개`}>
            <b>내 출발 대기 <span>{selfHome.length}</span></b>

            <div className="yut-home-grid">
              {selfHome.map((homePiece) => {
                const canSelectHome = !actionPending && ((selectionMode === 'move' && !selectedMoveIsBackdo) || (selectionMode === 'own' && isSelectableForCard(homePiece)))

                return (
                  <button
                    key={homePiece.id}
                    type="button"
                    className={`yut-home-piece ${activeCardTarget?.ownPieceId === homePiece.id ? 'is-selected' : ''}`}
                    aria-label={`내 출발 대기 말 ${homePiece.id + 1}`}
                    disabled={!canSelectHome}
                    onClick={() => selectPiece(homePiece)}
                  >
                    <CharacterAvatar character={self.character} active={canSelectHome} />
                  </button>
                )
              })}
            </div>
          </section>
        )}
        <div className="yut-roll-result"><img src={yutAssets.ui.yutBag} alt="윷 주머니" /></div>
        {state.pendingRolls.length > 0 && <div className="yut-roll-pool" aria-label="저장된 윷 결과">{state.pendingRolls.map((roll) => <button key={roll.id} className={`yut-roll-chip is-${roll.name} ${selectedRollId === roll.id ? 'selected' : ''}`} aria-pressed={selectedRollId === roll.id} disabled={!myTurn || state.mustRoll || blocking || Boolean(presenting) || actionPending} onClick={() => { audio.play('select'); setSelectedRollId(roll.id) }}><img src={yutResultAsset(roll.name) ?? yutAssets.results.do} alt="" /><span>{ROLL_LABEL[roll.name]} · {roll.steps}칸</span></button>)}</div>}
        {state.pendingCapture?.ownerId === selfId && <div className="yut-action-sheet yut-capture-sheet" role="dialog" aria-label="잡기 확인"><h3>잡을까요?</h3><p>상대 말 {state.pendingCapture.targetPieceIds.length}개를 잡을 수 있어!</p><button className="yut-primary" disabled={actionPending} onClick={() => { audio.play('press'); send({ type: 'confirm_capture' }) }}>{actionPending ? '잡는 중…' : '잡기!'}</button></div>}
        {isLucky && state.pendingCard?.ownerId === selfId && pendingCardDefinition && (pendingCardDefinition.tier === '💀'
          ? <ForcedCardSheet card={pendingCardDefinition} />
          : <CardChoiceSheet card={pendingCardDefinition} disabled={actionPending} onKeep={() => { audio.play('select'); send({ type: 'card_choice', choice: 'keep' }) }} onUse={() => beginCardUse({ source: 'drawn', cardId: pendingCardDefinition.id })} />)}
        {isLucky && <section className="yut-hand" aria-label="KEEP한 카드"><b className="yut-hand-title">KEEP 카드 {hand.length}</b>{hand.map((instance) => {
          const definition = state.cards.find((card) => card.id === instance.cardId)
          return definition && <button key={instance.instanceId} className="yut-hand-card" disabled={!myTurn || state.mustRoll || blocking || Boolean(presenting) || actionPending} onClick={() => beginCardUse({ source: 'hand', instanceId: instance.instanceId, cardId: instance.cardId })}><img src={yutCardAsset(instance.cardId) ?? ''} alt="" /><span>{definition.label}</span></button>
        })}</section>}
        {isLucky && event?.type === 'card_used' && eventCard && <div className={`yut-event yut-event--${eventTileKind}`}><img className="yut-event-card" src={yutCardAsset(eventCard.id) ?? ''} alt="" /><strong>카드 사용!</strong><b>{eventCard.label}</b><span>{eventCard.effect}</span></div>}
        {event?.type === 'capture_confirmed' && <div className="yut-capture-event"><img src={yutAssets.ui.capture} alt="" /><b>잡았습니다! 한 번 더!</b></div>}
        {state.status === 'finished' && <button className="yut-secondary" disabled={actionPending || Boolean(selfId && state.rematchReady.includes(selfId))} onClick={() => send({ type: 'rematch_request' })}><img src={yutAssets.ui.finish} alt="완주" />{selfId && state.rematchReady.includes(selfId) ? '상대를 기다리는 중…' : actionPending ? '신청 중…' : '한 판 더?'}</button>}
        <p className="yut-rule">윷·모 또는 상대 말을 잡으면 한 번 더!{isLucky && <span className="yut-rule-tiles"><img src={yutTileAsset('lucky')} alt="행운칸" /><img src={yutTileAsset('jackpot')} alt="대박칸" /><img src={yutTileAsset('danger')} alt="위험칸" /></span>}</p>
      </aside>
    </section>
    {error && <div className="toast">{error}</div>}
  </main>
}

function CardChoiceSheet({ card, disabled, onKeep, onUse }: { card: YutCardDefinition; disabled: boolean; onKeep: () => void; onUse: () => void }) {
  return <div className={`yut-action-sheet yut-card-choice ${card.tier === '✨' ? 'is-jackpot' : ''}`} role="dialog" aria-label="운빨카드 선택">
    <img src={yutCardAsset(card.id) ?? ''} alt="" />
    <div><small>{card.tier} 운빨카드</small><h3>{card.label}</h3><p>{card.effect}</p></div>
    <div className="yut-card-choice-actions"><button className="yut-secondary" disabled={disabled} onClick={onKeep}>KEEP</button><button className="yut-primary" disabled={disabled} onClick={onUse}>지금 사용</button></div>
  </div>
}

function ForcedCardSheet({ card }: { card: YutCardDefinition }) {
  return <div className="yut-action-sheet yut-card-choice yut-card-choice--forced" role="dialog" aria-label="벌칙카드 강제 적용">
    <img src={yutCardAsset(card.id) ?? ''} alt="" />
    <div><small>💀 벌칙카드 · KEEP 불가</small><h3>{card.label}</h3><p>{card.effect}</p><b>{card.id === 'forced_split' ? '업힌 내 말을 선택하면 즉시 해산돼요.' : '판 위의 내 말을 선택하면 즉시 적용돼요.'}</b></div>
  </div>
}
