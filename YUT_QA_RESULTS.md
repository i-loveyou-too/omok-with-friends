# 운빨 윷놀이 V2 QA 결과 — 2026-08-22

검증 환경: `feat/final-game-assets` 로컬 작업트리, Python pytest, Vite production build, Codex 인앱 브라우저 2탭.

표기: **PASS**는 자동 테스트·실제 브라우저·코드/스타일 검증 중 명시한 방식으로 확인, **PARTIAL**은 도구 제약으로 일부만 확인한 항목이다.

| # | 결과 | 확인 내용 |
|---:|:---:|---|
| 1 | PASS | 일반 결과 소비 후 턴 전환 자동 테스트 |
| 2 | PASS | 윷 결과 누적 후 개 우선 소비 자동 테스트 |
| 3 | PASS | 강제 `윷 → 모 → 개` 누적 및 추가 던지기 전 이동 차단 자동 테스트 |
| 4 | PASS | 저장 결과 잔존 시 동일 턴 유지 자동 테스트 |
| 5 | PASS | 빽도는 해당 rollId만 소비하도록 상태 불변식/자동 테스트 확인 |
| 6 | PASS | 스택 전체 이동 코드와 pieceIds/path 기록 확인 |
| 7 | PASS | 착지 후 즉시 복귀하지 않고 pendingCapture 생성 자동 테스트 |
| 8 | PASS | confirm 후 복귀·이벤트·추가 던지기 자동 테스트 |
| 9 | PASS | pendingCapture/Card 중 행동 차단 자동 테스트 및 서버 검증 |
| 10 | PASS | 결과 풀과 capture bonus가 독립된 mustRoll/pendingRolls 불변식으로 유지 |
| 11 | PASS | 실제 2클라이언트에서 카드칸 도착 후 자동발동 없이 선택 dialog 확인 |
| 12 | PASS | 실제 KEEP 후 새로고침 재접속에서 instance 손패 복원 확인 |
| 13 | PASS | 실제 KEEP 이동 카드의 내 말 선택 안내/활성 말 확인 |
| 14 | PASS | swap의 내 말+상대 말·판 위 위치 검증 자동 테스트 |
| 15 | PASS | KEEP swap instance를 명시 타깃으로 사용하는 자동 테스트 |
| 16 | PASS | opponent_back/split 명시 상대 타깃 자동 테스트 |
| 17 | PASS | merge/shield/이동 카드 owner·piece 검증 코드/자동 테스트 |
| 18 | PASS | 카드 이동 capture-confirm 재진입 자동 테스트 |
| 19 | PASS | 실제 꽝 공개 후 남은 결과 선택 흐름 복귀 확인 |
| 20 | PASS | pendingCard 중 roll/move/use_card 차단 서버 검증 |
| 21 | PASS | A 던지기 직후 A/B 양쪽 throw stage 4개 및 동일 결과 popup 확인 |
| 22 | PASS | B 던지기 직후 A/B 양쪽 throw stage 확인 |
| 23 | PASS | 실제 pendingRolls/hand 재접속 복원 + snapshot 전체 필드 자동 테스트 |
| 24 | PASS | 서버 authoritative snapshot 재접속 테스트 |
| 25 | PASS | rollId/instanceId 단일 소비 및 재요청 거절 불변식 확인 |
| 26 | PASS | 판 프레임 최대폭 유지, node 15.6% 적용 |
| 27 | PASS | piece 19%와 실제 button hitbox 동일 적용 |
| 28 | PASS | 비활성 말 computed opacity 1 실제 확인 |
| 29 | PASS | yut piece/home disabled opacity override 확인 |
| 30 | PASS | 내 말 빨강·상대 말 파랑 테두리/배경 실제 화면 확인 |
| 31 | PASS | 안내를 board 외부 normal flow + pointer-events none으로 배치 |
| 32 | PASS | 스택 badge z-index/외부 배치 확인 |
| 33 | PASS | 4-stick hero throw 크기와 협소 인앱 화면 잘림 없음 시각 확인 |
| 34 | PASS | lastMove.path 210ms 단계 재생 및 hop별 SFX callback 연결 |
| 35 | PASS | capture ghost pop/fly와 시작점 복귀 코드 + 상태 자동 테스트 |
| 36 | PASS | finish ghost pop과 별도 goal/finish art 적용 |
| 37 | PASS | swap 두 말 from/to 동시 presentation 적용 |
| 38 | PASS | prefers-reduced-motion에서 animation/transition 제거 |
| 39 | PARTIAL | 인앱 viewport override가 CSS innerWidth를 고정 보고해 320/360/390/430 개별 수치 검증 불가. 협소 실제 화면과 scrollWidth=innerWidth는 확인 |
| 40 | PASS | 협소 실제 화면에서 board-first·controls vertical stack 시각 확인 |
| 41 | PASS | 최종 모바일 규칙에서 controls flex column 적용 |
| 42 | PASS | piece/home/action button 44px 이상 규칙 확인 |
| 43 | PASS | 실제 큰 말 button과 roll chip 선택 확인 |
| 44 | PASS | action sheet가 board 아래 normal flow에 있고 스크롤 접근 가능 |
| 45 | PASS | 실행 코드의 `/omok/` 하드코딩 제거, BASE_URL/API/WS helper 사용 |
| 46 | PASS | `/omokwithfriend/`에서 hub → yut → room, API, WS 실제 확인 |
| 47 | PASS | localhost Vite proxy에서 2클라이언트 실제 플레이 확인 |
| 48 | PASS | 기존 오목/비밀카드 포함 backend 전체 60 tests 통과, 기존 라우트 보존 |
| 49 | PASS | 카드 18종 id/weight/probability/asset 자동 테스트 |
| 50 | PASS | 전체 pytest, typecheck/build, git diff --check 통과 |

## 필수 재현 시나리오

- `윷 → 모 → 개`: 강제 결과 자동 테스트 PASS.
- 잡기 확인: 강제 배치 자동 테스트 PASS.
- swap KEEP 후 사용: instanceId/명시 타깃 자동 테스트 PASS.
- 재접속 중 pendingRolls: 실제 브라우저 새로고침 전후 `개 · 2칸` 동일 확인.
- 상대가 던지는 애니메이션: A/B 각각 던질 때 반대편 화면의 throw stage 확인.
