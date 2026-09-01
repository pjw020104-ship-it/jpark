import { loadIssuesForCompany } from "../lib/dataStore.js";
import * as metrics from "../lib/metrics.js";

export function getJobIssues({ companyId, roleId, loadIssues = loadIssuesForCompany }) {
  const issues = loadIssues(companyId).filter(
    (issue) => !issue.applies_to_roles || issue.applies_to_roles.length === 0 || issue.applies_to_roles.includes(roleId),
  );

  if (issues.length === 0) {
    metrics.incr("issue_missing");
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: "관련 자료가 준비 중입니다",
    };
  }

  const blocks = [];
  const sources = [];

  for (const issue of issues) {
    blocks.push({ label: "[이슈]", content: issue.headline });
    blocks.push({ label: "[배경]", content: issue.background });
    blocks.push({ label: "[실무 영향]", content: issue.work_impact });
    blocks.push({ label: "[면접 관점]", content: issue.interview_angle });
    sources.push(...issue.sources);
  }

  return { blocks, sources, state: "ok" };
}
