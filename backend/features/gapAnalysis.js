import { generateText } from "../lib/llm.js";
import { redact } from "../profile/redact.js";
import { stripForbidden } from "./guard.js";

const SYSTEM = `당신은 한화그룹 지원자의 이력서를 특정 직무의 요구 역량과 비교하는 도우미입니다.

절대 규칙:
- 점수, 백분율, 합격 가능성, 순위, "적합도" 같은 표현을 절대 출력하지 마세요.
- 강점 판정에는 반드시 이력서 원문 근거(인용)를 포함하세요. 근거 없는 칭찬은 금지입니다.
- "미보유" 항목은 지적으로 끝내지 말고 지금부터 준비 가능한 현실적 대안을 반드시 붙이세요.
- 이력서에 없는 경험을 지어내지 마세요.

아래 JSON 형식으로만 답하세요 (마크다운 코드펜스 없이 순수 JSON):
{
  "strengths": [{"skill": "...", "evidence": "이력서 인용문"}],
  "gaps": [{"skill": "...", "how_to_improve": "..."}],
  "missing": [{"skill": "...", "alternative": "..."}]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function analyzeGap({ role, profileText, generate = generateText }) {
  if (!profileText || !profileText.trim()) {
    return {
      blocks: [],
      sources: [],
      state: "needs_profile",
      notice: "이력서 또는 간단 프로필 입력이 필요합니다",
    };
  }

  const requiredSkills = role?.common?.required_skills ?? [];
  const preferredSkills = role?.common?.preferred_skills ?? [];

  if (requiredSkills.length === 0 && preferredSkills.length === 0) {
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: "해당 직무의 역량 기준 정보가 아직 준비되지 않았습니다",
    };
  }

  const redacted = redact(profileText);

  const prompt = `직무: ${role.name_ko}
요구 역량: ${JSON.stringify(requiredSkills)}
우대 역량: ${JSON.stringify(preferredSkills)}
지원자 이력서(민감정보 마스킹됨):
${redacted}`;

  const raw = await generate({ system: SYSTEM, prompt });
  const parsed = parseJsonLoose(raw) ?? { strengths: [], gaps: [], missing: [] };

  const blocks = [
    {
      label: "[강점]",
      content: stripForbidden(
        (parsed.strengths ?? []).map((s) => `${s.skill}: ${s.evidence}`).join("\n") || "확인된 강점이 없습니다.",
      ),
    },
    {
      label: "[보완 필요]",
      content: stripForbidden(
        (parsed.gaps ?? []).map((g) => `${g.skill}: ${g.how_to_improve}`).join("\n") || "해당 없음",
      ),
    },
    {
      label: "[미보유]",
      content: stripForbidden(
        (parsed.missing ?? []).map((m) => `${m.skill}: ${m.alternative}`).join("\n") || "해당 없음",
      ),
    },
  ];

  return { blocks, sources: [], state: "ok" };
}
