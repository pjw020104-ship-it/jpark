import { generateText } from "../lib/llm.js";
import { redact } from "../profile/redact.js";
import { stripForbidden } from "./guard.js";

const SYSTEM = `당신은 한화그룹 지원자의 자기소개서·포트폴리오를 특정 회사·직무 기준으로 진단하는 도우미입니다.

절대 규칙:
- 제공된 자기소개서와 첨부 자료에 **실제로 적혀 있는 내용만** 근거로 사용하세요. 없는 경험·역량·성과를 추측하거나 지어내지 마세요.
- 근거를 찾을 수 없으면 비워 두거나 "확인 불가"로 표시하세요. 그럴듯하게 채우지 마세요.
- 자료에는 [출처: 파일명 p.3] 또는 [출처: 직접 입력] 형태의 머리말이 붙어 있습니다. 어떤 항목의 근거를 찾으면 그 머리말을 그대로 source에 적으세요 (예: "포트폴리오.pdf p.3", "자기소개서").
- 합격 가능성, 합격률, 백분율(%), 순위는 절대 쓰지 마세요.
- 지원자를 깎아내리지 말고, 부족한 역량은 보완 방향까지 함께 제시하세요.
- 각 항목은 500자 이내로 작성하세요.

## 평가 축 (고정 — 바꾸지 말 것)
core_competencies는 **아래 6개 축을 이 순서 그대로** 씁니다. 축을 새로 만들거나 빼거나 순서를 바꾸지 마세요.
축 이름은 axis에 그대로 넣고, competency에는 그 축에서 **이 직무가 요구하는 구체적인 능력**을 적으세요.

1. 전공·직무 지식
2. 실무·프로젝트 경험
3. 도구·기술 활용
4. 성과의 구체성
5. 협업·커뮤니케이션
6. 직무 이해·지원 준비도

## 등급 판정
각 축을 자료에 있는 근거만으로 판정합니다. 네 가지 중 하나를 정확히 그대로 쓰세요.
- 충분 : 구체적 경험과 결과가 자료에 적혀 있음
- 보통 : 관련 경험은 있으나 근거가 얕거나 부분적임
- 부족 : 직무 요구 대비 명확히 모자람
- 확인 불가 : 자료에 언급 자체가 없음

fit_summary에는 "6개 축 중 충분 N개, 보통 M개" 형태로 근거를 한 문장 넣고 부족한 부분을 덧붙이세요.
점수 숫자는 시스템이 이 등급에서 계산하므로 직접 매기지 않아도 됩니다.

아래 JSON 형식으로만 답하세요 (코드펜스 없이 순수 JSON):
{
  "fit_score": 0,
  "fit_summary": "점수 근거를 2~3문장으로",
  "strengths": [{ "title": "강점", "evidence": "근거가 된 경험", "requirement_link": "이 직무의 어떤 요구사항과 연결되는지", "source": "파일명 p.N 또는 자기소개서" }],
  "gaps": [{ "title": "부족하거나 확인되지 않는 역량", "why": "왜 그렇게 판단했는지", "how_to_fill": "보완 방향" }],
  "core_competencies": [{ "axis": "고정 축 이름", "competency": "이 직무가 그 축에서 요구하는 능력", "level": "충분|보통|부족|확인 불가", "evidence": "근거 (없으면 빈 문자열)", "source": "파일명 p.N 또는 자기소개서 (없으면 빈 문자열)" }],
  "resume_highlights": [{ "experience": "강조할 경험", "why": "왜 이 직무에 효과적인지", "how_to_write": "어떻게 서술할지", "source": "파일명 p.N 또는 자기소개서" }],
  "interview_items": [{ "experience": "면접에서 꺼낼 경험", "question": "예상 질문", "answer_direction": "답변 방향", "source": "파일명 p.N 또는 자기소개서" }]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const LEVEL_POINTS = { 충분: 2, 보통: 1, 부족: 0, "확인 불가": 0, 확인불가: 0 };

/**
 * 0~100 정수로만 받아들인다. 모델이 이상한 값을 주면 점수를 아예 표시하지 않는다.
 * Number(null)/Number("")이 0이 되어 "0점"으로 새는 것을 막으려고 타입을 먼저 좁힌다.
 * 5점 단위로 스냅해서 62/64 같은 미세한 흔들림이 다른 판정처럼 보이지 않게 한다.
 */
function normalizeScore(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Math.round(numeric / 5) * 5;
}

/**
 * 점수를 모델이 부르는 대로 쓰지 않고 핵심 역량 판정에서 직접 계산한다.
 * 모델에게 숫자를 맡기면 같은 자료를 다시 넣어도 값이 크게 튄다(65 → 50처럼).
 * 역량 등급 판정은 훨씬 안정적이고, 화면에 함께 보이는 역량 표와 점수가 어긋나지도 않는다.
 * 등급을 알아볼 수 없으면 null을 돌려 모델이 준 fit_score로 넘어간다.
 */
function scoreFromCompetencies(competencies) {
  const levels = (competencies ?? [])
    .map((c) => String(c?.level ?? "").trim())
    .filter((level) => level in LEVEL_POINTS);

  if (levels.length < 3) return null;

  const earned = levels.reduce((sum, level) => sum + LEVEL_POINTS[level], 0);
  return Math.round(((earned / (levels.length * 2)) * 100) / 5) * 5;
}

/** 요구사항 7: 근거를 찾은 자료의 파일명·페이지를 항목 뒤에 붙인다. */
function citation(source) {
  const trimmed = typeof source === "string" ? source.trim() : "";
  return trimmed ? ` _(근거: ${trimmed})_` : "";
}

function clean(text) {
  return stripForbidden(String(text ?? "").trim());
}

function bulletList(items, render, emptyText) {
  const lines = (items ?? []).map(render).filter(Boolean);
  return lines.length > 0 ? lines.join("\n\n") : emptyText;
}

export async function analyzeGap({
  role,
  companyName,
  coverLetterText,
  portfolioText,
  portfolioFileNames = [],
  generate = generateText,
}) {
  if (!coverLetterText || !coverLetterText.trim()) {
    return {
      blocks: [],
      sources: [],
      state: "needs_profile",
      notice: "역량 진단을 위해 자기소개서(선택: 포트폴리오)를 입력해주세요",
    };
  }

  // §6: 학교명·생년·성별·주소·연락처는 LLM 호출 전에 마스킹한다.
  // 첨부 파일에서 추출한 텍스트도 portfolioText에 합쳐져 들어오므로 같이 마스킹된다.
  const redactedCoverLetter = redact(coverLetterText);
  const redactedPortfolio = portfolioText && portfolioText.trim() ? redact(portfolioText) : "";

  const prompt = [
    companyName ? `지원 회사: ${companyName}` : "",
    `지원 직무: ${role.name_ko}`,
    portfolioFileNames.length > 0 ? `첨부 파일: ${portfolioFileNames.join(", ")}` : "",
    `[출처: 자기소개서]\n${redactedCoverLetter}`,
    redactedPortfolio ? `## 첨부 자료\n${redactedPortfolio}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // temperature 0. 같은 자료를 다시 제출했을 때 점수가 흔들리지 않게 한다.
  const raw = await generate({ system: SYSTEM, prompt, temperature: 0 });
  const parsed = parseJsonLoose(raw);

  if (!parsed) {
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: "진단 결과를 해석하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  const blocks = [];

  blocks.push({
    label: "주요 강점",
    content: bulletList(
      parsed.strengths,
      (s) =>
        [
          `- **${clean(s.title)}**${citation(s.source)}`,
          s.evidence ? `  - 근거 경험: ${clean(s.evidence)}` : "",
          s.requirement_link ? `  - 직무 연관성: ${clean(s.requirement_link)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      "제출한 자료에서 확인된 강점이 없습니다.",
    ),
  });

  blocks.push({
    label: "부족하거나 확인되지 않는 역량",
    content: bulletList(
      parsed.gaps,
      (g) =>
        [
          `- **${clean(g.title)}**`,
          g.why ? `  - 판단 근거: ${clean(g.why)}` : "",
          g.how_to_fill ? `  - 보완 방향: ${clean(g.how_to_fill)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      "해당 없음",
    ),
  });

  const competencies = parsed.core_competencies ?? [];
  blocks.push({
    label: "직무별 핵심 역량 평가",
    content:
      competencies.length > 0
        ? [
            "| 평가 축 | 이 직무가 요구하는 능력 | 평가 | 근거 | 출처 |",
            "|---|---|---|---|---|",
            ...competencies.map((c) =>
              [
                "",
                clean(c.axis) || "-",
                clean(c.competency),
                clean(c.level) || "확인 불가",
                clean(c.evidence) || "자료에서 확인되지 않음",
                clean(c.source) || "-",
                "",
              ].join(" | "),
            ),
          ].join("\n")
        : "평가할 핵심 역량을 판단하지 못했습니다.",
  });

  blocks.push({
    label: "자기소개서에서 강조할 경험",
    content: bulletList(
      parsed.resume_highlights,
      (h) =>
        [
          `- **${clean(h.experience)}**${citation(h.source)}`,
          h.why ? `  - 효과: ${clean(h.why)}` : "",
          h.how_to_write ? `  - 서술 방향: ${clean(h.how_to_write)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      "강조할 경험을 찾지 못했습니다.",
    ),
  });

  blocks.push({
    label: "면접에서 활용할 경험 및 예상 질문",
    content: bulletList(
      parsed.interview_items,
      (q) =>
        [
          `- **${clean(q.experience)}**${citation(q.source)}`,
          q.question ? `  - 예상 질문: ${clean(q.question)}` : "",
          q.answer_direction ? `  - 답변 방향: ${clean(q.answer_direction)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      "면접에서 활용할 경험을 찾지 못했습니다.",
    ),
  });

  // 역량 표에서 계산한 값이 우선. 등급을 못 읽을 때만 모델이 준 숫자를 쓴다.
  const score = scoreFromCompetencies(competencies) ?? normalizeScore(parsed.fit_score);
  const result = { blocks, sources: [], state: "ok" };

  if (score !== null) {
    result.fit = { score, summary: clean(parsed.fit_summary) || undefined };
  }
  if (redactedPortfolio) {
    result.notice = "첨부 자료와 자기소개서에 실제로 적힌 내용만 근거로 사용했습니다.";
  }

  return result;
}
