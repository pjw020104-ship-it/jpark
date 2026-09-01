import { generateText } from "../lib/llm.js";

const SYSTEM = `당신은 한화그룹 지원자의 면접을 준비시키는 도우미입니다.

절대 규칙:
- 모범 답안 전문을 작성하지 마세요. 답변의 방향과 구조까지만 조언하세요.
- 이 질문들은 실제 기출 문항이 아닙니다. "예상 질문"일 뿐이라는 것을 항상 전제하세요.
- "약점 파고들기" 성격의 질문은 압박 면접 재현이 아니라 사전 대비용임을 전제로 문구를 작성하세요.
- 주어지지 않은 이력 정보를 지어내지 마세요.

아래 JSON 형식으로만 답하세요 (코드펜스 없이 순수 JSON):
{
  "questions": [
    { "question": "...", "why": "이 질문이 검증하려는 역량", "direction": "어떤 경험을 어떤 순서로 꺼낼지 (구조 조언까지만)", "followup": "이어질 가능성이 높은 후속 질문 1개" }
  ]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function generateInterviewQuestions({ role, gapAnalysis, issuesResult, generate = generateText }) {
  const notices = [];
  if (!gapAnalysis || gapAnalysis.state !== "ok") {
    notices.push("먼저 역량 진단을 하면 더 정확한 질문이 나옵니다");
  }

  const contextParts = [`직무: ${role.name_ko}`];

  if (role?.common?.what_you_do?.length) {
    contextParts.push(`업무 내용: ${role.common.what_you_do.join(", ")}`);
  }
  if (role?.common?.interview_themes?.length) {
    contextParts.push(`면접 테마: ${role.common.interview_themes.join(", ")}`);
  }
  if (gapAnalysis?.state === "ok") {
    contextParts.push(`역량 갭 분석 결과: ${JSON.stringify(gapAnalysis.blocks)}`);
  }

  const hasIssues = issuesResult?.state === "ok" && issuesResult.blocks.length > 0;
  if (hasIssues) {
    contextParts.push(
      `산업 이슈: ${issuesResult.blocks
        .filter((b) => b.label === "[이슈]")
        .map((b) => b.content)
        .join(", ")} — 이와 관련된 질문을 1~2개 포함하세요.`,
    );
  }

  const prompt = contextParts.join("\n");
  const raw = await generate({ system: SYSTEM, prompt });
  const parsed = parseJsonLoose(raw) ?? { questions: [] };

  const blocks = (parsed.questions ?? []).map((q) => ({
    label: "[예상 질문]",
    content: [
      `Q. ${q.question}`,
      `└ 왜 나오는가 : ${q.why}`,
      `└ 답변 방향   : ${q.direction}`,
      `└ 꼬리 질문   : ${q.followup}`,
    ].join("\n"),
  }));

  return {
    blocks,
    sources: hasIssues ? issuesResult.sources : [],
    state: "ok",
    notice: notices.join(" ") || undefined,
  };
}
