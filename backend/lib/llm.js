import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.6-flash";
let ai;

function getClient() {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

export async function generateText({ system, prompt }) {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { systemInstruction: system },
  });
  return response.text ?? "";
}
