import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");

function readJSON(relPath) {
  const p = path.join(DATA_DIR, relPath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function loadOrganizations() {
  return readJSON("organizations.json") ?? { as_of: null, source_url: null, companies: [] };
}

export function loadCompanyJobs() {
  return readJSON("company_jobs.json") ?? { companies: [] };
}

export function findCompany(companyId) {
  if (!companyId) return null;
  const org = loadOrganizations();
  return org.companies.find((c) => c.id === companyId) ?? null;
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

export function loadPosition(companyId, divisionId, roleId) {
  const p = `positions/${companyId}.${divisionId}.${roleId}.json`;
  return readJSON(p);
}
