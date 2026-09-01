import "dotenv/config";
import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { loadOrganizations, loadJobFamilies, findCompany, findRole } from "./lib/dataStore.js";
import { getSession, setActiveContext } from "./session/store.js";
import { generateScenario } from "./features/scenario.js";
import { analyzeGap } from "./features/gapAnalysis.js";
import { getJobIssues } from "./features/issues.js";
import { generateInterviewQuestions } from "./features/interview.js";

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-3.6-flash";

const SYSTEM_PROMPT = `당신은 "한화 직무 가이드"라는 AI 어시스턴트입니다.
한화그룹에 지원하려는 취준생이 "회사 + 직무명"을 입력하면, 그 직무를 쉽고 명확하게 파악할 수 있도록 도와주는 역할을 합니다.

## 0단계: 직무명이 너무 광범위한지 먼저 판단하세요
사용자가 준 직무명이 실제로는 서로 다른 여러 세부 업무를 포괄하는 큰 범주라면(예: "R&D/설계", "영업", "기획", "IT", "생산", "연구개발" 등 — 하위에 기계/전자/화학/소프트웨어/국내영업/해외영업처럼 성격이 많이 다른 세부 분야가 여러 개 존재하는 경우), 곧바로 3개 섹션 답변을 만들지 마세요.

대신 다음과 같이 짧게 되물어 범위를 좁히세요:
- 왜 범위가 넓은지 한두 문장으로 짚어주고
- 세부 분야는 가능하면 그 회사의 실제 사업부/사업본부 단위로 제시하세요. 예를 들어 한화에어로스페이스라면 "PGM사업부(정밀유도무기)", "LS사업부(지상방산)", "항공/우주 부문"처럼 실제 조직 단위 이름을 사용하는 것이 취준생에게 훨씬 현실적입니다. 그 회사의 정확한 사업부 구성을 확신할 수 없다면, 사업부명을 지어내지 말고 대신 기계/전자/소프트웨어처럼 기술 분야 기준으로 나눠 제시하세요.
- 사업부 이름으로 예시를 든 경우, 조직 개편으로 명칭이 바뀔 수 있으니 "정확한 사업부명은 채용 공고에서 다시 확인하라"고 짧게 덧붙이세요.
- 세부 분야는 2~4개 예시로 제시하고
- 특정 분야를 고르기보다 전체 개요를 원할 수도 있으니 "전체적인 개요가 궁금하시면 '전체 개요'라고 말씀해주세요" 같은 선택지도 함께 안내하세요
- 이 되묻는 답변은 3개 섹션 구조 없이, 짧고 자연스러운 대화체 한두 단락으로만 작성하세요 (마크다운 헤더 사용 금지)

사용자가 처음부터 구체적인 직무명을 준 경우(예: "기계 구조 설계", "해외영업(방산 수출)", "반도체 소재 R&D" 등)이거나, 되묻는 질문에 대해 사용자가 세부 분야를 골랐거나 "전체 개요"를 요청한 경우에는 바로 아래 1단계로 넘어가 답변하세요.

## 1단계: 3개 섹션으로 답변하세요 (마크다운 헤더 사용)

### 1. 어떤 일을 하나요
그 직무의 실제 업무를 구체적으로, 어려운 용어는 풀어서 설명하세요. 가능하면 하루 일과나 실제 프로젝트 예시처럼 와닿게 설명하세요.

### 2. 어떤 역량이 있으면 좋을까요
관련 전공, 자격증, 툴/언어, 그리고 전공 지식 외에 도움이 되는 소프트 스킬(커뮤니케이션, 어학 등)을 구체적으로 나열하세요. 이공계/인문상경계 모두 지원 가능한 직무라면 각각 어떤 역량이 유리한지 구분해서 설명하세요.

### 3. 최근 이슈 & 트렌드
그 직무·산업과 관련된 최근 동향, 기술 변화, 시장 이슈를 짚어주세요. 자소서나 면접에서 활용할 수 있는 포인트로 연결해주세요.

마지막에는 항상 "채용 공고의 세부 자격요건과 최신 이슈는 한화 공식 채용 사이트(한화인)나 각 계열사 홈페이지에서 반드시 재확인하라"고 안내하세요.

그 외 자유로운 후속 질문(예: 자소서 작성법, 면접 팁 등)에는 섹션 구조 없이 자연스러운 대화체로 답하면 됩니다.

공통 원칙:
1. 어려운 전문 용어는 반드시 쉬운 말로 풀어서 설명하세요.
2. 시점에 따라 바뀌는 수치(채용 규모, 실적 등)는 정확하지 않을 수 있으니 단정하지 마세요.
3. 친근한 대화체를 사용하되 신뢰감을 잃지 마세요.
4. 확실하지 않은 내용은 추측해서 단정하지 말고 모른다고 솔직히 말하세요.
5. 답변은 너무 길지 않게, 핵심 위주로 정리해주세요.`;

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages 배열이 필요합니다." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM_PROMPT },
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error(error);
    res.write(`data: ${JSON.stringify({ error: "답변 생성 중 오류가 발생했습니다." })}\n\n`);
    res.end();
  }
});

