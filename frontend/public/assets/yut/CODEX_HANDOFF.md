# Codex 적용 메모 — 운빨윷놀이 에셋

이 폴더를 `frontend/public/assets/yut/`로 복사한다.

- 기존 오목 캐릭터 원본 파일은 수정/덮어쓰기 금지.
- 기존 `CharacterAvatar` 또는 캐릭터 manifest를 재사용해 윷말을 표시한다.
- `board/yut-board-master.png`는 비주얼 기준판으로 사용하되, 실제 클릭/이동 판정은 코드 좌표로 구현한다.
- 카드 PNG는 `manifest.ts` 경로를 사용한다.
- 기존 `/omok/`과 `/omok/room/*` 라우트는 변경하지 않는다.
- 운빨윷놀이는 `/omok/yut/` 하위에만 연결한다.
- build/test 후에도 commit/push/merge/deploy 하지 않는다.
