# 한화그룹 신입 채용 직무안내 챗봇

한화그룹 신입 지원자에게 계열사·직무별 실무 내용을 안내하는 대화형 챗봇 프로토타입입니다.
자세한 기능 스펙은 `SPEC.md`를 참고하세요.

## 구성

- `backend/` — Node.js/Express API 서버 (LLM: Google Gemini API)
- `frontend/` — React + Vite 프론트엔드
- `data/` — 계열사·직무 데이터 (`organizations.json`, `company_jobs.json`)
- `tests/` — Vitest 테스트

## 필요 프로그램 (다른 컴퓨터에서 처음 설치 시)

- **Node.js 18 이상**: https://nodejs.org 에서 LTS 버전 설치 (설치 후 터미널에서 `node --version`으로 확인)
- **Gemini API 키**: https://aistudio.google.com/apikey 에서 발급 (무료 티어 있음, 사용량에 따라 과금될 수 있습니다)

## 실행 방법

### 1) 백엔드 실행

`backend/.env.example`을 복사해 `backend/.env`를 만들고 발급받은 키를 입력합니다:
```
GEMINI_API_KEY=여기에_발급받은_키를_입력하세요
PORT=3001
```

그 다음 서버를 실행합니다.
```
cd backend
npm install
npm run dev
```
`백엔드 서버 실행 중: http://localhost:3001` 메시지가 뜨면 정상입니다.

### 2) 프론트엔드 실행 (새 터미널 창에서)

```
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 (백엔드 API는 자동으로 프록시됩니다).

### 3) 테스트 (선택)

```
npm install
npm test
```

## 알려진 한계

- **실시간 검색 없음**: "직무 이슈 분석"과 "직무 설명"은 실시간 뉴스/채용공고를 검색하지 않고, 모델이 알고 있는 일반적인 지식을 바탕으로 답합니다. 화면에 그 사실이 안내 문구로 표시됩니다.
- **API 사용량에 따라 비용이 발생**할 수 있습니다 (Gemini 무료 티어 한도 초과 시).
- **세션은 서버 메모리에만 저장**되며 서버 재시작 시 초기화됩니다 (프로토타입 단계).

## 배포 (웹사이트로 공개하기)

지금 구조(React 프론트 + Express API)는 그대로 배포 가능합니다.
- **백엔드**: Render/Railway 등에 `backend/`를 올리고 환경변수에 `GEMINI_API_KEY`를 설정합니다.
- **프론트엔드**: `npm run build`로 정적 파일을 만들어 Vercel/Netlify 등에 올리거나, 백엔드와 같은 서버에서 서빙합니다.
- `GEMINI_API_KEY`는 절대 프론트엔드 코드나 git에 커밋하지 말고, 배포 플랫폼의 환경변수로만 설정하세요.
