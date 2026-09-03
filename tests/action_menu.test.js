import { describe, it, expect, vi } from "vitest";
import { generateScenario } from "../backend/features/scenario.js";
import { analyzeGap } from "../backend/features/gapAnalysis.js";
import { getJobIssues } from "../backend/features/issues.js";
import { generateInterviewQuestions } from "../backend/features/interview.js";
import { redact } from "../backend/profile/redact.js";
import { containsForbiddenPattern } from "../backend/features/guard.js";
import { shouldShowActionMenu } from "../frontend/src/lib/actionTrigger.ts";
import { callWithRetry, describeLlmError } from "../backend/lib/llm.js";

function apiError(status) {
  const err = new Error(`status ${status}`);
  err.status = status;
  return err;
}

describe("§4.5 버튼 노출 트리거", () => {
  it("company_id 또는 position_id 누락 시 버튼이 노출되지 않는다", () => {
    expect(shouldShowActionMenu(null, "role.a")).toBe(false);
    expect(shouldShowActionMenu("company.a", null)).toBe(false);
    expect(shouldShowActionMenu(undefined, undefined)).toBe(false);
  });

  it("둘 다 확정되면 버튼이 노출된다", () => {
    expect(shouldShowActionMenu("company.a", "role.a")).toBe(true);
  });
});

describe("§4.1 직무 설명 (scenario)", () => {
  it("검색 그라운딩 결과로 시나리오와 출처를 생성한다", async () => {
    const generate = vi.fn().mockResolvedValue({
      text: "### 업무 Flow\n| 단계 | 내용 |\n|---|---|\n| 1 | 자금 계획 수립 |",
      sources: [{ outlet: "한화 채용 홈페이지", url: "https://example.com/jd" }],
    });

    const result = await generateScenario({ role: { name_ko: "재무" }, companyName: "한화솔루션", generate });

    expect(result.state).toBe("ok");
    expect(result.blocks).toHaveLength(1);
    expect(result.sources).toEqual([{ outlet: "한화 채용 홈페이지", url: "https://example.com/jd" }]);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("한화솔루션") }));
  });

  it("검색 결과 텍스트가 비어 있으면 state=fallback이다", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "", sources: [] });
    const result = await generateScenario({ role: { name_ko: "재무" }, generate });

    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
  });
});

describe("§4.2 역량 진단 (gap analysis)", () => {
  const ROLE = { id: "finance.treasury", name_ko: "재무" };

  it("자기소개서가 없으면 state=needs_profile이다", async () => {
    const result = await analyzeGap({ role: ROLE, coverLetterText: "" });
    expect(result.state).toBe("needs_profile");
  });

  it("응답에 숫자+% 패턴이나 '적합도', '합격 가능성' 문자열이 없다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        experiences: [],
        strengths: [
          {
            skill: "엑셀 재무모델링",
            evidence_experience: "인턴 경험",
            requirement_link: "적합도 78%로 매우 우수함",
            resume_expression: "합격 가능성을 높이려면 이렇게 쓰세요",
          },
        ],
        gaps: [],
        hidden_strengths: [],
      }),
    );

    const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });
    const joined = result.blocks.map((b) => b.content).join("\n");

    expect(containsForbiddenPattern(joined)).toBe(false);
  });

  it("redact를 거치지 않은 원문이 LLM 호출 인자에 포함되면 실패한다", async () => {
    const rawResume = [
      "학교: 서울대학교",
      "생년월일: 1999-03-02",
      "성별: 남",
      "주소: 서울시 강남구 테헤란로 123",
      "연락처: 010-1234-5678",
      "경력: 2020.01 ~ 2023.05 재무팀 인턴",
    ].join("\n");

    let capturedPrompt = "";
    const generate = vi.fn().mockImplementation(async ({ prompt }) => {
      capturedPrompt = prompt;
      return JSON.stringify({ experiences: [], strengths: [], gaps: [], hidden_strengths: [] });
    });

    await analyzeGap({ role: ROLE, coverLetterText: rawResume, generate });

    expect(capturedPrompt).not.toContain("서울대학교");
    expect(capturedPrompt).not.toContain("1999-03-02");
    expect(capturedPrompt).not.toContain("010-1234-5678");
    expect(capturedPrompt).not.toContain("서울시 강남구 테헤란로 123");
  });
});

