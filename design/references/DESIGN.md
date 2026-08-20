# 오목 한 판? V1 디자인 에셋

이 디렉터리는 2026-08-20에 제공된 최종 캐릭터 마스터 시트와 UI 디자인 보드를 보관한다.

## 캐릭터 소스 규칙

- 치이카와 이미지는 `chiikawa-final-master.png`에서만 추출한다.
- 하치와레 이미지는 `hachiware-final-master.png`에서만 추출한다.
- 모몽가 이미지는 `momonga-final-master.png`에서만 추출한다.
- 우사기 이미지는 `usagi-final-master.png`에서만 추출한다.
- 캐릭터를 생성, 합성, 트레이싱하거나 다른 캐릭터 시트의 요소를 섞지 않는다.

`frontend/scripts/extract_character_assets.py`는 지정된 영역을 크롭한 뒤 512×512 투명 캔버스에 중심과 바닥선을 맞추는 결정론적 처리만 수행한다.

## UI 디자인 보드

`ui/ui-final-design-board.png`는 색상, 간격, 버튼, 말풍선, 보드, 상태 아이콘과 장식 방향의 기준이다. `ui/lobby-result-reference.png`는 봄날 메인 로비와 승리/패배/무승부 카드의 배치 기준이다. 두 통합 보드 모두 캐릭터 소스로 사용하지 않는다. 인터랙티브 오목판과 접근 가능한 텍스트는 React DOM/CSS/SVG로 구현한다.
