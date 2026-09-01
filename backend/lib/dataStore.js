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

export function loadJobFamilies() {
  return readJSON("job_families.json") ?? { families: [] };
}

export function findCompany(companyId) {
  if (!companyId) return null;
  const org = loadOrganizations();
  return org.companies.find((c) => c.id === companyId) ?? null;
}

export function findRole(roleId) {
  if (!roleId) return null;
  const jf = loadJobFamilies();
  for (const family of jf.families) {
    const role = family.roles.find((r) => r.id === roleId);
    if (role) return { family, role };
  }
  return null;
}

export function findRoleByName(nameKo) {
  if (!nameKo) return null;
  const jf = loadJobFamilies();
  for (const family of jf.families) {
    const role = family.roles.find((r) => r.name_ko === nameKo);
    if (role) return { family, role };
  }
  return null;
}

export function loadPosition(companyId, divisionId, roleId) {
  const p = `positions/${companyId}.${divisionId}.${roleId}.json`;
  return readJSON(p);
}

export function filterActiveIssues(issues, now = new Date()) {
  return issues.filter((issue) => {
    if (!issue.sources || issue.sources.length === 0) return false;
    if (issue.expires_at && new Date(issue.expires_at) < now) return false;
    return true;
  });
}

export function loadIssuesForCompany(companyId) {
  if (!companyId) return [];
  const data = readJSON(`issues/${companyId}.json`);
  if (!data) return [];
  const list = Array.isArray(data) ? data : (data.issues ?? []);
  return filterActiveIssues(list);
}
