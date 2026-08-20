# 오목 한 판?

친구와 초대 링크로 즐기는 15×15 실시간 렌주 오목입니다. React/Vite 프런트엔드와 FastAPI WebSocket 백엔드가 분리되어 있으며, 서버가 모든 게임 상태와 규칙 판정을 관리합니다.

## 로컬 실행

### 백엔드

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

### 프런트엔드

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173/omok/`을 엽니다. 개발 서버는 `/omok/api`와 `/omok/ws`를 FastAPI로 프록시합니다.

## 테스트

```bash
cd backend && .venv/bin/pytest
cd frontend && npm run build
```

## 배포 메모

- 프런트엔드 base path는 `/omok/`입니다.
- API는 `/omok/api`, WebSocket은 `/omok/ws` 아래에 있습니다.
- `VITE_API_BASE`와 `VITE_WS_URL`로 서로 다른 호스트를 지정할 수 있습니다.
- V1 방 상태는 서버 메모리에만 저장됩니다. 단일 프로세스로 실행해야 하며 재시작하면 방이 사라집니다.
- 운영 프록시는 `/omok/room/*` 요청을 프런트엔드 `index.html`로 fallback해야 초대 링크 직접 접속이 동작합니다.
- 운영 서버는 WebSocket upgrade 헤더를 `/omok/ws`로 전달해야 합니다.
