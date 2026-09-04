import { generateGroundedText, generateText } from "../lib/llm.js";
import * as metrics from "../lib/metrics.js";

// 왜 2단계로 나눴는가:
// 검색 그라운딩을 켠 채로 "순수 JSON으로만 답하라"고 하면 모델이 검색을 건너뛰고
// 기억에 있는 내용으로 JSON을 채워버린다(groundingMetadata가 아예 오지 않고, 매체명·보도일자까지 지어냄).
// 그래서 1단계는 자유 서술로 검색만 시키고, 2단계에서 그 결과만 근거로 JSON을 만든다.
// 출처 URL은 1단계 그라운딩 메타데이터에서 온 것만 쓴다 (모델이 본문에 쓴 URL은 신뢰하지 않는다).

const RESEARCH_SYSTEM = `당신은 한화그룹 지원자에게 회사·직무 관련 최신 이슈를 조사해주는 리서처입니다.
Google 검색 도구로 **반드시 먼저 검색**한 뒤, 검색 결과에 실제로 있는 내용만 정리하세요.

다음 두 가지를 나눠서 조사하세요.
1. 회사 이슈: 그 회사에 대해 최근 실제로 보도된 사업·수주·투자·조직·시장 환경 뉴스 (2~3건)
2. 직무 이슈: 그 직무·산업에서 최근 보도된 기술/업무 방식/역량 수요의 변화 (1~2건)

각 항목마다 이렇게 적으세요.
- 한 문장 요약
- 보도 매체명과 보도 시점 (검색 결과에 나온 그대로. 확인되지 않으면 "확인 안 됨")
- 보도된 내용과 배경
- 그 직무의 업무에 미치는 영향

최근 것부터 우선하고 가능하면 최근 12개월 이내 보도를 쓰세요.
미공개 경영 정보 추측, 인수·구조조정 전망, 실적·주가 예측은 하지 마세요. 보도된 사실과 일반적 해석까지만.
검색해도 관련 보도를 찾지 못했으면 지어내지 말고 "관련 보도를 찾지 못했습니다"라고만 쓰세요.`;

const STRUCTURE_SYSTEM = `아래는 검색으로 수집한 뉴스 조사 결과입니다. 이것을 JSON으로 재구성하세요.

절대 규칙:
- **조사 결과에 있는 내용만** 쓰세요. 새로운 사건, 매체명, 날짜를 추가하지 마세요.
- 조사 결과에 매체명·보도일자가 없으면 outlet/published_at을 빈 문자열로 두세요. 채워 넣지 마세요.
- 본문에 URL을 쓰지 마세요. 링크는 시스템이 따로 붙입니다.
- 적합도 점수, 합격 가능성, 순위를 쓰지 마세요.
- 조사 결과가 "관련 보도를 찾지 못했습니다"이면 insufficient를 true로 하고 배열을 비우세요.

아래 JSON으로만 답하세요 (코드펜스 없이 순수 JSON):
{
  "insufficient": false,
  "company_issues": [{ "headline": "한 문장 요약", "outlet": "매체명", "published_at": "YYYY-MM-DD 또는 YYYY-MM", "background": "보도된 내용과 배경 (2~3문장)", "work_impact": "이 직무의 업무가 구체적으로 어떻게 바뀌는가", "interview_angle": "면접에서 물어볼 만한 각도 + 흔한 오답" }],
  "job_issues": [{ "headline": "...", "outlet": "...", "published_at": "...", "background": "...", "work_impact": "...", "interview_angle": "..." }]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** "매체 · 2026-08-30" 형태의 보도 정보. 둘 다 없으면 줄 자체를 넣지 않는다. */
function reportedLine(issue) {
  const parts = [issue.outlet, issue.published_at]
    .map((v) => (v ?? "").trim())
    .filter((v) => v && v !== "확인 안 됨");
  return parts.join(" · ");
}

/**
 * 이슈 하나를 블록 하나로 만든다.
 * 예전에는 [회사 이슈]/[배경]/[실무 영향]/[면접 관점]을 각각 별도 블록으로 내보내
 * 같은 라벨이 이슈마다 반복돼 어디서 이슈가 끊기는지 알아보기 어려웠다.
 * 이제 "1. 회사 이슈" 하나 아래에 하위 항목을 목록으로 묶는다.
 */
function issueToBlock(issue, categoryLabel, index) {
  const reported = reportedLine(issue);

  const lines = [`**${issue.headline}**`];
  if (reported) lines.push(`_${reported}_`);
  lines.push("");
  lines.push(`- **배경** — ${issue.background}`);
  lines.push(`- **실무 영향** — ${issue.work_impact}`);
  if (issue.interview_angle) lines.push(`- **면접 관점** — ${issue.interview_angle}`);

  return { label: `${index}. ${categoryLabel}`, content: lines.join("\n") };
}

function noNews(companyName, roleName, notice) {
  metrics.incr("issue_missing");
  return { blocks: [], sources: [], state: "fallback", notice };
}

export async function getJobIssues({
  companyName,
  roleName,
  research = generateGroundedText,
  structure = generateText,
}) {
  // 1단계 — 검색 그라운딩. 자유 서술이라야 모델이 실제로 검색한다.
  const researchPrompt = `회사: ${companyName}\n직무: ${roleName}\n위 회사와 직무에 관해 최근 실제로 보도된 뉴스를 검색해서 정리해줘.`;
  const { text: findings, sources = [] } = await research({ system: RESEARCH_SYSTEM, prompt: researchPrompt });

  // 그라운딩 출처가 하나도 없으면 검색이 실제로 일어나지 않고 기억으로 답한 것이다.
  // 뉴스 기반이라고 안내할 근거가 없으므로 그대로 내보내지 않는다.
  if (sources.length === 0) {
    metrics.incr("issue_ungrounded");
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: `'${companyName} / ${roleName}' 관련 뉴스를 검색하지 못했습니다. 잠시 후 다시 시도해주세요.`,
    };
  }

  // 2단계 — 검색 결과만 근거로 구조화. 여기서는 검색 도구를 쓰지 않는다.
  const raw = await structure({ system: STRUCTURE_SYSTEM, prompt: findings });
  const parsed = parseJsonLoose(raw);

  const isComplete = (issue) => Boolean(issue?.headline && issue?.background && issue?.work_impact);
  const companyIssues = (parsed?.company_issues ?? []).filter(isComplete);
  const jobIssues = (parsed?.job_issues ?? []).filter(isComplete);

  if (!parsed || parsed.insufficient || (companyIssues.length === 0 && jobIssues.length === 0)) {
    return noNews(
      companyName,
      roleName,
      `현재 '${companyName} / ${roleName}'와 직접적으로 관련된 신뢰할 수 있는 최신 자료가 충분하지 않습니다.`,
    );
  }

  // 안내는 별도 블록 대신 notice로 보낸다. 블록 라벨이 늘어날수록 기계가 찍어낸 목록처럼 보인다.
  const blocks = [];

  companyIssues.forEach((issue, i) => blocks.push(issueToBlock(issue, "회사 이슈", i + 1)));
  jobIssues.forEach((issue, i) => blocks.push(issueToBlock(issue, "직무 이슈", i + 1)));

  return {
    blocks,
    sources,
    state: "ok",
    notice: "검색으로 찾은 보도를 근거로 정리했습니다. 아래 출처에서 원문을 볼 수 있습니다.",
  };
}
