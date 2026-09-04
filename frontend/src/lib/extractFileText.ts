import { unzipSync, strFromU8 } from 'fflate'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ACCEPTED_EXTENSIONS,
  ExtractError,
  MAX_CHARS_PER_FILE,
  MAX_FILE_BYTES,
  type ExtractedFile,
  type ExtractedPage,
} from './portfolio'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// SPEC §6: 자기소개서·포트폴리오는 "수집 최소화"가 아니라 "수집 회피"가 원칙이다.
// 그래서 파일 자체는 서버로 올리지 않고 브라우저에서 텍스트만 뽑아 보낸다.
// 원본 파일은 사용자 PC를 벗어나지 않고, 서버는 마스킹 대상 텍스트만 받는다.
//
// 이 모듈은 pdf.js와 fflate를 끌어오므로 크다. ActionMenu에서 파일을 고른 순간에만
// 동적 import로 불러온다 — 첨부를 쓰지 않는 사용자는 내려받지 않는다.

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

/** XML 태그를 걷어내고 텍스트만 남긴다. 문단 태그는 개행으로 바꾼다. */
function xmlToText(xml: string, paragraphTags: string[]): string {
  let out = xml
  for (const tag of paragraphTags) {
    out = out.replace(new RegExp(`</${tag}>`, 'g'), '\n')
  }
  return out
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 빈 줄과 중복 공백을 정리한다. LLM 프롬프트에 들어갈 분량을 줄이는 목적도 있다. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

async function extractPdf(file: File): Promise<ExtractedPage[]> {
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  const doc = await loadingTask.promise
  const pages: ExtractedPage[] = []

  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = tidy(
        content.items
          .map((item) => ('str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : ''))
          .join(''),
      )
      page.cleanup()
      if (text) pages.push({ page: n, text })
    }
  } finally {
    // 워커에 잡힌 메모리를 놓아준다. 여러 파일을 연달아 첨부해도 쌓이지 않게.
    await loadingTask.destroy()
  }

  return pages
}

/** OOXML(docx/pptx)은 zip 컨테이너다. 필요한 XML 파트만 풀어서 텍스트를 뽑는다. */
async function unzipEntries(file: File): Promise<Record<string, Uint8Array>> {
  const buffer = await file.arrayBuffer()
  return unzipSync(new Uint8Array(buffer))
}

async function extractDocx(file: File): Promise<ExtractedPage[]> {
  const entries = await unzipEntries(file)
  const body = entries['word/document.xml']
  if (!body) throw new ExtractError('DOCX 구조를 읽을 수 없습니다 (word/document.xml 없음).')

  // <w:p>가 문단, <w:br>이 줄바꿈. DOCX 파일에는 쪽 나눔 정보가 없어 페이지 번호를 붙이지 않는다.
  const text = tidy(xmlToText(strFromU8(body).replace(/<w:br\s*\/?>/g, '\n'), ['w:p']))
  return text ? [{ page: null, text }] : []
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
}

async function extractPptx(file: File): Promise<ExtractedPage[]> {
  const entries = await unzipEntries(file)
  const slidePaths = Object.keys(entries)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b))

  if (slidePaths.length === 0) throw new ExtractError('PPTX에서 슬라이드를 찾을 수 없습니다.')

  const pages: ExtractedPage[] = []
  for (const path of slidePaths) {
    // <a:p>가 문단, <a:br>이 줄바꿈. 슬라이드 번호를 그대로 페이지 번호로 쓴다.
    const text = tidy(xmlToText(strFromU8(entries[path]).replace(/<a:br\s*\/?>/g, '\n'), ['a:p']))
    if (text) pages.push({ page: slideNumber(path), text })
  }
  return pages
}

/**
 * 첨부 파일에서 텍스트를 추출한다.
 * 읽을 수 없으면 사용자에게 보여줄 문구를 담은 ExtractError를 던진다 (요구사항 8).
 */
export async function extractFileText(file: File): Promise<ExtractedFile> {
  const ext = extensionOf(file.name)

  if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
    throw new ExtractError('지원하지 않는 형식입니다. PDF, DOCX, PPTX만 첨부할 수 있습니다.')
  }
  if (file.size === 0) {
    throw new ExtractError('빈 파일입니다.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractError(`파일이 너무 큽니다 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).`)
  }

  let pages: ExtractedPage[]
  try {
    if (ext === '.pdf') pages = await extractPdf(file)
    else if (ext === '.docx') pages = await extractDocx(file)
    else pages = await extractPptx(file)
  } catch (error) {
    if (error instanceof ExtractError) throw error
    throw new ExtractError(
      '파일을 읽지 못했습니다. 손상되었거나 암호가 걸린 파일일 수 있습니다. 내용을 텍스트로 붙여넣어 주세요.',
    )
  }

  if (pages.length === 0) {
    throw new ExtractError(
      '파일에서 글자를 찾지 못했습니다. 이미지로만 이루어진 문서는 읽을 수 없습니다 — 내용을 텍스트로 붙여넣어 주세요.',
    )
  }

  // 상한을 넘으면 페이지 단위로 잘라낸다. 페이지 중간에서 끊으면 인용 페이지가 어긋날 수 있다.
  let used = 0
  let truncated = false
  const kept: ExtractedPage[] = []
  for (const page of pages) {
    if (used + page.text.length > MAX_CHARS_PER_FILE) {
      truncated = true
      break
    }
    kept.push(page)
    used += page.text.length
  }

  if (kept.length === 0) {
    kept.push({ ...pages[0], text: pages[0].text.slice(0, MAX_CHARS_PER_FILE) })
    truncated = true
  }

  return { fileName: file.name, pages: kept, truncated }
}
