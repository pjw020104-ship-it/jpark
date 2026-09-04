import { describe, it, expect, vi } from "vitest";
import { generateScenario } from "../backend/features/scenario.js";
import { analyzeGap } from "../backend/features/gapAnalysis.js";
import { getJobIssues } from "../backend/features/issues.js";
import { recommendRoles, shouldRecommendInstead, buildCatalog } from "../backend/features/recommend.js";
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

  it("응답에 숫자+% 패턴이나 '합격 가능성' 문자열이 없다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        fit_score: 62,
        strengths: [
          {
            title: "엑셀 재무모델링",
            evidence: "인턴 경험",
            requirement_link: "78%로 매우 우수함",
            source: "자기소개서",
          },
        ],
        gaps: [{ title: "합격 가능성을 높이려면 이렇게 쓰세요", why: "", how_to_fill: "" }],
      }),
    );

    const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });
    const joined = result.blocks.map((b) => b.content).join("\n");

    expect(containsForbiddenPattern(joined)).toBe(false);
  });

  it("적합도 점수는 5점 단위로 스냅되고, 범위를 벗어나면 아예 표시하지 않는다", async () => {
    const withScore = (value) =>
      vi.fn().mockResolvedValue(JSON.stringify({ fit_score: value, strengths: [], gaps: [] }));

    // 같은 자료를 다시 제출했을 때 62/64처럼 미세하게 흔들리는 값이 다른 판정으로 보이면 안 된다
    for (const [given, expected] of [
      [73, 75],
      [62, 60],
      [64, 65],
      [60, 60],
      [0, 0],
      [100, 100],
    ]) {
      const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate: withScore(given) });
      expect(result.fit.score).toBe(expected);
    }

    for (const bad of [120, -5, "높음", null]) {
      const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate: withScore(bad) });
      expect(result.fit).toBeUndefined();
    }
  });

  it("점수는 모델이 부른 숫자가 아니라 핵심 역량 판정에서 계산한다", async () => {
    // 충분(2) + 보통(1) + 확인 불가(0) + 부족(0) = 3 / 8 = 37.5 -> 5점 단위 반올림 40
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        fit_score: 90, // 모델이 엉뚱하게 높게 불러도 무시돼야 한다
        core_competencies: [
          { competency: "A", level: "충분" },
          { competency: "B", level: "보통" },
          { competency: "C", level: "확인 불가" },
          { competency: "D", level: "부족" },
        ],
      }),
    );

    const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });
    expect(result.fit.score).toBe(40);
  });

  it("역량 등급을 읽을 수 없으면 모델이 준 점수로 넘어간다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({ fit_score: 71, core_competencies: [{ competency: "A", level: "매우 좋음" }] }),
    );

    const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });
    expect(result.fit.score).toBe(70);
  });

  it("같은 자료를 넣으면 temperature 0으로 호출한다", async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ fit_score: 50 }));
    await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });
    expect(generate.mock.calls[0][0].temperature).toBe(0);
  });

  it("요구사항 6의 다섯 항목을 모두 블록으로 낸다", async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ fit_score: 50 }));
    const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });

    expect(result.blocks.map((b) => b.label)).toEqual([
      "[주요 강점]",
      "[부족하거나 확인되지 않는 역량]",
      "[직무별 핵심 역량 평가]",
      "[자기소개서에서 강조할 경험]",
      "[면접에서 활용할 경험 및 예상 질문]",
    ]);
  });

  it("첨부 파일에서 찾은 근거는 파일명·페이지와 함께 표시된다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        fit_score: 70,
        strengths: [{ title: "데이터 파이프라인 구축", evidence: "ETL 설계", source: "포트폴리오.pdf p.4" }],
      }),
    );

    const result = await analyzeGap({
      role: ROLE,
      companyName: "한화시스템",
      coverLetterText: "경력 5년",
      portfolioText: "[출처: 포트폴리오.pdf p.4]\nETL 파이프라인을 설계했다",
      portfolioFileNames: ["포트폴리오.pdf"],
      generate,
    });

    const strengths = result.blocks.find((b) => b.label === "[주요 강점]");
    expect(strengths.content).toContain("포트폴리오.pdf p.4");

    // 회사명과 첨부 파일명이 프롬프트에 실려야 §4.2가 회사·직무 기준으로 진단할 수 있다
    const prompt = generate.mock.calls[0][0].prompt;
    expect(prompt).toContain("한화시스템");
    expect(prompt).toContain("포트폴리오.pdf");
  });

  it("모델 응답이 JSON이 아니면 state=fallback이고 블록을 만들지 않는다", async () => {
    const generate = vi.fn().mockResolvedValue("죄송합니다, 답변할 수 없습니다.");
    const result = await analyzeGap({ role: ROLE, coverLetterText: "경력 5년", generate });

    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
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
      return JSON.stringify({ fit_score: 40, strengths: [], gaps: [] });
    });

    await analyzeGap({ role: ROLE, coverLetterText: rawResume, generate });

    expect(capturedPrompt).not.toContain("서울대학교");
    expect(capturedPrompt).not.toContain("1999-03-02");
    expect(capturedPrompt).not.toContain("010-1234-5678");
    expect(capturedPrompt).not.toContain("서울시 강남구 테헤란로 123");
  });

  it("첨부 파일에서 추출한 텍스트도 마스킹을 거쳐 LLM에 전달된다", async () => {
    let capturedPrompt = "";
    const generate = vi.fn().mockImplementation(async ({ prompt }) => {
      capturedPrompt = prompt;
      return JSON.stringify({ fit_score: 40, strengths: [], gaps: [] });
    });

    await analyzeGap({
      role: ROLE,
      coverLetterText: "재무팀 인턴 경험",
      portfolioText: "[출처: 이력서.pdf p.1]\n연세대학교 졸업\n연락처: 010-1234-5678",
      portfolioFileNames: ["이력서.pdf"],
      generate,
    });

    expect(capturedPrompt).not.toContain("연세대학교");
    expect(capturedPrompt).not.toContain("010-1234-5678");
    expect(capturedPrompt).toContain("이력서.pdf p.1"); // 출처 머리말은 인용을 위해 남아야 한다
  });
});

