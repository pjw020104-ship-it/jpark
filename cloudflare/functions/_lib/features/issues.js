import { generateText } from "../llm.js";
import * as metrics from "../metrics.js";

// 실시간 검색 그라운딩이 없으므로, 특정 날짜의 뉴스를 지어내지 말고
// "일반적으로 알려진 산업 동향" 수준으로만 답하게 한다. 출처/URL은 검증할 방법이 없으므로 요구하지 않는다.
const SYSTEM = `당신은 한화그룹 지원자에게 회사·직무 관련 산업 동향을 설명하는 도우미입니다.
당신은 실시간 뉴스를 검색할 수 없습니다. 특정 날짜의 기사, 구체적인 보도 내용, URL을 지어내지 마세요.
대신 그 회사·산업에 대해 일반적으로 알려진 사업 방향, 기술 트렌드, 시장 환경 변화를 요약해서 설명하세요.

다음 두 종류를 함께 다루세요.
1. 회사 이슈: 사업 방향, 시장 환경, 신사업/기술 트렌드, 채용 시장에서 알려진 특징
2. 직무 이슈: 그 직무에서 최근 중요해지는 업무 방식/기술/역량 변화

규칙:
- 특정 기사 제목, 보도일자, URL을 절대 지어내지 마세요.
- 적합도 점수, 합격 가능성, 순위, 근거 없는 서술을 하지 않는다.
- 이 정보가 실시간 뉴스가 아니라 일반적인 산업 지식이라는 점을 알 수 있게 서술하세요.
- 확실하지 않으면 "확인이 필요합니다"라고 솔직히 답하고, insufficient를 true로 표시하세요.

아래 JSON으로만 답하세요 (코드펜스 없이 순수 JSON):
{
  "insufficient": false,
  "company_issues": [{ "headline": "한 문장 요약", "background": "왜 이런 흐름인가 (2~3문장)", "work_impact": "이 직무의 업무가 구체적으로 어떻게 바뀌는가", "interview_angle": "면접에서 물어볼 만한 각도 + 흔한 오답" }],
  "job_issues": [{ "headline": "...", "background": "...", "work_impact": "...", "interview_angle": "..." }]
}`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function issueToBlocks(issue, categoryLabel) {
  return [
    { label: categoryLabel, content: issue.headline },
    { label: "[배경]", content: issue.background },
    { label: "[실무 영향]", content: issue.work_impact },
    { label: "[면접 관점]", content: issue.interview_angle },
  ];
}

export async function getJobIssues({ companyName, roleName, apiKey, generate = generateText }) {
  const prompt = `회사: ${companyName}\n직무: ${roleName}\n위 회사와 직무에 대한 일반적인 산업 동향을 정리해줘.`;
  const raw = await generate({ system: SYSTEM, prompt, apiKey });
  const parsed = parseJsonLoose(raw);

  const isComplete = (issue) => Boolean(issue?.headline && issue?.background && issue?.work_impact);

  const companyIssues = (parsed?.company_issues ?? []).filter(isComplete);
  const jobIssues = (parsed?.job_issues ?? []).filter(isComplete);

  if (!parsed || parsed.insufficient || (companyIssues.length === 0 && jobIssues.length === 0)) {
    metrics.incr("issue_missing");
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: `현재 '${companyName} / ${roleName}'와 직접적으로 관련된 신뢰할 수 있는 최신 자료가 충분하지 않습니다.`,
    };
  }

  const blocks = [
    {
      label: "[안내]",
      content: "아래 내용은 실시간 뉴스가 아니라 일반적으로 알려진 산업 동향을 바탕으로 정리한 참고 자료입니다.",
    },
  ];

  for (const issue of companyIssues) blocks.push(...issueToBlocks(issue, "[회사 이슈]"));
  for (const issue of jobIssues) blocks.push(...issueToBlocks(issue, "[직무 이슈]"));

  return { blocks, sources: [], state: "ok" };
}
