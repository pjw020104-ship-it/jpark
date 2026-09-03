// /data는 프론트/백엔드가 공유하는 원본이다. Workers 함수는 fs로 읽을 수 없으므로
// 배포 전 이 스크립트로 functions/_lib/data/에 복사해서 JS import로 번들에 포함시킨다.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..", "data");
const DEST = join(__dirname, "..", "functions", "_lib", "data");

mkdirSync(DEST, { recursive: true });

for (const file of ["organizations.json", "company_jobs.json"]) {
  copyFileSync(join(SRC, file), join(DEST, file));
  console.log(`synced ${file}`);
}
