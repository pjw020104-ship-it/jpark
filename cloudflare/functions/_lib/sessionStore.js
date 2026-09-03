// 주의: Cloudflare Workers의 in-memory Map은 Node 서버와 달리 요청마다 다른 isolate가
// 처리할 수 있어 지속성이 보장되지 않는다 (콜드스타트/유휴 회수 시 초기화됨).
// 트래픽이 늘거나 세션 신뢰성이 중요해지면 Cloudflare KV/Durable Objects로 옮길 것.
const sessions = new Map();

function emptySession() {
  return {
    activeCompanyId: null,
    activePositionId: null,
    coverLetterSummary: null,
    portfolioSummary: null,
    lastGapAnalysis: null,
    lastIssues: null,
    completed: new Set(),
  };
}

export function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, emptySession());
  }
  return sessions.get(sessionId);
}

// 직무/계열사가 바뀌면 이전 진단 결과를 재사용하지 않도록 컨텍스트를 초기화한다.
export function setActiveContext(sessionId, { companyId, positionId }) {
  const session = getSession(sessionId);
  const changed =
    (companyId && companyId !== session.activeCompanyId) ||
    (positionId && positionId !== session.activePositionId);

  if (changed) {
    session.lastGapAnalysis = null;
    session.lastIssues = null;
    session.completed = new Set();
  }

  if (companyId) session.activeCompanyId = companyId;
  if (positionId) session.activePositionId = positionId;
  return session;
}
