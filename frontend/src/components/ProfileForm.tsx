import { FormEvent, useState } from 'react'
import { characterAssets } from '../assets/characters/manifest'
import type { CharacterId, Profile } from '../types'
import { CharacterAvatar } from './CharacterAvatar'

interface Props {
  roomCode: string
  onSubmit: (profile: Profile) => void
  onBack: () => void
}

export function ProfileForm({ roomCode, onSubmit, onBack }: Props) {
  const [nickname, setNickname] = useState('')
  const [character, setCharacter] = useState<CharacterId>('chiikawa')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!nickname.trim()) return
    onSubmit({ nickname: nickname.trim(), character })
  }

  return (
    <main className="profile-page page-shell">
      <button className="back-button" onClick={onBack}>← 처음으로</button>
      <form className="profile-card" onSubmit={submit}>
        <p className="room-chip">ROOM · {roomCode}</p>
        <h1>누구로 놀까요?</h1>
        <p>닉네임과 캐릭터를 골라 주세요.</p>
        <label className="nickname-label" htmlFor="nickname">닉네임</label>
        <input
          className="nickname-input"
          id="nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value.slice(0, 12))}
          placeholder="이름을 입력해 주세요"
          autoFocus
        />
        <fieldset className="character-picker">
          <legend>캐릭터 선택</legend>
          <div>
            {(Object.keys(characterAssets) as CharacterId[]).map((id) => (
              <label className={character === id ? 'selected' : ''} key={id}>
                <input type="radio" name="character" value={id} checked={character === id} onChange={() => setCharacter(id)} />
                <CharacterAvatar character={id} />
                <span>{characterAssets[id].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="primary-button" disabled={!nickname.trim()}>이 방에 들어가기</button>
      </form>
    </main>
  )
}

