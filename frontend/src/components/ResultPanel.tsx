import { characterAssets } from '../assets/characters/manifest'
import type { CharacterId, Player } from '../types'
import { CharacterAvatar } from './CharacterAvatar'

type Result = 'win' | 'lose' | 'draw'

const RESULT_COPY: Record<'win' | 'lose', Record<CharacterId, string>> = {
  win: {
    chiikawa: '정말 잘했어!',
    hachiware: '멋진 한 수였어!',
    usagi: '최고야~!',
    momonga: '우와! 대단해~!',
  },
  lose: {
    chiikawa: '다음엔 이길 수 있어!',
    hachiware: '조금만 더 힘내자!',
    usagi: '다음에 더 잘하자~',
    momonga: '아쉬워... 다시 한 판!',
  },
}

const ALL_CHARACTERS: CharacterId[] = ['chiikawa', 'hachiware', 'usagi', 'momonga']

interface Props {
  result: Result
  self: Player
  opponent?: Player
  rematchPending: boolean
  onRematch: () => void
  onHome: () => void
}

export function ResultPanel({ result, self, opponent, rematchPending, onRematch, onHome }: Props) {
  const title = result === 'win' ? '승리!' : result === 'lose' ? '아쉽다...' : '무승부!'
  return (
    <article className={`result-panel result-panel--${result} result-panel--${characterAssets[self.character].theme}`} aria-live="polite">
      <div className="result-confetti" aria-hidden="true"><i>✦</i><i>❀</i><i>✧</i><i>◇</i><i>✦</i></div>
      <p className="result-eyebrow">GAME RESULT</p>
      <h2>{title}</h2>

      {result === 'draw' ? (
        <div className="draw-character-group" aria-label="네 캐릭터 모두 함께">
          {ALL_CHARACTERS.map((character) => <CharacterAvatar key={character} character={character} mood="idle" />)}
        </div>
      ) : (
        <div className="result-character">
          {result === 'win' && <span className="result-crown" aria-hidden="true">♛</span>}
          <CharacterAvatar character={self.character} mood={result} />
        </div>
      )}

      {result === 'draw' ? (
        <p className="result-message"><b>멋진 대국이었어!</b><span>다시 한 판 어때?</span></p>
      ) : (
        <p className="result-message">
          <b>{characterAssets[self.character].label}</b>
          <span>{RESULT_COPY[result][self.character]}</span>
        </p>
      )}

      <div className="result-score" aria-label={`누적 점수 ${self.score} 대 ${opponent?.score ?? 0}`}>
        <span title={self.nickname}>{self.nickname}</span>
        <b>{self.score}</b><i>:</i><b>{opponent?.score ?? 0}</b>
        <span title={opponent?.nickname}>{opponent?.nickname ?? '상대'}</span>
      </div>

      <div className="result-actions">
        <button className="result-button result-button--rematch" disabled={rematchPending} onClick={onRematch}>
          {rematchPending ? '상대 선택을 기다리는 중...' : '다시 한 판'}
        </button>
        <button className="result-button result-button--home" onClick={onHome}>메인으로</button>
      </div>
    </article>
  )
}
