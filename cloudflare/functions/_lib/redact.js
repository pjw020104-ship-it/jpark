const LABELED_LINE_DROP = /^\s*(생년월일|나이|출생연도|출생년도|성별|사진|주소|거주지|연락처|전화|휴대전화|휴대폰|이메일|email)\s*[:：]/i;
const LABELED_SCHOOL_LINE = /^\s*(학교|출신학교|대학교|대학)\s*[:：]\s*.*/i;

// 한글은 \w가 아니라서 뒤에 \b를 쓰면 "연세대학교 졸업"처럼 한글이 이어질 때 매칭이 실패했다.
// "학교:" 라벨이 없는 줄의 학교명이 그대로 새던 문제라 lookahead로 바꿨다.
const UNIVERSITY_NAME = /[가-힣A-Za-z]{1,12}\s?(대학교|대학원|대학|University)(?![가-힣A-Za-z])/g;
const BIRTH_DATE = /(19|20)\d{2}\s?[.\-/년]\s?\d{1,2}\s?[.\-/월]?\s?(\d{1,2}\s?일?)?\s?(생|출생)?/g;
const AGE = /\b(만\s?)?\d{1,2}\s?세\b/g;
const PHONE = /01[016789]-?\d{3,4}-?\d{4}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const GENDER_WORD = /\b(남성|여성|남자|여자)\b/g;
const ADDRESS_HINT = /[가-힣]{1,10}(시|도)\s?[가-힣]{1,10}(구|군)\s?[가-힣0-9]{1,15}(동|읍|면|로|길)[^\n,]*/g;

const CAREER_RANGE = /((?:19|20)\d{2})[.\-](\d{1,2})\s*[~\-–]\s*((?:19|20)\d{2})[.\-](\d{1,2})/g;

export function redact(text) {
  if (!text) return "";

  let result = String(text)
    .split("\n")
    .filter((line) => !LABELED_LINE_DROP.test(line))
    .map((line) => (LABELED_SCHOOL_LINE.test(line) ? "학교: [학교명 비공개]" : line))
    .join("\n");

  result = result
    .replace(CAREER_RANGE, (_m, y1) => `${y1}~${y1}년(연 단위만 유지)`)
    .replace(UNIVERSITY_NAME, "[학교명 비공개]")
    .replace(EMAIL, "[연락처 비공개]")
    .replace(PHONE, "[연락처 비공개]")
    .replace(ADDRESS_HINT, "[주소 비공개]")
    .replace(BIRTH_DATE, "[생년월일 비공개]")
    .replace(AGE, "[연령 비공개]")
    .replace(GENDER_WORD, "[성별 비공개]");

  return result;
}
