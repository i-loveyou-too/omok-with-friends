# 운빨윷놀이 에셋 팩

기준 시안에서 실제 구현에 바로 쓸 수 있도록 큰 영역을 분리한 1차 에셋 팩입니다.

## 권장 저장 위치
`frontend/public/assets/yut/`

## 구성
- `board/yut-board-master.png` — 전통 윷판 기준 시안
- `cards/luck-cards-18-master.png` — 최종 카드 18종 마스터 시트
- `cards/01-*.png` ~ `cards/18-*.png` — 테두리 기준으로 분할한 실제 UI 카드 18종
- `yut/yut-sticks-reference.png` — 도/개/걸/윷/모 윷가락 참고
- `ui/special-tiles-reference.png` — 일반/행운/대박/이벤트/위험 칸 참고
- `ui/game-ui-reference.png` — 잡기/업기/완주 등 UI 참고
- `ui/event-badges.png` — 잡기/업기/완주 배지
- `ui/turn-and-roll-buttons.png` — 윷 던지기/내 차례/상대 차례
- `ui/title-and-yut-bag.png` — 제목 표지와 윷 주머니
- `manifest.ts` — 프런트에서 연결할 경로 예시

## 구현 원칙
1. 기존 오목 캐릭터 에셋은 그대로 재사용.
2. 윷판은 전통 윷판 구조를 기준으로 하고 출발/도착은 하나의 공용 루프 규칙으로 구현.
3. 캐릭터를 새로 자르기보다 게임 말은 기존 CharacterAvatar/캐릭터 에셋을 작은 원형/스탠드 토큰으로 사용.
4. 운빨칸은 일반/행운/대박/이벤트/위험을 명확히 구분.
5. 카드 텍스트와 효과는 서버 권한(authoritative state) 기준으로 처리하고, PNG는 표현용으로만 사용.
