import { loadIssuesForCompany } from "../lib/dataStore.js";
import * as metrics from "../lib/metrics.js";

function issueToBlocks(issue) {
  return [
    { label: "[이슈]", content: issue.headline },
    { label: "[배경]", content: issue.background },
    { label: "[실무 영향]", content: issue.work_impact },
    { label: "[면접 관점]", content: issue.interview_angle },
  ];
}

export function getJobIssues({ companyId, companyName, roleId, roleName, loadIssues = loadIssuesForCompany }) {
  const issues = loadIssues(companyId);

  const companyIssues = issues.filter((issue) => !issue.applies_to_roles || issue.applies_to_roles.length === 0);
  const jobIssues = issues.filter((issue) => issue.applies_to_roles && issue.applies_to_roles.includes(roleId));

  if (companyIssues.length === 0 && jobIssues.length === 0) {
    metrics.incr("issue_missing");
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: `현재 '${companyName ?? companyId} / ${roleName ?? roleId}'와 직접적으로 관련된 신뢰할 수 있는 최신 자료가 충분하지 않습니다.`,
    };
  }

  const blocks = [];
  const sources = [];

  if (companyIssues.length > 0) {
    blocks.push({ label: "[회사 이슈]", content: `${companyName ?? companyId}의 최근 회사 이슈입니다.` });
    for (const issue of companyIssues) {
      blocks.push(...issueToBlocks(issue));
      sources.push(...issue.sources);
    }
  }

  if (jobIssues.length > 0) {
    blocks.push({ label: "[직무 이슈]", content: `${roleName ?? roleId}와(과) 직접 관련된 최근 이슈입니다.` });
    for (const issue of jobIssues) {
      blocks.push(...issueToBlocks(issue));
      sources.push(...issue.sources);
    }
  }

  return { blocks, sources, state: "ok" };
}
