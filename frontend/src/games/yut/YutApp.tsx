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
  const roll = state?.lastEvent?.type === 'roll' ? state.lastEvent.roll : undefined

  useEffect(() => {
    if (!roll || seenRollId.current === roll.id) return
    seenRollId.current = roll.id
    setPresenting(roll)
    setShowResult(false)
    playSound('throw')
    const reveal = window.setTimeout(() => {
      setShowResult(true)
      playSound('landing')
      playSound(['yut', 'mo'].includes(roll.name) ? 'bigResult' : roll.name === 'backdo' ? 'backdo' : 'smallResult')
    }, 900)
    const done = window.setTimeout(() => setPresenting(null), 2050)
    return () => {
      window.clearTimeout(reveal)
      window.clearTimeout(done)
    }
  }, [playSound, roll?.id])

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
  return <YutGame roomCode={roomCode} profile={profile} onSession={save} onLeave={home} />
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
  const { state, selfId, status, error, send } = useYutSocket(roomCode, profile, onSession)
  const audio = useYutAudio(state, selfId)
  const { presenting, showResult } = useSharedRollPresentation(state, audio.play)
  const [copied, setCopied] = useState(false)
  const [selectedRollId, setSelectedRollId] = useState<number | null>(null)
  const [cardTarget, setCardTarget] = useState<CardTargetMode | null>(null)

  useEffect(() => {
    if (!state || state.mustRoll) {
      setSelectedRollId(null)
      return
    }
    if (selectedRollId !== null && state.pendingRolls.some((roll) => roll.id === selectedRollId)) return
    setSelectedRollId(state.pendingRolls.length === 1 ? state.pendingRolls[0].id : null)
  }, [selectedRollId, state?.mustRoll, state?.pendingRolls])

  useEffect(() => {
    if (!state?.pendingCard && cardTarget?.source === 'drawn') setCardTarget(null)
  }, [cardTarget?.source, state?.pendingCard])

  if (!state) return <main className="yut-page yut-loading"><img className="yut-loading-stick" src={yutAssets.results.yut} alt="윷" /><h1>윷판 펴는 중…</h1>{error && <div className="toast">{error}</div>}</main>

  const self = state.players.find((player) => player.id === selfId)
  const opponent = state.players.find((player) => player.id !== selfId)
  const myTurn = state.turnPlayerId === selfId && state.status === 'playing'
  const blocking = Boolean(state.pendingCapture || state.pendingCard)
  const canRoll = myTurn && state.mustRoll && !blocking && !presenting
  const canMove = myTurn && !state.mustRoll && !blocking && selectedRollId !== null && !presenting && !cardTarget
  const hand = selfId ? state.hands[selfId] ?? [] : []
  const winner = state.players.find((player) => player.id === state.winnerId)
  const pendingCardDefinition = state.cards.find((card) => card.id === state.pendingCard?.cardId)

  const cardPayload = (target: CardTargetMode, pieceId?: number, targetPieceId?: number) => target.source === 'drawn'
    ? { type: 'card_choice', choice: 'use', pieceId, targetPieceId }
    : { type: 'use_card', instanceId: target.instanceId, pieceId, targetPieceId }

  const beginCardUse = (target: CardTargetMode) => {
    if (AUTO_CARDS.has(target.cardId)) {
      send(cardPayload(target))
      return
    }
    setCardTarget(target)
  }

  const selectPiece = (selected: YutPiece) => {
    if (!cardTarget) {
      if (selectedRollId !== null && send({ type: 'move', pieceId: selected.id, rollId: selectedRollId })) setSelectedRollId(null)
      return
    }
    if (cardTarget.cardId === 'swap') {
      if (cardTarget.ownPieceId === undefined) return setCardTarget({ ...cardTarget, ownPieceId: selected.id })
      send(cardPayload(cardTarget, cardTarget.ownPieceId, selected.id))
    } else if (cardTarget.cardId === 'merge') {
      if (cardTarget.ownPieceId === undefined) return setCardTarget({ ...cardTarget, ownPieceId: selected.id })
      if (selected.id === cardTarget.ownPieceId) return
      send(cardPayload(cardTarget, cardTarget.ownPieceId, selected.id))
    } else if (OPPONENT_CARDS.has(cardTarget.cardId)) {
      send(cardPayload(cardTarget, undefined, selected.id))
    } else {
      send(cardPayload(cardTarget, selected.id))
    }
    setCardTarget(null)
  }

  let selectionMode: YutPieceSelectionMode = canMove ? 'move' : null
  if (cardTarget) {
    if (OPPONENT_CARDS.has(cardTarget.cardId) || (cardTarget.cardId === 'swap' && cardTarget.ownPieceId !== undefined)) selectionMode = 'opponent'
    else selectionMode = 'own'
  }

  const cardGuide = cardTarget
    ? cardTarget.cardId === 'swap'
      ? cardTarget.ownPieceId === undefined ? '자리 바꿀 내 말을 골라줘!' : '자리 바꿀 상대 말을 골라줘!'
      : cardTarget.cardId === 'merge'
        ? cardTarget.ownPieceId === undefined ? '합체의 기준이 될 내 말을 골라줘!' : '함께 합칠 내 말을 하나 더 골라줘!'
        : OPPONENT_CARDS.has(cardTarget.cardId) ? '카드를 적용할 상대 말을 골라줘!' : '카드를 적용할 내 말을 골라줘!'
    : null

  const event = state.lastEvent
  const eventCard = state.cards.find((card) => card.id === (event?.cardId ?? event?.code))
  const eventTileKind: YutTileKind = eventCard?.tier === '✨' ? 'jackpot' : eventCard?.tier === '💀' ? 'danger' : 'lucky'
  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}${APP_BASE}/yut/room/${roomCode}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <main className="yut-page yut-game">
    <header className="yut-header"><button className="yut-brand" onClick={() => { if (confirm('방을 나갈까요?')) onLeave() }}><img src={yutAssets.ui.titleSign} alt="운빨 윷놀이" /></button><button className="yut-room" onClick={copy}>{roomCode} · {copied ? '복사됨!' : '초대'}</button><div className="yut-audio-controls"><button type="button" aria-pressed={audio.bgmEnabled} onClick={audio.toggleBgm}>BGM {audio.bgmEnabled ? 'ON' : 'OFF'}</button><button type="button" aria-pressed={audio.sfxEnabled} onClick={audio.toggleSfx}>효과음 {audio.sfxEnabled ? 'ON' : 'OFF'}</button><span>{status === 'connected' ? '연결됨' : '연결 중'}</span></div></header>
    <section className="yut-player-row">
      <div className={`yut-player-card ${myTurn ? 'active' : ''}`}>{self && <><CharacterAvatar character={self.character} active={myTurn} /><div><b>{self.nickname}</b><small>완주 {state.pieces.filter((piece) => piece.ownerId === self.id && piece.finished).length}/4</small></div></>}</div>
      <div className="yut-vs">{self?.score ?? 0} : {opponent?.score ?? 0}</div>
      <div className={`yut-player-card ${state.turnPlayerId === opponent?.id ? 'active' : ''}`}>{opponent ? <><CharacterAvatar character={opponent.character} active={state.turnPlayerId === opponent.id} /><div><b>{opponent.nickname}</b><small>완주 {state.pieces.filter((piece) => piece.ownerId === opponent.id && piece.finished).length}/4</small></div></> : <b>친구 기다리는 중…</b>}</div>
    </section>
    <section className="yut-main-grid">
      <div className="yut-board-column">
        {state.pendingCapture && state.pendingCapture.ownerId !== selfId && <div className="yut-selection-guide">상대가 잡기를 확인하는 중…</div>}
        {state.pendingCard && state.pendingCard.ownerId !== selfId && <div className="yut-selection-guide">상대가 운빨카드를 고르는 중…</div>}
        {cardGuide && <div className="yut-selection-guide">{cardGuide}</div>}
        {!cardTarget && myTurn && state.mustRoll && !blocking && <div className="yut-selection-guide">{state.pendingRolls.length ? '윷/모가 나왔어요! 추가 윷부터 모두 던져줘!' : '윷을 던져줘!'}</div>}
        {!cardTarget && myTurn && !state.mustRoll && state.pendingRolls.length > 1 && selectedRollId === null && !blocking && <div className="yut-selection-guide">사용할 윷 결과를 먼저 골라줘!</div>}
        {canMove && <div className="yut-selection-guide">움직일 말을 골라줘!</div>}
        <YutBoard state={state} selfId={selfId} selectionMode={selectionMode} selectedPieceIds={cardTarget?.ownPieceId === undefined ? [] : [cardTarget.ownPieceId]} onSelect={selectPiece} onHop={() => audio.play('landing')} />
      </div>
      <aside className="yut-controls">
        <div className="yut-status"><img src={state.status === 'finished' ? yutAssets.ui.finish : myTurn ? yutAssets.ui.myTurn : yutAssets.ui.opponentTurn} alt="" /><span>{state.mode === 'lucky' ? '운빨모드' : '기본모드'}</span><h2>{state.status === 'waiting' ? '친구를 기다려요' : state.status === 'finished' ? `${winner?.nickname ?? ''} 승리!` : myTurn ? '내 차례!' : '상대 차례…'}</h2></div>
        <div className={`yut-roll-result ${presenting ? 'is-rolling' : ''}`} aria-live="polite">{presenting ? <div className="yut-throw-stage" aria-label="윷을 던지는 중">{[0, 1, 2, 3].map((stick) => <img key={stick} style={{ '--stick': stick } as CSSProperties} src={yutResultAsset(presenting.name) ?? yutAssets.results.do} alt="" />)}</div> : <img src={yutAssets.ui.yutBag} alt="윷 주머니" />}</div>
        {state.pendingRolls.length > 0 && <div className="yut-roll-pool" aria-label="저장된 윷 결과">{state.pendingRolls.map((roll) => <button key={roll.id} className={`yut-roll-chip ${selectedRollId === roll.id ? 'selected' : ''}`} disabled={!myTurn || state.mustRoll || blocking || Boolean(presenting)} onClick={() => setSelectedRollId(roll.id)}><img src={yutResultAsset(roll.name) ?? yutAssets.results.do} alt="" /><span>{ROLL_LABEL[roll.name]} · {roll.steps}칸</span></button>)}</div>}
        <button className="yut-primary yut-roll-button" disabled={!canRoll} onClick={() => send({ type: 'roll' })}>{presenting ? <span>윷이 날아간다!</span> : <img src={yutAssets.ui.rollButton} alt="윷 던지기!" />}</button>
        {state.pendingCapture?.ownerId === selfId && <div className="yut-action-sheet" role="dialog" aria-label="잡기 확인"><h3>잡을까요?</h3><p>상대 말 {state.pendingCapture.targetPieceIds.length}개를 잡을 수 있어!</p><button className="yut-primary" onClick={() => send({ type: 'confirm_capture' })}>잡기!</button></div>}
        {state.pendingCard?.ownerId === selfId && pendingCardDefinition && <CardChoiceSheet card={pendingCardDefinition} onKeep={() => send({ type: 'card_choice', choice: 'keep' })} onUse={() => beginCardUse({ source: 'drawn', cardId: pendingCardDefinition.id })} />}
        <section className="yut-hand" aria-label="KEEP한 카드"><b className="yut-hand-title">KEEP 카드 {hand.length}</b>{hand.map((instance) => {
          const definition = state.cards.find((card) => card.id === instance.cardId)
          return definition && <button key={instance.instanceId} className="yut-hand-card" disabled={!myTurn || state.mustRoll || blocking || Boolean(presenting)} onClick={() => beginCardUse({ source: 'hand', instanceId: instance.instanceId, cardId: instance.cardId })}><img src={yutCardAsset(instance.cardId) ?? ''} alt="" /><span>{definition.label}</span></button>
        })}</section>
        {event?.type === 'card_used' && eventCard && <div className={`yut-event yut-event--${eventTileKind}`}><img className="yut-event-card" src={yutCardAsset(eventCard.id) ?? ''} alt="" /><strong>카드 사용!</strong><b>{eventCard.label}</b><span>{eventCard.effect}</span></div>}
        {event?.type === 'capture_confirmed' && <div className="yut-capture-event"><img src={yutAssets.ui.capture} alt="" /><b>잡았습니다! 한 번 더!</b></div>}
        {state.status === 'finished' && <button className="yut-secondary" onClick={() => send({ type: 'rematch_request' })}><img src={yutAssets.ui.finish} alt="완주" />한 판 더?</button>}
        <p className="yut-rule">윷·모 또는 상대 말을 잡으면 한 번 더!<span className="yut-rule-tiles"><img src={yutTileAsset('lucky')} alt="행운칸" /><img src={yutTileAsset('jackpot')} alt="대박칸" /><img src={yutTileAsset('danger')} alt="위험칸" /></span></p>
      </aside>
    </section>
    {showResult && presenting && <div className={`yut-result-popup yut-result-popup--${presenting.name}`} role="status"><img src={yutResultAsset(presenting.name) ?? yutAssets.results.do} alt="" /><strong>{ROLL_LABEL[presenting.name]}!</strong><span>{presenting.steps}칸 이동</span></div>}
    {error && <div className="toast">{error}</div>}
  </main>
}

function CardChoiceSheet({ card, onKeep, onUse }: { card: YutCardDefinition; onKeep: () => void; onUse: () => void }) {
  return <div className="yut-action-sheet yut-card-choice" role="dialog" aria-label="운빨카드 선택">
    <img src={yutCardAsset(card.id) ?? ''} alt="" />
    <div><small>{card.tier} 운빨카드</small><h3>{card.label}</h3><p>{card.effect}</p></div>
    <div className="yut-card-choice-actions"><button className="yut-secondary" onClick={onKeep}>KEEP</button><button className="yut-primary" onClick={onUse}>지금 사용</button></div>
  </div>
}
