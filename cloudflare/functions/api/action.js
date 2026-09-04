import { findCompany, findJob } from "../_lib/dataStore.js";
import { setActiveContext } from "../_lib/sessionStore.js";
import { generateScenario } from "../_lib/features/scenario.js";
import { analyzeGap } from "../_lib/features/gapAnalysis.js";
import { recommendRoles, shouldRecommendInstead } from "../_lib/features/recommend.js";
import { getJobIssues } from "../_lib/features/issues.js";
import { generateInterviewQuestions } from "../_lib/features/interview.js";
import { describeLlmError } from "../_lib/llm.js";

const today = () => new Date().toISOString().slice(0, 10);
// 같은 자료를 다시 제출했을 때 점수가 달라지지 않게 하기 위한 캐시 키.
// LLM은 temperature 0에서도 완전히 결정적이지 않아서, 입력이 같으면 저장된 결과를 그대로 돌려준다.
function gapCacheKey(companyId, positionId, coverLetter, portfolio) {
  const source = `${companyId}|${positionId}|${coverLetter ?? ""}|${portfolio ?? ""}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

// §4.5: 직무 4버튼 라우팅. 기능 로직은 _lib/features/*.js에 위임하고 여기서는 라우팅만 한다.
export async function onRequestPost({ request, env }) {
  const { session_id, action, company_id, position_id, cover_letter_text, portfolio_text, portfolio_file_names } =
    await request.json();

  if (!session_id || !action) {
    return Response.json({ error: "session_id, action이 필요합니다." }, { status: 400 });
  }

  const apiKey = env.GEMINI_API_KEY;
  const session = setActiveContext(session_id, { companyId: company_id, positionId: position_id });
  const companyId = session.activeCompanyId;
  const positionId = session.activePositionId;

  if (!companyId || !positionId) {
    return Response.json({ error: "company_id와 position_id가 모두 확정되어야 합니다." }, { status: 400 });
  }

  const company = findCompany(companyId);
  const found = findJob(positionId);

  if (!company || !found) {
    return Response.json({ error: "알 수 없는 company_id 또는 position_id 입니다." }, { status: 400 });
  }

  try {
    let result;

    switch (action) {
      case "job_description":
        result = await generateScenario({ role: found.role, companyName: company.name_ko, apiKey });
        break;

      case "skill_gap": {
        // 이 요청에 직접 실린 텍스트만 사용한다. 세션에 남아있는 이전 값으로
        // 조용히 대체하지 않는다 - 사용자가 입력하지 않은 자료로 답하는 것을 방지한다.
        const cacheKey = gapCacheKey(companyId, positionId, cover_letter_text, portfolio_text);
        if (session.gapCacheKey === cacheKey && session.lastGapAnalysis) {
          result = session.lastGapAnalysis;
        } else {
          result = await analyzeGap({
            role: found.role,
            companyName: company.name_ko,
            coverLetterText: cover_letter_text,
            portfolioText: portfolio_text,
            portfolioFileNames: portfolio_file_names,
            apiKey,
          });
          // §4.2 확장: 적합도가 낮으면 진단을 이어가지 않고 더 맞는 직무를 추천한다.
          // 추천이 하나도 안 나오면 원래 진단 결과를 그대로 보여준다.
          if (shouldRecommendInstead(result.fit)) {
            const recommendations = await recommendRoles({
              coverLetterText: cover_letter_text,
              portfolioText: portfolio_text,
              excludePositionId: positionId,
              apiKey,
            });
            if (recommendations.length > 0) {
              result = {
                blocks: [],
                sources: [],
                state: "ok",
                fit: result.fit,
                notice: "지원자님의 자기소개서 내용으로 미루어 보아 현재 회사·직무와는 잘 맞지 않습니다. 제가 더 적합한 회사와 직무를 추천해 드릴게요.",
                recommendations,
              };
            }
          }

          if (result.state === "ok") {
            session.coverLetterSummary = cover_letter_text;
            session.portfolioSummary = portfolio_text;
            session.lastGapAnalysis = result;
            session.gapCacheKey = cacheKey;
          }
        }
        break;
      }

      case "job_issues":
        result = await getJobIssues({ companyName: company.name_ko, roleName: found.role.name_ko, apiKey });
        if (result.state === "ok") session.lastIssues = result;
        break;

      case "interview_questions":
        result = await generateInterviewQuestions({
          role: found.role,
          coverLetterText: session.coverLetterSummary,
          apiKey,
        });
        break;

      default:
        return Response.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
    }

    if (result.state === "ok") session.completed.add(action);

    return Response.json({ action, as_of: today(), ...result });
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        action,
        blocks: [],
        sources: [],
        as_of: today(),
        state: "fallback",
        notice: describeLlmError(error),
      },
      { status: 500 },
    );
  }
}
