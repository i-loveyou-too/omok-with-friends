import type { Player, PresenceEvent, ReactionEvent } from '../types'
import { CharacterAvatar } from './CharacterAvatar'

interface Props {
  player?: Player
  self: boolean
  active: boolean
  winner: boolean
  loser: boolean
  reaction: ReactionEvent | null
  presence: PresenceEvent | null
  thinking?: boolean
  connectionIssue?: boolean
}

export function PlayerCard({ player, self, active, winner, loser, reaction, presence, thinking, connectionIssue }: Props) {
  if (!player) {
    return <article className="player-card player-card--empty"><div className="waiting-dots"><i /><i /><i /></div><p>친구를 기다리는 중</p></article>
  }
  const reconnected = presence?.playerId === player.id && presence.status === 'reconnected'
  const disconnected = connectionIssue || !player.connected
  const mood = disconnected ? 'disconnected' : reconnected ? 'reconnected' : winner ? 'win' : loser ? 'lose' : thinking ? 'thinking' : active ? 'myTurn' : 'waiting'
  return (
    <article className={`player-card ${active ? 'is-turn' : ''} ${disconnected ? 'is-offline' : ''}`}>
      <CharacterAvatar character={player.character} mood={mood} active={active} reaction={reaction?.playerId === player.id ? reaction.value : undefined} reactionNonce={reaction?.nonce} />
      <div className="player-meta">
        <div className="player-name"><b>{player.nickname}</b>{self && <span>나</span>}</div>
        <div className="stone-label"><i className={`mini-stone mini-stone--${player.color}`} />{player.color === 'black' ? '흑' : '백'}</div>
      </div>
      {disconnected && <span className="offline-label">연결 끊김…</span>}
      {reconnected && <span className="reconnected-label">다시 왔어요!</span>}
    </article>
  )
}
