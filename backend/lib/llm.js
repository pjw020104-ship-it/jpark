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

// temperature를 넘기면 그 값으로 고정한다. 같은 입력에 같은 답이 나와야 하는 기능
// (§4.2 역량 진단 점수)에서 0을 넘겨 쓴다. 넘기지 않으면 Gemini 기본값(1.0)이다.
export async function generateText({ system, prompt, temperature }) {
  const response = await callWithRetry(() =>
    getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: system, ...(temperature === undefined ? {} : { temperature }) },
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

/**
 * 같은 기사가 여러 chunk로 중복되어 오는 경우가 많아 URL 기준으로 한 번만 남긴다.
 * title은 보통 도메인(예: "yna.co.kr")이라 그대로 매체명으로 쓴다.
 */
function toSources(groundingMetadata) {
  const seen = new Set();
  const sources = [];

  for (const chunk of groundingMetadata?.groundingChunks ?? []) {
    const web = chunk?.web;
    if (!web?.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({ outlet: web.title ?? web.domain ?? "", url: web.uri });
  }

  return sources;
}

/**
 * Google 검색 그라운딩을 켠 채로 호출한다. 모델이 실제로 검색한 웹 문서가
 * groundingMetadata.groundingChunks로 돌아오며, 이게 사용자에게 보여줄 유일한 출처다.
 * 모델이 본문에 직접 쓴 URL은 지어낸 것일 수 있으므로 절대 출처로 쓰지 않는다.
 *
 * 주의: 검색이 실제로 일어나지 않으면 chunks가 비어서 돌아온다(모델이 검색 없이 답한 경우).
 * 호출부는 sources가 비었을 때 "검증된 출처 없음"으로 처리해야 한다.
 */
export async function generateGroundedText({ system, prompt }) {
  const response = await callWithRetry(() =>
    getClient().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: system, tools: [{ googleSearch: {} }] },
    }),
  );

  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

  return {
    text: response.text ?? "",
    sources: toSources(groundingMetadata),
    searchQueries: groundingMetadata?.webSearchQueries ?? [],
  };
}
