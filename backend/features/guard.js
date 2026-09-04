// §6 출력 차단. 어떤 기능에서도 나오면 안 되는 표현.
const FORBIDDEN_PATTERNS = [
  /\d+(\.\d+)?\s?%/,
  /합격\s?가능성/,
  /합격률/,
  /\d+\s?위\b/,
  /순위/,
];

// §6은 원래 "적합도"와 "N점"도 함께 금지했다. §4.2 역량 진단이 직무 적합도 점수를
// 명시적으로 출력하도록 요구사항이 바뀌면서 이 둘만 예외로 분리했다.
// 백분율·합격 가능성·합격률·순위 금지는 그대로 유지된다.
// 점수 출력을 다시 막으려면 SCORE_PATTERNS를 FORBIDDEN_PATTERNS에 합치면 된다.
const SCORE_PATTERNS = [/적합도/, /\d+\s?점\b/];

export function containsForbiddenPattern(text) {
  if (!text) return false;
  return FORBIDDEN_PATTERNS.some((re) => re.test(text));
}

export function containsScorePattern(text) {
  if (!text) return false;
  return SCORE_PATTERNS.some((re) => re.test(text));
}

export function assertNoForbiddenPatterns(blocks) {
  const joined = blocks.map((b) => `${b.label}\n${b.content}`).join("\n");
  return !containsForbiddenPattern(joined);
}

export function stripForbidden(text) {
  if (!text) return text;
  let out = text;
  for (const re of FORBIDDEN_PATTERNS) {
    out = out.replace(new RegExp(re.source, "g"), "");
  }
  return out;
}
