import { generateText } from "../llm.js";

// §4.1 직무 설명은 검색 그라운딩을 쓰지 않는다. 통상적인 JD 패턴을 설명하는 기능이라
// 실시간 뉴스가 필요 없고, 붙일 출처도 없다(출처가 필요한 건 §4.4 이슈 분석 쪽이다).
// 호출부 계약을 맞추려고 sources는 빈 배열로 돌려준다.
async function generateUngrounded(args) {
  return { text: await generateText(args), sources: [] };
}

const SYSTEM = `당신은 한화그룹 지원자에게 직무의 실제 업무를 설명하는 도우미입니다.
당신은 실시간 검색을 할 수 없으므로, 일반적으로 알려진 채용공고(JD) 패턴과 해당 직무의 통상적인 업무 방식을 바탕으로 쉽게 설명하세요.
특정 회사의 내부 정보를 아는 것처럼 단정하지 말고, 확실하지 않은 내용은 일반론으로 표현하세요.

아래 두 개의 마크다운 표만 작성하세요. 다른 설명 문장은 덧붙이지 마세요.

### 업무 Flow
| 단계 | 내용 |
|---|---|
| ... | ... |

### 하루 일과 업무 시나리오
| 시간대 | 업무 내용 |
|---|---|
| ... | ... |

지원자에게 답을 요구하거나 채점하는 형태로 쓰지 마세요. 관찰용 서술입니다.
"실제 사내 인터뷰"나 "이 회사만의 사례"인 것처럼 단정적으로 표현하지 말고, 해당 직군에서 통상적으로 알려진 업무 패턴을 기반으로 서술하세요.`;

export async function generateScenario({ role, companyName, apiKey, generate = generateUngrounded }) {
  const prompt = companyName ? `회사: ${companyName}\n직무: ${role.name_ko}` : `직무: ${role.name_ko}`;
  const { text, sources } = await generate({ system: SYSTEM, prompt, apiKey });

  if (!text || !text.trim()) {
    return {
      blocks: [],
      sources: [],
      state: "fallback",
      notice: "해당 직무의 상세 사례는 준비 중입니다.",
    };
  }

  return {
    blocks: [{ label: "직무 설명", content: text }],
    sources: sources ?? [],
    state: "ok",
  };
}
