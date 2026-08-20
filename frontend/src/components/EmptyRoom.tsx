import { CharacterAvatar } from './CharacterAvatar'

interface Props {
  onHome: () => void
}

export function EmptyRoom({ onHome }: Props) {
  return (
    <main className="empty-room-page page-shell">
      <div className="waiting-cloud waiting-cloud--one" aria-hidden="true" />
      <div className="waiting-cloud waiting-cloud--two" aria-hidden="true" />
      <section className="empty-room-card" role="status" aria-live="polite">
        <div className="empty-room-character">
          <CharacterAvatar character="chiikawa" mood="disconnected" />
        </div>
        <h1>앗! 존재하지 않는 방이에요</h1>
        <p>방이 종료되었거나 잘못된 링크일 수 있어요.</p>
        <button className="primary-button" type="button" onClick={onHome}>메인으로 돌아가기</button>
      </section>
    </main>
  )
}
