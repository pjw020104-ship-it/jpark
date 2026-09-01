const FORBIDDEN_PATTERNS = [
  /\d+(\.\d+)?\s?%/,
  /적합도/,
  /합격\s?가능성/,
  /합격률/,
  /\d+\s?점\b/,
  /\d+\s?위\b/,
  /순위/,
];

export function containsForbiddenPattern(text) {
  if (!text) return false;
  return FORBIDDEN_PATTERNS.some((re) => re.test(text));
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
