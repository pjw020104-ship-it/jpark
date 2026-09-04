// 포트폴리오 첨부의 가벼운 부분 — 타입·상수와 결과 조립.
// 파서(pdf.js, fflate)는 번들을 400KB 넘게 키우므로 extractFileText.ts로 분리해
// 사용자가 실제로 파일을 고른 순간에만 동적으로 불러온다.

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.pptx'] as const
export const MAX_FILE_BYTES = 15 * 1024 * 1024
export const MAX_CHARS_PER_FILE = 30_000

/** 파일 한 개에서 뽑아낸 텍스트. page는 PDF 쪽수 / PPTX 슬라이드 번호이며, DOCX는 쪽 개념이 없어 null이다. */
export type ExtractedPage = { page: number | null; text: string }

export type ExtractedFile = {
  fileName: string
  pages: ExtractedPage[]
  /** 길이 상한(MAX_CHARS_PER_FILE)에 걸려 뒷부분이 잘렸는지 */
  truncated: boolean
}

/** 사용자에게 그대로 보여줄 안내 문구를 담은 추출 실패 오류 (요구사항 8) */
export class ExtractError extends Error {}

/**
 * 추출한 파일들을 하나의 포트폴리오 텍스트로 합친다.
 * 근거를 파일명·페이지로 인용할 수 있도록 각 구간 앞에 출처 머리말을 붙인다 (요구사항 7).
 */
export function buildPortfolioText(files: ExtractedFile[], pastedText: string): string {
  const parts: string[] = []

  if (pastedText.trim()) {
    parts.push(`[출처: 직접 입력]\n${pastedText.trim()}`)
  }

  for (const file of files) {
    for (const page of file.pages) {
      const where = page.page === null ? `[출처: ${file.fileName}]` : `[출처: ${file.fileName} p.${page.page}]`
      parts.push(`${where}\n${page.text}`)
    }
    if (file.truncated) {
      parts.push(`[안내] ${file.fileName}은 분량이 많아 앞부분만 사용했습니다.`)
    }
  }

  return parts.join('\n\n')
}
