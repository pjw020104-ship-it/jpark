// Cloudflare Workers 런타임에는 Node 전용 API가 없다. @google/genai SDK 대신
// Gemini REST API를 fetch로 직접 호출한다 (SDK가 내부적으로 하는 일과 동일).
const MODEL = "gemini-3.6-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
const RETRY_DELAYS_MS = [1000, 3000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini가 순간적으로 과부하거나(429/503) 일시적으로 실패할 때(500/502) 잠깐 기다리면 성공하는 경우가 많다.
// 재시도를 다 소진해도 실패하면 원본 에러에 사용자용 안내 코드를 붙여서 그대로 던진다 -
// 호출부(functions/api/*.js)가 이 코드로 "일시적 오류"와 "그 외 오류"를 구분해 다른 메시지를 보여줄 수 있게 한다.
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

async function callGemini(path, body, apiKey) {
  let response;
  try {
    response = await fetch(`${API_BASE}/models/${MODEL}:${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    error.status = 503;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Gemini 요청 실패: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response;
}

export async function generateText({ system, prompt, apiKey }) {
  const response = await callWithRetry(() =>
    callGemini(
      "generateContent",
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
      },
      apiKey,
    ),
  );
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
}

// server.js(Node) 시절과 같은 {role, parts} contents 배열을 그대로 받는다.
export async function generateTextStream({ system, contents, apiKey }) {
  const response = await callWithRetry(() =>
    callGemini(
      "streamGenerateContent?alt=sse",
      { contents, systemInstruction: { parts: [{ text: system }] } },
      apiKey,
    ),
  );

  return (async function* () {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Gemini의 SSE 스트림은 줄바꿈으로 \r\n을 쓴다 - \n\n 기준 파싱 전에 \n으로 정규화한다.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let sepIndex;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const line = event.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const jsonText = line.slice("data:".length).trim();
        if (!jsonText) continue;
        const parsed = JSON.parse(jsonText);
        const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text).join("");
        if (text) yield { text };
      }
    }
  })();
}

// functions/api/*.js가 사용자에게 보여줄 안내 문구를 고를 때 쓴다. "일시적 오류"와 "그 외"를 구분해서
// 뭉뚱그린 오류 메시지 대신 실제로 무슨 상황인지 알 수 있게 한다.
export function describeLlmError(error) {
  if (RETRYABLE_STATUS.has(error?.userReason)) {
    return "AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.";
  }
  return "답변 생성 중 오류가 발생했습니다.";
}

// 검색 그라운딩은 아직 켜지 않았다. sources는 항상 빈 배열이며,
// 호출부(scenario.js/issues.js)는 이 사실을 알고 "검증된 출처 없음"으로 처리해야 한다.
export async function generateGroundedText({ system, prompt, apiKey }) {
  const text = await generateText({ system, prompt, apiKey });
  return { text, sources: [] };
}