describe("redact()", () => {
  it("학교명/생년월일/연락처/주소가 결과 문자열에 남지 않는다", () => {
    const result = redact("학교: 서울대학교\n연락처: 010-9999-8888\n주소: 서울시 강남구 테헤란로 1\n생년월일: 1998-01-01");
    expect(result).not.toContain("서울대학교");
    expect(result).not.toContain("010-9999-8888");
    expect(result).not.toContain("강남구 테헤란로 1");
    expect(result).not.toContain("1998-01-01");
  });
});

describe("§4.4 직무 이슈 분석 (검색 그라운딩 없음)", () => {
  it("insufficient 플래그가 true면 fallback이고 회사/직무명이 안내에 포함된다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({ insufficient: true, company_issues: [], job_issues: [] }),
    );

    const result = await getJobIssues({ companyName: "한화에어로스페이스", roleName: "R&D/설계", generate });

    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
    expect(result.notice).toContain("한화에어로스페이스");
    expect(result.notice).toContain("R&D/설계");
  });

  it("headline/background/work_impact 중 하나라도 비어 있으면 그 이슈는 제외된다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        insufficient: false,
        company_issues: [{ headline: "", background: "b", work_impact: "w", interview_angle: "i" }],
        job_issues: [],
      }),
    );

    const result = await getJobIssues({ companyName: "한화에어로스페이스", roleName: "R&D/설계", generate });
    expect(result.state).toBe("fallback");
  });

  it("완전한 이슈가 있으면 회사/직무로 구분해서 반환하고, 검색 그라운딩이 없다는 안내를 포함한다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        insufficient: false,
        company_issues: [{ headline: "회사 전체 이슈", background: "b", work_impact: "w", interview_angle: "i" }],
        job_issues: [{ headline: "직무 관련 이슈", background: "b2", work_impact: "w2", interview_angle: "i2" }],
      }),
    );

    const result = await getJobIssues({ companyName: "한화에어로스페이스", roleName: "R&D/설계", generate });

    const labels = result.blocks.map((b) => b.label);
    expect(labels).toContain("[회사 이슈]");
    expect(labels).toContain("[직무 이슈]");
    expect(labels).toContain("[안내]");
    expect(labels).not.toContain("[이슈]"); // 헤드라인은 [회사 이슈]/[직무 이슈] 라벨에 합쳐져야 하고 별도 [이슈] 라벨이 중복되면 안 된다
    expect(result.sources).toHaveLength(0);
  });
});

describe("§4.3 면접 예상 질문", () => {
  it("자기소개서 없이(2번 미실행) 호출해도 정상 응답한다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        jd_questions: [{ question: "이 직무에 지원한 이유는?", basis: "지원 동기 및 직무 이해 검증" }],
        personal_questions: [],
      }),
    );

    const result = await generateInterviewQuestions({
      role: { name_ko: "재무", common: {} },
      coverLetterText: null,
      generate,
    });

    expect(result.state).toBe("ok");
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.notice).toContain("자기소개서");
  });

  it("모든 질문 블록에 '예상 질문' 라벨이 있다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        jd_questions: [{ question: "Q1", basis: "b1" }],
        personal_questions: [{ question: "Q2", basis: "b2" }],
      }),
    );

    const result = await generateInterviewQuestions({
      role: { name_ko: "재무", common: {} },
      coverLetterText: "전공: 재무, 인턴 경험 있음",
      generate,
    });

    expect(result.blocks.every((b) => b.label.includes("예상 질문"))).toBe(true);
  });
});

describe("Gemini 호출 재시도 및 오류 안내 (llm.js)", () => {
  it("503처럼 일시적인 오류는 재시도 후 성공하면 값을 반환한다", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce("ok");

    const result = await callWithRetry(fn, [0, 0]);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("재시도를 모두 소진하면 userReason이 붙은 원본 에러를 던진다", async () => {
    const fn = vi.fn().mockRejectedValue(apiError(429));

    await expect(callWithRetry(fn, [0, 0])).rejects.toMatchObject({ status: 429, userReason: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("재시도 대상이 아닌 오류(예: 400)는 즉시 던지고 재시도하지 않는다", async () => {
    const fn = vi.fn().mockRejectedValue(apiError(400));

    await expect(callWithRetry(fn, [0, 0])).rejects.toMatchObject({ status: 400, userReason: "unknown" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("일시적 오류(재시도 대상 상태코드)와 그 외 오류에 서로 다른 안내 문구를 반환한다", () => {
    const transient = describeLlmError({ userReason: 503 });
    const unknown = describeLlmError({ userReason: "unknown" });

    expect(transient).not.toBe(unknown);
    expect(transient).toContain("일시적");
  });
});
