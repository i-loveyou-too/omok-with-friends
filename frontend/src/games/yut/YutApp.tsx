import './yut.css'
import { FormEvent, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CharacterAvatar } from '../../components/CharacterAvatar'
import { characterAssets } from '../../assets/characters/manifest'
import type { CharacterId } from '../../types'
import { yutAssets, yutCardAsset, yutResultAsset, yutTileAsset, type YutTileKind } from './assets'
import { ROLL_LABEL } from './board'
import { useYutSocket } from './useYutSocket'
import { useYutAudio } from './useYutAudio'
import { YutBoard } from './YutBoard'
import type { YutMode, YutProfile, YutSession } from './types'

const API = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/omok/api'

function roomFromPath() {
  return location.pathname.match(/\/omok\/yut\/room\/([A-Z0-9]{5})/i)?.[1]?.toUpperCase() ?? null
}
function loadSession(code: string): YutSession | null {
  try { return JSON.parse(localStorage.getItem(`yut-session-${code}`) ?? 'null') } catch { return null }
}

export function YutApp() {
  const [roomCode, setRoomCode] = useState(roomFromPath)
  const [profile, setProfile] = useState<YutProfile | null>(() => roomFromPath() ? loadSession(roomFromPath()!) : null)

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
    history.pushState({}, '', `/omok/yut/room/${code}`)
    setRoomCode(code)
    setProfile(loadSession(code))
  }
  const home = () => {
    history.pushState({}, '', '/omok/yut/')
    setRoomCode(null)
    setProfile(null)
  }
  const save = useCallback((session: YutSession) => localStorage.setItem(`yut-session-${session.roomCode}`, JSON.stringify(session)), [])

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
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/yut/rooms?mode=${mode}`, { method: 'POST' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      onEnter(data.roomCode)
    } catch { setError('윷놀이 방을 만들지 못했어요.') } finally { setBusy(false) }
  }
  const join = (event: FormEvent) => {
    event.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(normalized)) return setError('5자리 방 코드를 확인해 주세요.')
    onEnter(normalized)
  }
  return <main className="yut-page yut-lobby">
    <section className="yut-card yut-hero">
      <img className="yut-lobby-title" src={yutAssets.ui.titleSign} alt="운빨 윷놀이"/>
      <img className="yut-lobby-bag" src={yutAssets.ui.yutBag} alt="윷 주머니"/>
      <p className="eyebrow">먼작귀게임방</p><h1 className="yut-visual-title">운빨윷놀이</h1><p>오늘 운 좋은 사람 누구야?</p>
      <div className="yut-mode-grid">
        <button className={mode === 'classic' ? 'selected' : ''} onClick={() => setMode('classic')}><img src={yutTileAsset('normal')} alt=""/><b>기본모드</b><small>정통 윷놀이 한 판!</small></button>
        <button className={mode === 'lucky' ? 'selected' : ''} onClick={() => setMode('lucky')}><span className="yut-mode-tiles"><img src={yutTileAsset('lucky')} alt=""/><img src={yutTileAsset('jackpot')} alt=""/><img src={yutTileAsset('danger')} alt=""/></span><b>운빨모드</b><small>판 전체가 사고뭉치!</small></button>
      </div>
      <button className="yut-primary" onClick={create} disabled={busy}>{busy ? '방 만드는 중…' : '방 만들기'}</button>
      <form className="yut-join" onSubmit={join}><input value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 5))} placeholder="방 코드"/><button>입장</button></form>
      {error && <p className="form-error">{error}</p>}
      <a className="yut-back-link" href="/omok/">← 오목 한 판?으로</a>
    </section>
  </main>
}

function YutProfileForm({ roomCode, onSubmit, onBack }: { roomCode: string; onSubmit: (p: YutProfile) => void; onBack: () => void }) {
  const [nickname, setNickname] = useState('')
  const [character, setCharacter] = useState<CharacterId>('chiikawa')
  return <main className="yut-page yut-profile"><form className="yut-card" onSubmit={(e) => { e.preventDefault(); if (nickname.trim()) onSubmit({ nickname: nickname.trim(), character }) }}>
    <button type="button" className="yut-text-button" onClick={onBack}>← 돌아가기</button><p className="room-chip">ROOM · {roomCode}</p><h1>누구로 놀까요?</h1>
    <input className="nickname-input" value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 12))} placeholder="닉네임" autoFocus />
    <div className="yut-character-grid">{(Object.keys(characterAssets) as CharacterId[]).map((id) => <button type="button" key={id} className={character === id ? 'selected' : ''} onClick={() => setCharacter(id)}><CharacterAvatar character={id}/><span>{characterAssets[id].label}</span></button>)}</div>
    <button className="yut-primary" disabled={!nickname.trim()}>이 방에 들어가기</button>
  </form></main>
}

function YutGame({ roomCode, profile, onSession, onLeave }: { roomCode: string; profile: YutProfile; onSession: (s: YutSession) => void; onLeave: () => void }) {
  const { state, selfId, status, error, send } = useYutSocket(roomCode, profile, onSession)
  const audio = useYutAudio(state, selfId)
  const playSound = audio.play
  const [copied, setCopied] = useState(false)
  const [isRolling, setIsRolling] = useState(false)
  const [showResultPopup, setShowResultPopup] = useState(false)
  const requestedRoll = useRef(false)

  useEffect(() => {
    const pendingRoll = state?.pendingRoll
    if (!pendingRoll || !requestedRoll.current) return
    const revealTimer = window.setTimeout(() => {
      requestedRoll.current = false
      setIsRolling(false)
      setShowResultPopup(true)
      playSound('landing')
      if (pendingRoll.name === 'backdo') playSound('backdo')
      else if (['yut', 'mo'].includes(pendingRoll.name)) playSound('bigResult')
      else playSound('smallResult')
    }, 980)
    const hideTimer = window.setTimeout(() => setShowResultPopup(false), 2180)
    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(hideTimer)
    }
  }, [playSound, state?.pendingRoll?.name, state?.pendingRoll?.steps])

  useEffect(() => {
    if (!state?.pendingRoll) setShowResultPopup(false)
  }, [state?.pendingRoll])

  const roll = () => {
    if (isRolling) return
    requestedRoll.current = true
    setShowResultPopup(false)
    setIsRolling(true)
    playSound('throw')
    if (!send({ type: 'roll' })) {
      requestedRoll.current = false
      setIsRolling(false)
    }
  }

  if (!state) return <main className="yut-page yut-loading"><img className="yut-loading-stick" src={yutAssets.results.yut} alt="윷"/><h1>윷판 펴는 중…</h1>{error && <div className="toast">{error}</div>}</main>
  const self = state.players.find((p) => p.id === selfId)
  const opponent = state.players.find((p) => p.id !== selfId)
  const myTurn = state.turnPlayerId === selfId && state.status === 'playing'
  const canMove = myTurn && Boolean(state.pendingRoll) && !isRolling
  const event = state.lastEvent
  const card = state.cards.find((definition) => definition.id === event?.code)
  const cardAsset = yutCardAsset(card?.id)
  const resultAsset = yutResultAsset(state.pendingRoll?.name)
  const eventTileKind: YutTileKind = event?.tier === '✨' ? 'jackpot' : event?.tier === '💀' ? 'danger' : 'lucky'
  const eventTierLabel = eventTileKind === 'jackpot' ? '대박' : eventTileKind === 'danger' ? '위험' : '행운'
  const capturedForExtraTurn = state.extraRoll && event?.type === 'roll' && !['yut', 'mo'].includes(event.name ?? '')
  const winner = state.players.find((p) => p.id === state.winnerId)
  const copy = async () => { await navigator.clipboard.writeText(`${location.origin}/omok/yut/room/${roomCode}`); setCopied(true); setTimeout(() => setCopied(false), 1600) }
  return <main className="yut-page yut-game">
    <header className="yut-header"><button className="yut-brand" onClick={() => { if (confirm('방을 나갈까요?')) onLeave() }}><img src={yutAssets.ui.titleSign} alt="운빨 윷놀이"/></button><button className="yut-room" onClick={copy}>{roomCode} · {copied ? '복사됨!' : '초대'}</button><div className="yut-audio-controls"><button type="button" aria-pressed={audio.bgmEnabled} onClick={audio.toggleBgm}>BGM {audio.bgmEnabled ? 'ON' : 'OFF'}</button><button type="button" aria-pressed={audio.sfxEnabled} onClick={audio.toggleSfx}>효과음 {audio.sfxEnabled ? 'ON' : 'OFF'}</button><span>{status === 'connected' ? '연결됨' : '연결 중'}</span></div></header>
    <section className="yut-player-row">
      <div className={`yut-player-card ${myTurn ? 'active' : ''}`}>{self && <><CharacterAvatar character={self.character} active={myTurn}/><div><b>{self.nickname}</b><small>완주 {state.pieces.filter((p) => p.ownerId === self.id && p.finished).length}/4</small></div></>}</div>
      <div className="yut-vs">{self?.score ?? 0} : {opponent?.score ?? 0}</div>
      <div className={`yut-player-card ${state.turnPlayerId === opponent?.id ? 'active' : ''}`}>{opponent ? <><CharacterAvatar character={opponent.character} active={state.turnPlayerId === opponent.id}/><div><b>{opponent.nickname}</b><small>완주 {state.pieces.filter((p) => p.ownerId === opponent.id && p.finished).length}/4</small></div></> : <b>친구 기다리는 중…</b>}</div>
    </section>
    <section className="yut-main-grid"><YutBoard state={state} selfId={selfId} canMove={canMove} onMove={(id) => send({ type: 'move', pieceId: id })}/>
      <aside className="yut-controls"><div className="yut-status"><img src={state.status === 'finished' ? yutAssets.ui.finish : myTurn ? yutAssets.ui.myTurn : yutAssets.ui.opponentTurn} alt=""/><span>{state.mode === 'lucky' ? '운빨모드' : '기본모드'}</span><h2>{state.status === 'waiting' ? '친구를 기다려요' : state.status === 'finished' ? `${winner?.nickname ?? ''} 승리!` : myTurn ? '내 차례!' : '상대 차례…'}</h2></div>
      <div className={`yut-roll-result ${state.pendingRoll && !isRolling ? 'show' : ''} ${isRolling ? 'is-rolling' : ''}`} aria-live="polite">{isRolling ? <div className="yut-throw-stage" aria-label="윷을 던지는 중"><span className="sr-only">윷을 던지는 중</span>{[0, 1, 2, 3].map((stick) => <img key={stick} style={{ '--stick': stick } as CSSProperties} src={resultAsset ?? yutAssets.results.do} alt=""/>)}</div> : state.pendingRoll ? <>{resultAsset && <img src={resultAsset} alt=""/>}<b>{ROLL_LABEL[state.pendingRoll.name]}</b><small>{state.pendingRoll.steps}칸</small></> : <img src={yutAssets.ui.yutBag} alt="윷 주머니"/>}</div>
      {capturedForExtraTurn && <div className="yut-capture-event"><img src={yutAssets.ui.capture} alt="잡기!"/><b>잡아서 한 번 더!</b></div>}
      {event?.type === 'lucky_card' && <div key={`${event.code}-${event.location}-${event.chain?.length ?? 0}`} className={`yut-event yut-event--${eventTileKind}`}><img className="yut-event-tile" src={yutTileAsset(eventTileKind)} alt={`${eventTierLabel}칸`}/>{cardAsset && <img className="yut-event-card" src={cardAsset} alt={`${card?.label ?? event.label} 카드`}/>}<strong>{eventTierLabel} 운빨카드!</strong><b>{card?.label ?? event.label}</b><span>{card?.effect ?? event.effect}</span>{card && <small>등급 내 확률 {(card.probability * 100).toFixed(1)}%</small>}{event.chain?.length ? <small>연쇄 ×{event.chain.length + 1}</small> : null}</div>}
      <button className="yut-primary yut-roll-button" disabled={!myTurn || Boolean(state.pendingRoll) || isRolling} onClick={roll}>{isRolling ? <span>윷이 날아간다!</span> : state.pendingRoll ? <span>움직일 말을 골라줘!</span> : <img src={yutAssets.ui.rollButton} alt="윷 던지기!"/>}</button>
      {state.status === 'finished' && <button className="yut-secondary" onClick={() => send({ type: 'rematch_request' })}><img src={yutAssets.ui.finish} alt="완주"/>한 판 더?</button>}
      <p className="yut-rule">윷·모 또는 상대 말을 잡으면 한 번 더!<span className="yut-rule-tiles"><img src={yutTileAsset('lucky')} alt="행운칸"/><img src={yutTileAsset('jackpot')} alt="대박칸"/><img src={yutTileAsset('danger')} alt="위험칸"/></span></p></aside>
    </section>
    {showResultPopup && state.pendingRoll && <div className={`yut-result-popup yut-result-popup--${state.pendingRoll.name}`} role="status"><img src={resultAsset ?? yutAssets.results.do} alt=""/><strong>{ROLL_LABEL[state.pendingRoll.name]}!</strong><span>{state.pendingRoll.steps}칸 이동</span></div>}
    {error && <div className="toast">{error}</div>}
  </main>
}
