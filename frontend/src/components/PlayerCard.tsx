import type { Player, ReactionEvent } from '../types'
import { CharacterAvatar } from './CharacterAvatar'

interface Props {
  player?: Player
  self: boolean
  active: boolean
  winner: boolean
  loser: boolean
  reaction: ReactionEvent | null
}

export function PlayerCard({ player, self, active, winner, loser, reaction }: Props) {
  if (!player) {
    return <article className="player-card player-card--empty"><div className="waiting-dots"><i /><i /><i /></div><p>친구를 기다리는 중</p></article>
  }
  const mood = !player.connected ? 'disconnected' : winner ? 'win' : loser ? 'lose' : active ? 'myTurn' : 'waiting'
  return (
    <article className={`player-card ${active ? 'is-turn' : ''} ${!player.connected ? 'is-offline' : ''}`}>
      <CharacterAvatar character={player.character} mood={mood} active={active} reaction={reaction?.playerId === player.id ? reaction.value : undefined} />
      <div className="player-meta">
        <div className="player-name"><b>{player.nickname}</b>{self && <span>나</span>}</div>
        <div className="stone-label"><i className={`mini-stone mini-stone--${player.color}`} />{player.color === 'black' ? '흑' : '백'}</div>
      </div>
      <strong className="score"><span>{player.score}</span>승</strong>
      {!player.connected && <span className="offline-label">연결 끊김…</span>}
    </article>
  )
}

