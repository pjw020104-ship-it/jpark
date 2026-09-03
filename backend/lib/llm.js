import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.6-flash";
let ai;

function getClient() {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
const RETRY_DELAYS_MS = [1000, 3000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini가 순간적으로 과부하거나(429/503) 일시적으로 실패할 때(500/502) 잠깐 기다리면 성공하는 경우가 많다.
// 재시도를 다 소진해도 실패하면 원본 에러에 사용자용 안내 코드를 붙여서 그대로 던진다 -
// 호출부(server.js)가 이 코드로 "일시적 오류"와 "그 외 오류"를 구분해 다른 메시지를 보여줄 수 있게 한다.
export async function callWithRetry(fn, delaysMs = RETRY_DELAYS_MS) {
  let lastError;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.status;
      if (!RETRYABLE_STATUS.has(status) || attempt === delaysMs.length) break;
      await sleep(delaysMs[attempt]);
    }
  }
  lastError.userReason = RETRYABLE_STATUS.has(lastError?.status) ? lastError.status : "unknown";
  throw lastError;
}

export async function generateText({ system, prompt }) {
  const response = await callWithRetry(() =>
    getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: system },
    }),
  );
  return response.text ?? "";
}

export async function generateTextStream({ system, contents }) {
  return callWithRetry(() =>
    getClient().models.generateContentStream({
      model: MODEL,
      contents,
      config: { systemInstruction: system },
    }),
  );
}

// server.js가 사용자에게 보여줄 안내 문구를 고를 때 쓴다. "일시적 오류"와 "그 외"를 구분해서
// 뭉뚱그린 오류 메시지 대신 실제로 무슨 상황인지 알 수 있게 한다.
export function describeLlmError(error) {
  if (RETRYABLE_STATUS.has(error?.userReason)) {
    return "AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.";
  }
  return "답변 생성 중 오류가 발생했습니다.";
}

// 검색 그라운딩은 아직 켜지 않았다 (§0 참고). sources는 항상 빈 배열이며,
// 호출부(scenario.js/issues.js)는 이 사실을 알고 "검증된 출처 없음"으로 처리해야 한다.
export async function generateGroundedText({ system, prompt }) {
  const text = await generateText({ system, prompt });
  return { text, sources: [] };
}
