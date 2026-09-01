import { generateText } from "../lib/llm.js";

const SYSTEM = `당신은 한화그룹 지원자에게 직무의 실제 업무 상황을 설명하는 도우미입니다.
반드시 주어진 시나리오 시드(trigger/your_move/skill_used)에 근거해서만 서술하고,
시드에 없는 사실을 새로 지어내지 마세요.

아래 고정 포맷을 정확히 따라 작성하세요.

[상황]  (한두 문장)
[당신이 하는 일]
  1. ...
  2. ...
[이때 쓰이는 역량]  (역량들을 / 로 구분)
[어려운 점]  (반드시 포함 — 미화하지 말고 실제로 어려운 지점을 서술)

지원자에게 답을 요구하거나 채점하는 형태로 쓰지 마세요. 관찰용 서술입니다.`;

export async function generateScenario({ role, generate = generateText }) {
  const seeds = role?.common?.scenario_seeds ?? [];

  if (seeds.length === 0) {
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: "해당 직무의 상세 사례는 준비 중입니다",
    };
  }

  const basicPrompt = `직무: ${role.name_ko}\n난이도: 기본(신입 1년차가 맡는 일)\n시나리오 시드:\n${JSON.stringify(seeds, null, 2)}`;
  const advancedPrompt = `직무: ${role.name_ko}\n난이도: 심화(3년차 이후)\n시나리오 시드:\n${JSON.stringify(seeds, null, 2)}`;

  const [basic, advanced] = await Promise.all([
    generate({ system: SYSTEM, prompt: basicPrompt }),
    generate({ system: SYSTEM, prompt: advancedPrompt }),
  ]);

  return {
    blocks: [
      { label: "기본 (신입 1년차)", content: basic },
      { label: "심화 (3년차 이후)", content: advanced },
    ],
    sources: [],
    state: "ok",
  };
}
