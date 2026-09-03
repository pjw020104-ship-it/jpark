import { findJobsForCompany } from "../_lib/dataStore.js";

export async function onRequestGet({ request }) {
  const companyId = new URL(request.url).searchParams.get("company_id");
  if (!companyId) {
    return Response.json({ error: "company_id가 필요합니다." }, { status: 400 });
  }
  return Response.json({ jobs: findJobsForCompany(companyId) });
}
