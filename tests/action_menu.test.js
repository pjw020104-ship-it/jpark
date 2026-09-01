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

  it("이슈 데이터가 없으면 state=fallback이고 안내 문구에 회사/직무명이 들어간다", () => {
    const result = getJobIssues({
      companyId: "hanwha-aerospace",
      companyName: "한화에어로스페이스",
      roleId: "rnd-design.general",
      roleName: "R&D/설계",
      loadIssues: () => [],
    });
    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
    expect(result.notice).toContain("한화에어로스페이스");
    expect(result.notice).toContain("R&D/설계");
  });

  it("회사 이슈와 직무 이슈를 구분해서 반환한다", () => {
    const result = getJobIssues({
      companyId: "hanwha-aerospace",
      companyName: "한화에어로스페이스",
      roleId: "rnd-design.general",
      roleName: "R&D/설계",
      loadIssues: () => [
        { headline: "회사 전체 이슈", background: "b", work_impact: "w", interview_angle: "i", sources: [{ outlet: "A", date: "2026-01-01", url: "https://a" }] },
        {
          headline: "직무 관련 이슈",
          background: "b2",
          work_impact: "w2",
          interview_angle: "i2",
          applies_to_roles: ["rnd-design.general"],
          sources: [{ outlet: "B", date: "2026-01-01", url: "https://b" }],
        },
      ],
    });
    const labels = result.blocks.map((b) => b.label);
    expect(labels).toContain("[회사 이슈]");
    expect(labels).toContain("[직무 이슈]");
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
