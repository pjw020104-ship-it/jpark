import { describe, it, expect, vi } from "vitest";
import { generateScenario } from "../backend/features/scenario.js";
import { analyzeGap } from "../backend/features/gapAnalysis.js";
import { getJobIssues } from "../backend/features/issues.js";
import { generateInterviewQuestions } from "../backend/features/interview.js";
import { filterActiveIssues } from "../backend/lib/dataStore.js";
import { redact } from "../backend/profile/redact.js";
import { containsForbiddenPattern } from "../backend/features/guard.js";
import { shouldShowActionMenu } from "../frontend/src/lib/actionTrigger.ts";

const EMPTY_ROLE = {
  id: "test.role",
  name_ko: "테스트 직무",
  common: {
    scenario_seeds: [],
    required_skills: [],
    preferred_skills: [],
    interview_themes: [],
    what_you_do: [],
  },
};

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
  it("scenario_seeds가 없는 직무에서 호출 시 state=fallback이고 생성된 시나리오 텍스트가 없다", async () => {
    const generate = vi.fn();
    const result = await generateScenario({ role: EMPTY_ROLE, generate });

    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("§4.2 이력서 기반 역량 갭 분석", () => {
  const ROLE_WITH_SKILLS = {
    id: "finance.treasury",
    name_ko: "재무",
    common: {
      required_skills: ["엑셀 재무모델링"],
      preferred_skills: ["CFA"],
    },
  };

  it("이력서/프로필이 없으면 state=needs_profile이다", async () => {
    const result = await analyzeGap({ role: ROLE_WITH_SKILLS, profileText: "" });
    expect(result.state).toBe("needs_profile");
  });

  it("응답에 숫자+% 패턴이나 '적합도', '합격 가능성' 문자열이 없다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        strengths: [{ skill: "엑셀 재무모델링", evidence: "적합도 78%로 매우 우수함" }],
        gaps: [{ skill: "CFA", how_to_improve: "합격 가능성을 높이려면 자격증을 취득하세요" }],
        missing: [],
      }),
    );

    const result = await analyzeGap({ role: ROLE_WITH_SKILLS, profileText: "경력 5년", generate });
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
      return JSON.stringify({ strengths: [], gaps: [], missing: [] });
    });

    await analyzeGap({ role: ROLE_WITH_SKILLS, profileText: rawResume, generate });

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

describe("§4.4 직무 이슈 분석", () => {
  it("expires_at이 지난 이슈는 제외된다", () => {
    const issues = [
      { id: "old", sources: [{ outlet: "A", date: "2024-01-01", url: "https://a" }], expires_at: "2024-01-01" },
      { id: "current", sources: [{ outlet: "B", date: "2026-01-01", url: "https://b" }], expires_at: "2099-01-01" },
    ];
    const active = filterActiveIssues(issues, new Date("2026-09-01"));
    expect(active.map((i) => i.id)).toEqual(["current"]);
  });

  it("sources가 빈 이슈는 제외된다", () => {
    const issues = [
      { id: "no-source", sources: [] },
      { id: "has-source", sources: [{ outlet: "B", date: "2026-01-01", url: "https://b" }] },
    ];
    const active = filterActiveIssues(issues, new Date("2026-09-01"));
    expect(active.map((i) => i.id)).toEqual(["has-source"]);
  });

  it("이슈 데이터가 없으면 state=fallback이다", () => {
    const result = getJobIssues({ companyId: "hanwha-aerospace", roleId: "rnd-design.general", loadIssues: () => [] });
    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
  });
});

describe("§4.3 면접 예상 질문", () => {
  it("역량 진단(2번) 미실행 상태에서도 정상 응답한다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        questions: [
          { question: "이 직무에 지원한 이유는?", why: "지원 동기 검증", direction: "경험을 시간순으로 나열", followup: "그 경험에서 무엇을 배웠나요?" },
        ],
      }),
    );

    const result = await generateInterviewQuestions({
      role: { name_ko: "재무", common: {} },
      gapAnalysis: null,
      issuesResult: null,
      generate,
    });

    expect(result.state).toBe("ok");
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.notice).toContain("먼저 역량 진단");
  });

  it("모든 질문 블록에 '예상 질문' 라벨이 있다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        questions: [
          { question: "Q1", why: "w1", direction: "d1", followup: "f1" },
          { question: "Q2", why: "w2", direction: "d2", followup: "f2" },
        ],
      }),
    );

    const result = await generateInterviewQuestions({
      role: { name_ko: "재무", common: {} },
      gapAnalysis: null,
      issuesResult: null,
      generate,
    });

    expect(result.blocks.every((b) => b.label === "[예상 질문]")).toBe(true);
  });
});
