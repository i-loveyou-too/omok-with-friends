import { FormEvent, useEffect, useState } from 'react'
import { characterAssets } from '../assets/characters/manifest'
import type { CharacterId } from '../types'
import { CharacterAvatar } from './CharacterAvatar'
import { HomeBoardDecoration } from './HomeBoardDecoration'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/omok/api'
const HERO_CHARACTERS: CharacterId[] = ['chiikawa', 'hachiware', 'usagi', 'momonga']

interface HeroDisplayAsset {
  src: string
  stateLabel: string
}

function heroAssetPool(character: CharacterId): HeroDisplayAsset[] {
  const assets = characterAssets[character]
  return [
    { src: assets.poses.idle, stateLabel: 'idle' },
    { src: assets.poses.selected, stateLabel: 'selected' },
    { src: assets.poses.myTurn, stateLabel: 'myTurn' },
    { src: assets.poses.waiting, stateLabel: 'waiting' },
    { src: assets.reactions.laugh, stateLabel: 'reaction-laugh' },
    { src: assets.reactions.clap, stateLabel: 'reaction-clap' },
  ]
}

const previousHeroAsset = new Map<CharacterId, string>()

function chooseHeroAsset(character: CharacterId): HeroDisplayAsset {
  const pool = heroAssetPool(character)
  const previous = previousHeroAsset.get(character)
  const candidates = pool.filter((asset) => asset.src !== previous)
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function createHeroAssets(): Record<CharacterId, HeroDisplayAsset> {
  return {
    chiikawa: chooseHeroAsset('chiikawa'),
    hachiware: chooseHeroAsset('hachiware'),
    usagi: chooseHeroAsset('usagi'),
    momonga: chooseHeroAsset('momonga'),
  }
}

interface Props {
  onEnter: (roomCode: string) => void
}

export function Lobby({ onEnter }: Props) {
  const [heroAssets] = useState(createHeroAssets)
  const [code, setCode] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    HERO_CHARACTERS.forEach((character) => previousHeroAsset.set(character, heroAssets[character].src))
  }, [heroAssets])

  const createRoom = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/rooms`, { method: 'POST' })
      if (!response.ok) throw new Error()
      const data = await response.json() as { roomCode: string }
      onEnter(data.roomCode)
    } catch {
      setError('방을 만들지 못했어요. 서버 연결을 확인해 주세요.')
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
    <main className="lobby page-shell">
      <div className="spring-sky" aria-hidden="true">
        <i className="spring-cloud spring-cloud--left" />
        <i className="spring-cloud spring-cloud--right" />
        <i className="spring-tree spring-tree--left" />
        <i className="spring-tree spring-tree--right" />
        <span className="petal petal--one">❀</span>
        <span className="petal petal--two">❀</span>
        <span className="petal petal--three">✦</span>
      </div>

      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-kicker">친구랑 온라인 오목!</p>
        <h1 id="home-title">오목 <span>한</span> 판?</h1>
        <div className="home-character-group">
          {HERO_CHARACTERS.map((character, index) => (
            <div className={`home-character home-character--${index + 1}`} key={character}>
              <CharacterAvatar character={character} displayAsset={heroAssets[character]} />
            </div>
          ))}
          <HomeBoardDecoration />
        </div>
      </section>

      <section className="home-actions" aria-label="게임 시작">
        <p><span>✿</span> 오늘도 즐거운 한 판!</p>
        <button className="home-cta home-cta--create" onClick={createRoom} disabled={busy}>
          <span aria-hidden="true">✿</span>
          <b>{busy ? '방 만드는 중…' : '방 만들기'}</b>
          <small>친구를 초대해서 함께</small>
        </button>

        {!showJoin ? (
          <button className="home-cta home-cta--join" onClick={() => { setShowJoin(true); setError('') }}>
            <span aria-hidden="true">⌕</span>
            <b>방 코드로 입장</b>
            <small>5자리 코드가 있다면</small>
          </button>
        ) : (
          <form className="home-code-form" onSubmit={join}>
            <label htmlFor="room-code">방 코드로 입장</label>
            <div>
              <input
                id="room-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5))}
                placeholder="K3H7P"
                autoCapitalize="characters"
                autoFocus
                maxLength={5}
              />
              <button type="submit">입장</button>
            </div>
            <button className="code-cancel" type="button" onClick={() => setShowJoin(false)}>취소</button>
          </form>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>

      <div className="spring-meadow" aria-hidden="true">
        <span>✿</span><span>❀</span><span>✾</span><span>✿</span><span>❀</span>
      </div>
    </main>
  )
}