describe("§4.2 확장: 적합도가 낮으면 다른 직무를 추천", () => {
  const CATALOG = [
    { company_id: "c1", company_name: "한화건설", position_id: "c1.job1", position_name: "건축" },
    { company_id: "c2", company_name: "한화투자증권", position_id: "c2.job1", position_name: "IB" },
    { company_id: "c2", company_name: "한화투자증권", position_id: "c2.job2", position_name: "법인영업" },
  ];

  it("80점 미만일 때만 추천으로 넘어간다", () => {
    expect(shouldRecommendInstead({ score: 75 })).toBe(true);
    expect(shouldRecommendInstead({ score: 79 })).toBe(true);
    expect(shouldRecommendInstead({ score: 80 })).toBe(false);
    expect(shouldRecommendInstead({ score: 95 })).toBe(false);
    expect(shouldRecommendInstead(undefined)).toBe(false);
  });

  it("목록에 있는 직무만 추천으로 내보낸다", async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        recommendations: [
          { position_id: "c2.job1", reason: "경영학 전공과 재무 분석 경험" },
          { position_id: "없는.직무", reason: "지어낸 값" },
          { position_id: "c2.job2", reason: "영업 인턴 경험" },
        ],
      }),
    );

    const result = await recommendRoles({
      coverLetterText: "경영학과 졸업, 재무 분석 인턴",
      excludePositionId: "c1.job1",
      catalog: CATALOG,
      generate,
    });

    expect(result.map((r) => r.position_id)).toEqual(["c2.job1", "c2.job2"]);
    expect(result[0].company_name).toBe("한화투자증권");
    expect(result[0].reason).toContain("경영학");
  });

  it("지금 보고 있던 직무는 후보에서 제외한다", async () => {
    let captured = "";
    const generate = vi.fn().mockImplementation(async ({ prompt }) => {
      captured = prompt;
      return JSON.stringify({ recommendations: [] });
    });

    await recommendRoles({
      coverLetterText: "경영학과 졸업",
      excludePositionId: "c1.job1",
      catalog: CATALOG,
      generate,
    });

    expect(captured).not.toContain("c1.job1");
    expect(captured).toContain("c2.job1");
  });

  it("추천 자료도 마스킹을 거쳐 LLM에 전달된다", async () => {
    let captured = "";
    const generate = vi.fn().mockImplementation(async ({ prompt }) => {
      captured = prompt;
      return JSON.stringify({ recommendations: [] });
    });

    await recommendRoles({
      coverLetterText: "연세대학교 경영학과 졸업\n연락처: 010-1234-5678",
      catalog: CATALOG,
      generate,
    });

    expect(captured).not.toContain("연세대학교");
    expect(captured).not.toContain("010-1234-5678");
  });

  it("실제 데이터로 만든 목록은 회사명과 직무명이 모두 채워진다", () => {
    const catalog = buildCatalog();
    expect(catalog.length).toBeGreaterThan(50);
    expect(catalog.every((c) => c.company_name && c.position_name && c.position_id)).toBe(true);
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

describe("§4.4 직무 이슈 분석 (Google 검색 그라운딩)", () => {
  const NEWS_SOURCES = [
    { outlet: "yna.co.kr", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa" },
    { outlet: "chosun.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb" },
  ];

  // 1단계(검색)는 자유 서술 + 출처, 2단계(구조화)는 JSON 문자열을 돌려준다.
  const research = (sources = NEWS_SOURCES, text = "조사 결과 본문") => vi.fn().mockResolvedValue({ text, sources });
  const structure = (payload) => vi.fn().mockResolvedValue(JSON.stringify(payload));

  const ARGS = { companyName: "한화에어로스페이스", roleName: "R&D/설계" };

  it("검색을 먼저 하고, 그 결과만 2단계 구조화 프롬프트에 넘긴다", async () => {
    const doResearch = research(NEWS_SOURCES, "연합뉴스 2026-08-30 보도: 수출 계약 체결");
    const doStructure = structure({
      insufficient: false,
      company_issues: [{ headline: "h", background: "b", work_impact: "w", interview_angle: "i" }],
      job_issues: [],
    });

    await getJobIssues({ ...ARGS, research: doResearch, structure: doStructure });

    expect(doResearch).toHaveBeenCalledTimes(1);
    // 2단계는 검색 결과 텍스트만 받는다 - 여기서 새 사실이 끼어들 자리가 없어야 한다
    expect(doStructure.mock.calls[0][0].prompt).toBe("연합뉴스 2026-08-30 보도: 수출 계약 체결");
  });

  it("그라운딩 출처가 하나도 없으면 검색이 안 된 것이므로 구조화하지 않고 fallback이다", async () => {
    const doStructure = structure({ insufficient: false, company_issues: [], job_issues: [] });

    const result = await getJobIssues({ ...ARGS, research: research([]), structure: doStructure });

    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
    expect(result.notice).toContain("검색하지 못했습니다");
    expect(doStructure).not.toHaveBeenCalled(); // 근거 없는 2차 호출로 돈을 쓰지 않는다
  });

  it("insufficient 플래그가 true면 fallback이고 회사/직무명이 안내에 포함된다", async () => {
    const result = await getJobIssues({
      ...ARGS,
      research: research(),
      structure: structure({ insufficient: true, company_issues: [], job_issues: [] }),
    });

    expect(result.state).toBe("fallback");
    expect(result.blocks).toHaveLength(0);
    expect(result.notice).toContain("한화에어로스페이스");
    expect(result.notice).toContain("R&D/설계");
  });

  it("headline/background/work_impact 중 하나라도 비어 있으면 그 이슈는 제외된다", async () => {
    const result = await getJobIssues({
      ...ARGS,
      research: research(),
      structure: structure({
        insufficient: false,
        company_issues: [{ headline: "", background: "b", work_impact: "w", interview_angle: "i" }],
        job_issues: [],
      }),
    });

    expect(result.state).toBe("fallback");
  });

  it("완전한 이슈가 있으면 회사/직무로 구분해 반환하고 검색 출처 URL을 함께 낸다", async () => {
    const result = await getJobIssues({
      ...ARGS,
      research: research(),
      structure: structure({
        insufficient: false,
        company_issues: [
          {
            headline: "회사 전체 이슈",
            outlet: "연합뉴스",
            published_at: "2026-08-30",
            background: "b",
            work_impact: "w",
            interview_angle: "i",
          },
        ],
        job_issues: [{ headline: "직무 관련 이슈", background: "b2", work_impact: "w2", interview_angle: "i2" }],
      }),
    });

    // 이슈 하나가 블록 하나다. 배경/실무 영향/면접 관점이 별도 블록으로 흩어지면 안 된다.
    expect(result.blocks.map((b) => b.label)).toEqual(["[안내]", "1. 회사 이슈", "1. 직무 이슈"]);

    const companyIssue = result.blocks[1];
    expect(companyIssue.content).toContain("**회사 전체 이슈**");
    expect(companyIssue.content).toContain("_연합뉴스 · 2026-08-30_");
    expect(companyIssue.content).toContain("- **배경** — b");
    expect(companyIssue.content).toContain("- **실무 영향** — w");
    expect(companyIssue.content).toContain("- **면접 관점** — i");

    // 출처 URL은 모델 본문이 아니라 그라운딩 메타데이터에서 온 것만 나간다
    expect(result.sources).toEqual(NEWS_SOURCES);
  });

  it("매체·보도일자를 확인하지 못한 이슈에는 보도 줄을 붙이지 않는다", async () => {
    const result = await getJobIssues({
      ...ARGS,
      research: research(),
      structure: structure({
        insufficient: false,
        company_issues: [
          { headline: "h", outlet: "확인 안 됨", published_at: "", background: "b", work_impact: "w", interview_angle: "i" },
        ],
        job_issues: [],
      }),
    });

    expect(result.blocks[1].content).not.toContain("확인 안 됨");
    // 보도 줄이 빠지면 헤드라인 바로 다음이 빈 줄이어야 한다
    expect(result.blocks[1].content.split("\n")[1]).toBe("");
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