// §9: 계열사/직무명은 코드에 하드코딩하지 않고 data/*.json에서 조회한다.
app.get("/api/organizations", (_req, res) => {
  const org = loadOrganizations();
  res.json({ as_of: org.as_of, companies: org.companies.map((c) => ({ id: c.id, name_ko: c.name_ko })) });
});

app.get("/api/job-families", (_req, res) => {
  const jf = loadJobFamilies();
  res.json({
    families: jf.families.map((f) => ({
      id: f.id,
      name_ko: f.name_ko,
      roles: f.roles.map((r) => ({ id: r.id, name_ko: r.name_ko })),
    })),
  });
});

const today = () => new Date().toISOString().slice(0, 10);

// §4.5: 직무 4버튼 라우팅. 기능 로직은 features/*.js에 위임하고 여기서는 라우팅만 한다.
app.post("/api/action", async (req, res) => {
  const { session_id, action, company_id, position_id, cover_letter_text, portfolio_text } = req.body;

  if (!session_id || !action) {
    return res.status(400).json({ error: "session_id, action이 필요합니다." });
  }

  const session = setActiveContext(session_id, { companyId: company_id, positionId: position_id });
  const companyId = session.activeCompanyId;
  const positionId = session.activePositionId;

  if (!companyId || !positionId) {
    return res.status(400).json({ error: "company_id와 position_id가 모두 확정되어야 합니다." });
  }

  const company = findCompany(companyId);
  const found = findRole(positionId);

  if (!company || !found) {
    return res.status(400).json({ error: "알 수 없는 company_id 또는 position_id 입니다." });
  }

  try {
    let result;

    switch (action) {
      case "job_description":
        result = await generateScenario({ role: found.role });
        break;

      case "skill_gap": {
        const coverLetterText = cover_letter_text ?? session.coverLetterSummary;
        const portfolioText = portfolio_text ?? session.portfolioSummary;
        if (cover_letter_text) session.coverLetterSummary = cover_letter_text;
        if (portfolio_text) session.portfolioSummary = portfolio_text;
        result = await analyzeGap({ role: found.role, coverLetterText, portfolioText });
        if (result.state === "ok") session.lastGapAnalysis = result;
        break;
      }

      case "job_issues":
        result = getJobIssues({
          companyId: company.id,
          companyName: company.name_ko,
          roleId: found.role.id,
          roleName: found.role.name_ko,
        });
        if (result.state === "ok") session.lastIssues = result;
        break;

      case "interview_questions":
        result = await generateInterviewQuestions({
          role: found.role,
          coverLetterText: session.coverLetterSummary,
        });
        break;

      default:
        return res.status(400).json({ error: `알 수 없는 action: ${action}` });
    }

    if (result.state === "ok") session.completed.add(action);

    res.json({ action, as_of: today(), ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      action,
      blocks: [],
      sources: [],
      as_of: today(),
      state: "fallback",
      notice: "답변 생성 중 오류가 발생했습니다.",
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${PORT}`);
});
