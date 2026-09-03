import { generateText } from "../llm.js";
import { redact } from "../redact.js";
import { stripForbidden } from "../guard.js";

const SYSTEM = `당신은 한화그룹 지원자의 자기소개서·포트폴리오를 특정 직무 기준으로 분석하는 도우미입니다.

절대 규칙:
- 점수, 백분율, 합격 가능성, 순위, "적합도" 같은 표현을 절대 출력하지 마세요.
- 지원자가 직접 제공하지 않은 경험이나 성과를 만들어내지 마세요.
- 강점 판정에는 반드시 근거가 되는 경험을 함께 제시하세요.
- 각 항목은 500자 이내로 작성하세요.

## 처리 순서
1) 지원자가 제공한 경험 단위를 추출합니다. 각 경험에서 상황/역할/문제/행동/사용한 기술 또는 지식/결과/성과/배운 점을 뽑습니다.
2) 각 경험이 해당 직무에서 어떤 역량을 증명하는지 분석합니다 (직무 연관성, 활용 가능한 역량, 추천 활용도: 높음/중간/낮음, 자기소개서 활용 포인트, 면접 활용 포인트).
3) 강점/부족한 역량/보유하나 표현되지 않은 역량을 분석합니다. 강점에는 근거 경험, 연관 요구사항, 자기소개서 표현 제안을 포함하세요.

아래 JSON 형식으로만 답하세요 (코드펜스 없이 순수 JSON):
{
  "experiences": [
    { "title": "경험 이름", "situation": "...", "role": "...", "problem": "...", "action": "...", "skill": "...", "result": "...", "achievement": "...", "lesson": "...",
      "job_relevance": "...", "applicable_skills": ["..."], "recommended_use": "높음|중간|낮음", "resume_point": "...", "interview_point": "..." }
  ],
  "strengths": [{ "skill": "...", "evidence_experience": "...", "requirement_link": "...", "resume_expression": "..." }],
  "gaps": ["부족한 역량 설명"],
  "hidden_strengths": ["보유하나 표현되지 않은 역량 설명"]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function analyzeGap({ role, coverLetterText, portfolioText, apiKey, generate = generateText }) {
  if (!coverLetterText || !coverLetterText.trim()) {
    return {
      blocks: [],
      sources: [],
      state: "needs_profile",
      notice: "역량 진단을 위해 자기소개서(선택: 포트폴리오)를 입력해주세요",
    };
  }

  const redactedCoverLetter = redact(coverLetterText);
  const redactedPortfolio = portfolioText && portfolioText.trim() ? redact(portfolioText) : "";

  const prompt = [
    `직무: ${role.name_ko}`,
    `자기소개서(민감정보 마스킹됨):\n${redactedCoverLetter}`,
    redactedPortfolio ? `포트폴리오(민감정보 마스킹됨):\n${redactedPortfolio}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await generate({ system: SYSTEM, prompt, apiKey });
  const parsed = parseJsonLoose(raw) ?? { experiences: [], strengths: [], gaps: [], hidden_strengths: [] };

  const blocks = [];

  for (const exp of parsed.experiences ?? []) {
    blocks.push({
      label: `[경험 분석] ${exp.title ?? ""}`,
      content: stripForbidden(
        [
          `상황: ${exp.situation ?? ""}`,
          `역할: ${exp.role ?? ""}`,
          `문제: ${exp.problem ?? ""}`,
          `행동: ${exp.action ?? ""}`,
          `사용한 기술/지식: ${exp.skill ?? ""}`,
          `결과: ${exp.result ?? ""}`,
          `성과: ${exp.achievement ?? ""}`,
          `배운 점: ${exp.lesson ?? ""}`,
        ].join("\n"),
      ),
    });
    blocks.push({
      label: `[역량 매핑] ${exp.title ?? ""}`,
      content: stripForbidden(
        [
          `직무 연관성: ${exp.job_relevance ?? ""}`,
          `활용 가능한 역량: ${(exp.applicable_skills ?? []).join(", ")}`,
          `추천 활용도: ${exp.recommended_use ?? ""}`,
          `자기소개서 활용 포인트: ${exp.resume_point ?? ""}`,
          `면접 활용 포인트: ${exp.interview_point ?? ""}`,
        ].join("\n"),
      ),
    });
  }

  blocks.push({
    label: "[강점]",
    content: stripForbidden(
      (parsed.strengths ?? [])
        .map((s) => `- ${s.skill}\n  근거 경험: ${s.evidence_experience}\n  연관 요구사항: ${s.requirement_link}\n  자기소개서 표현 제안: ${s.resume_expression}`)
        .join("\n\n") || "확인된 강점이 없습니다.",
    ),
  });
  blocks.push({
    label: "[부족한 역량]",
    content: stripForbidden((parsed.gaps ?? []).join("\n") || "해당 없음"),
  });
  blocks.push({
    label: "[보유하나 표현되지 않은 역량]",
    content: stripForbidden((parsed.hidden_strengths ?? []).join("\n") || "해당 없음"),
  });

  return { blocks, sources: [], state: "ok" };
}
