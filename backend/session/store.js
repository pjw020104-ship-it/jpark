const sessions = new Map();

function emptySession() {
  return {
    activeCompanyId: null,
    activePositionId: null,
    profileSummary: null,
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

export function resetSession(sessionId) {
  sessions.set(sessionId, emptySession());
}
