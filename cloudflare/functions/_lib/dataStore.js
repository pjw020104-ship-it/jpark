// Workers 런타임에는 fs가 없다. 빌드 시 esbuild가 JSON을 그대로 번들에 포함시키도록
// import로 읽는다 (원본은 /data — 배포 전 `npm run sync-data`로 이 폴더에 복사해온다).
import organizations from "./data/organizations.json";
import companyJobs from "./data/company_jobs.json";

export function loadOrganizations() {
  return organizations ?? { as_of: null, source_url: null, companies: [] };
}

export function loadCompanyJobs() {
  return companyJobs ?? { companies: [] };
}

export function findCompany(companyId) {
  if (!companyId) return null;
  return loadOrganizations().companies.find((c) => c.id === companyId) ?? null;
}

// §9: 회사별 실제 직무명은 company_jobs.json(Job_name.txt 기반)에서만 조회한다.
export function findJobsForCompany(companyId) {
  if (!companyId) return [];
  const data = loadCompanyJobs();
  const entry = data.companies.find((c) => c.company_id === companyId);
  return entry ? entry.jobs : [];
}

export function findJob(jobId) {
  if (!jobId) return null;
  const data = loadCompanyJobs();
  for (const company of data.companies) {
    const job = company.jobs.find((j) => j.id === jobId);
    if (job) return { role: { id: job.id, name_ko: job.name_ko, common: {} } };
  }
  return null;
}
