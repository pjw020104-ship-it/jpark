import { generateText } from "../lib/llm.js";
import { redact } from "../profile/redact.js";

const SYSTEM = `당신은 한화그룹 지원자의 면접을 준비시키는 도우미입니다.

절대 규칙:
- 이 질문들은 실제 기출 문항이 아닙니다. 항상 "예상 질문"임을 전제하세요.
- 모범 답안 전문을 작성하지 마세요.
- 지원자가 제공하지 않은 경험을 만들어내지 마세요.

JD 기반 질문 5개: 직무의 주요 업무·필요 역량·우대사항을 바탕으로 생성하고, 각 질문의 의도와 JD 근거를 간단히 표시하세요.
개인 역량 기반 질문 5개(자기소개서가 있을 때만): 지원자가 제공한 경험이 직무와 어떻게 연결되는지 확인하는 질문을 생성하고, 근거가 되는 경험을 표시하세요.

아래 JSON 형식으로만 답하세요 (코드펜스 없이 순수 JSON):
{
  "jd_questions": [{ "question": "...", "basis": "질문 의도 및 JD 근거" }],
  "personal_questions": [{ "question": "...", "basis": "연결되는 경험/근거" }]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function toTable(rows, headers) {
  const header = `| ${headers.join(" | ")} |`;
  const divider = `|${headers.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [header, divider, body].filter(Boolean).join("\n");
}

export async function generateInterviewQuestions({ role, coverLetterText, generate = generateText }) {
  const hasProfile = Boolean(coverLetterText && coverLetterText.trim());

  const contextParts = [`직무: ${role.name_ko}`];
  if (role?.common?.what_you_do?.length) {
    contextParts.push(`업무 내용: ${role.common.what_you_do.join(", ")}`);
  }
  if (hasProfile) {
    contextParts.push(`지원자 자기소개서(민감정보 마스킹됨):\n${redact(coverLetterText)}`);
  } else {
    contextParts.push("자기소개서가 제출되지 않았습니다. JD 기반 질문만 생성하세요.");
  }

  const raw = await generate({ system: SYSTEM, prompt: contextParts.join("\n") });
  const parsed = parseJsonLoose(raw) ?? { jd_questions: [], personal_questions: [] };

  const blocks = [
    {
      label: "예상 질문 JD 기반",
      content: toTable(
        (parsed.jd_questions ?? []).slice(0, 5).map((q) => [q.question, q.basis]),
        ["질문", "질문 의도 / JD 근거"],
      ),
    },
  ];

  if (hasProfile && (parsed.personal_questions ?? []).length > 0) {
    blocks.push({
      label: "예상 질문 개인 역량 기반",
      content: toTable(
        parsed.personal_questions.slice(0, 5).map((q) => [q.question, q.basis]),
        ["질문", "연결되는 경험/근거"],
      ),
    });
  }

  return {
    blocks,
    sources: [],
    state: "ok",
    notice: hasProfile ? undefined : "자기소개서를 제출하시면 개인 역량 기반 질문도 함께 생성됩니다",
  };
}
