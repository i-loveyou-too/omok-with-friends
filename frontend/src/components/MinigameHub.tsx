import { useEffect } from 'react'
import { subscribeGameBgm } from '../hooks/gameAudioStore'

interface Props {
  onOmok: () => void
  onSecretCard: () => void
  onYut: () => void
}

const base = import.meta.env.BASE_URL

export function MinigameHub({ onOmok, onSecretCard, onYut }: Props) {
  // The hub is the first screen most people land on — start the shared BGM here so it's
  // already playing (and already reflects the shared mute flag) by the time a game opens.
  useEffect(() => subscribeGameBgm(), [])

  return (
    <main className="minigame-hub page-shell">
      <div className="minigame-hub__wash" aria-hidden="true" />
      <section className="minigame-hub__hero" aria-labelledby="minigame-title">
        <img className="minigame-hub__logo" src={`${base}minigame/main-title.png`} alt="먼작귀게임방" />
        <p>오늘은 뭐 하고 놀까?</p>
      </section>
      <section className="minigame-hub__grid" aria-label="게임 선택">
        <button className="minigame-select-card minigame-select-card--omok" type="button" onClick={onOmok}>
          <img src={`${base}minigame/omok-card.png`} alt="" />
          <div><small>친구랑 실시간 전략 대결</small><h2>오목 한 판?</h2><span>시작하기 ›</span></div>
        </button>
        <button className="minigame-select-card minigame-select-card--secret" type="button" onClick={onSecretCard}>
          <img src={`${base}minigame/secret-card.png`} alt="" />
          <div><small>내 카드는 비밀!</small><h2>두근두근 비밀카드</h2><span>시작하기 ›</span></div>
        </button>
        <button className="minigame-select-card minigame-select-card--yut" type="button" onClick={onYut}>
          <img src={`${base}assets/yut/ui/lobby-yut-bag.png`} alt="" />
          <div><small>운도 실력이다!</small><h2>운빨윷놀이</h2><span>시작하기 ›</span></div>
        </button>
      </section>
      <p className="minigame-hub__footer">✦ 둘이서 놀기 좋은 게임을 하나씩 모으는 중 ✦</p>
    </main>
  )
}
