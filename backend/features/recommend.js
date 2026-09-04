import { generateText } from "../lib/llm.js";
import { redact } from "../profile/redact.js";
import { loadOrganizations, loadCompanyJobs } from "../lib/dataStore.js";

// 이 점수 미만이면 진단을 계속하지 않고 더 맞는 회사·직무를 추천한다.
// §4.2의 6축 루브릭이 고정돼 있어서 직무가 달라도 같은 자로 잰 점수라 비교가 성립한다.
export const RECOMMEND_BELOW = 80;

const MAX_RECOMMENDATIONS = 3;

const SYSTEM = `당신은 한화그룹 지원자에게 더 잘 맞는 계열사·직무를 찾아주는 도우미입니다.

지원자의 자기소개서·포트폴리오와 채용 직무 목록을 받습니다.
자료에 실제로 적힌 전공·경험·역량만 근거로, 목록에서 가장 잘 맞는 직무를 최대 ${MAX_RECOMMENDATIONS}개 고르세요.

절대 규칙:
- **반드시 목록에 있는 position_id만** 쓰세요. 목록에 없는 회사나 직무를 만들어내지 마세요.
- 각 추천마다 자료의 어떤 내용 때문인지 근거(reason)를 한두 문장으로 적으세요. 근거는 자료에 있는 사실이어야 합니다.
- 지원자가 지금 보고 있던 직무는 제외합니다.
- 합격 가능성, 합격률, 백분율(%), 순위를 쓰지 마세요.
- 잘 맞는 직무를 찾지 못하면 recommendations를 빈 배열로 두세요. 억지로 채우지 마세요.

아래 JSON으로만 답하세요 (코드펜스 없이 순수 JSON):
{ "recommendations": [{ "position_id": "목록에 있는 값 그대로", "reason": "이 직무를 추천하는 근거" }] }`;

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** 전체 계열사 x 직무 목록. 모델에게는 이 목록 밖을 고르지 못하게 한다. */
export function buildCatalog() {
  const companyNames = new Map(loadOrganizations().companies.map((c) => [c.id, c.name_ko]));
  const catalog = [];

  for (const company of loadCompanyJobs().companies) {
    const companyName = companyNames.get(company.company_id);
    if (!companyName) continue; // organizations.json에 없는 계열사는 노출하지 않는다 (§9)
    for (const job of company.jobs) {
      catalog.push({
        company_id: company.company_id,
        company_name: companyName,
        position_id: job.id,
        position_name: job.name_ko,
      });
    }
  }

  return catalog;
}

/** 점수가 낮아 진단 대신 추천으로 넘어가야 하는지. */
export function shouldRecommendInstead(fit) {
  return typeof fit?.score === "number" && fit.score < RECOMMEND_BELOW;
}

/**
 * 자기소개서·포트폴리오를 보고 더 맞는 계열사·직무를 고른다.
 * 모델이 지어낸 직무를 그대로 내보내면 클릭했을 때 동작하지 않으므로,
 * 목록에 실제로 있는 position_id만 남긴다.
 */
export async function recommendRoles({
  coverLetterText,
  portfolioText,
  excludePositionId,
  generate = generateText,
  catalog = buildCatalog(),
}) {
  const pool = catalog.filter((item) => item.position_id !== excludePositionId);
  if (pool.length === 0) return [];

  // §6: 학교명·생년·성별·주소·연락처는 LLM 호출 전에 마스킹한다.
  const redactedCoverLetter = redact(coverLetterText);
  const redactedPortfolio = portfolioText && portfolioText.trim() ? redact(portfolioText) : "";

  const prompt = [
    "## 채용 직무 목록",
    pool.map((item) => `${item.position_id} | ${item.company_name} | ${item.position_name}`).join("\n"),
    "",
    `[출처: 자기소개서]\n${redactedCoverLetter}`,
    redactedPortfolio ? `## 첨부 자료\n${redactedPortfolio}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generate({ system: SYSTEM, prompt, temperature: 0 });
  const parsed = parseJsonLoose(raw);
  if (!parsed) return [];

  const byId = new Map(pool.map((item) => [item.position_id, item]));
  const seen = new Set();
  const picked = [];

  for (const rec of parsed.recommendations ?? []) {
    const match = byId.get(String(rec?.position_id ?? "").trim());
    if (!match || seen.has(match.position_id)) continue;
    seen.add(match.position_id);
    picked.push({ ...match, reason: String(rec?.reason ?? "").trim() });
    if (picked.length >= MAX_RECOMMENDATIONS) break;
  }

  return picked;
}
