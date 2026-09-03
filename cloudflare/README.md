# Cloudflare Pages 배포

`backend/`(Express) + `frontend/`(Vite)를 Cloudflare Pages 하나로 배포하기 위한 폴더입니다.
- 정적 자산(`dist/`)은 `frontend`를 빌드한 결과가 그대로 들어옵니다.
- API(`functions/api/*.js`)는 Cloudflare Pages Functions로, `backend/`의 Express 라우트를 포팅한 것입니다.
- 같은 오리진에서 서빙되므로 프론트가 쓰는 `/api/...` 상대경로가 그대로 동작하고, CORS 설정이 필요 없습니다.

## 사전 준비

- [Cloudflare 계정](https://dash.cloudflare.com/sign-up)
- Gemini API 키 (`SPEC.md` §0 참고)
- `npm install -g wrangler` 또는 이 폴더에서 `npm install` 후 `npx wrangler`로 사용

## 로컬에서 테스트

```
cd frontend && npm install && npm run build      # cloudflare/dist에 정적 자산 생성
cd ../cloudflare && npm install
cp .dev.vars.example .dev.vars                    # GEMINI_API_KEY 입력
npm run dev                                        # wrangler pages dev — Functions까지 로컬 재현
```
브라우저에서 wrangler가 알려주는 주소(보통 `http://localhost:8788`)로 접속합니다.

## 배포

```
wrangler login                                     # 최초 1회, 브라우저 인증
cd frontend && npm run build
cd ../cloudflare
npm run deploy                                      # data 동기화 + wrangler pages deploy
```

최초 배포 시 프로젝트 이름을 물어보면 `wrangler.toml`의 `name`(`hanwha-job-guide`)을 그대로 쓰면 됩니다.

### 환경변수(GEMINI_API_KEY) 등록

`.dev.vars`는 로컬 전용입니다. 배포된 사이트에는 별도로 등록해야 합니다.
- **대시보드**: Cloudflare 대시보드 → Workers & Pages → 프로젝트 선택 → Settings → Environment variables → `GEMINI_API_KEY` 추가 (Production/Preview 각각)
- **CLI**: `wrangler pages secret put GEMINI_API_KEY`

키를 절대 git에 커밋하거나 프론트엔드 코드에 넣지 마세요.

## data(`organizations.json`, `company_jobs.json`) 동기화

Workers 런타임에는 파일시스템이 없어서 `/data`의 JSON을 `functions/_lib/data/`에 복사해 JS import로 번들에 포함시킵니다(`npm run sync-data`, `dev`/`deploy` 스크립트가 자동 실행). `/data` 원본을 고치면 반드시 `deploy`/`dev`를 다시 돌려야 반영됩니다 — `functions/_lib/data/`는 gitignore돼 있고 자동 생성되는 사본입니다.

## 알려진 한계

- **세션이 Worker 메모리(Map)에만 저장됩니다.** Node 서버와 달리 Cloudflare는 요청마다 다른 isolate가 처리할 수 있어(콜드스타트, 유휴 회수) 세션이 예고 없이 초기화될 수 있습니다. 트래픽이 늘거나 "자기소개서 입력 → 면접질문 생성" 같은 세션 의존 흐름의 신뢰성이 중요해지면 [Cloudflare KV](https://developers.cloudflare.com/kv/) 또는 [Durable Objects](https://developers.cloudflare.com/durable-objects/)로 옮기는 것을 고려하세요.
- **검색 그라운딩 없음**은 Node 백엔드와 동일합니다 (`SPEC.md` §0 참고).
- Gemini SDK(`@google/genai`) 대신 REST API를 직접 `fetch`합니다(Workers에서 Node SDK 호환성 리스크를 피하기 위함). 인터페이스는 Node판 `backend/lib/llm.js`와 동일하게 맞췄습니다.
