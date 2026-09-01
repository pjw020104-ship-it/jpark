import { generateText } from "../lib/llm.js";

const SYSTEM = `당신은 한화그룹 지원자에게 직무의 실제 업무를 설명하는 도우미입니다.
반드시 주어진 시나리오 시드(trigger/your_move/skill_used)에 근거해서만 서술하고,
시드에 없는 사실을 새로 지어내지 마세요. 정확히 알 수 없는 내용은 추측해서 답변하지 마세요.

아래 두 개의 마크다운 표를 작성하세요.

### 업무 Flow
| 단계 | 내용 |
|---|---|
| ... | ... |

### 하루 일과 업무 시나리오
| 시간대 | 업무 내용 |
|---|---|
| ... | ... |

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

  const prompt = `직무: ${role.name_ko}\n시나리오 시드:\n${JSON.stringify(seeds, null, 2)}`;
  const text = await generate({ system: SYSTEM, prompt });

  return {
    blocks: [{ label: "[직무 설명]", content: text }],
    sources: [],
    state: "ok",
  };
}
