import { loadOrganizations } from "../_lib/dataStore.js";

// §9: 계열사/직무명은 코드에 하드코딩하지 않고 data/*.json에서 조회한다.
export async function onRequestGet() {
  const org = loadOrganizations();
  return Response.json({
    as_of: org.as_of,
    companies: org.companies.map((c) => ({ id: c.id, name_ko: c.name_ko })),
  });
}
