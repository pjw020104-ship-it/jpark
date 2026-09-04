import { useEffect, useRef, useState } from 'react'
import {
  ACCEPTED_EXTENSIONS,
  ExtractError,
  buildPortfolioText,
  type ExtractedFile,
} from '../lib/portfolio'

export type ActionKey = 'job_description' | 'skill_gap' | 'job_issues' | 'interview_questions'

export type ActionBlock = { label: string; content: string }
export type ActionSource = { outlet?: string; date?: string; url?: string }

/** 적합도가 낮을 때 진단 대신 제시하는 다른 계열사·직무 */
export type RoleRecommendation = {
  company_id: string
  company_name: string
  position_id: string
  position_name: string
  reason: string
}

export type ActionResult = {
  action: ActionKey
  blocks: ActionBlock[]
  sources?: ActionSource[]
  as_of?: string
  state: 'ok' | 'fallback' | 'needs_profile'
  notice?: string
  /** 역량 진단(skill_gap) 전용: 직무 적합도 점수 (0~100) */
  fit?: { score: number; summary?: string }
  /** 적합도가 낮아 진단 대신 다른 직무를 제안한 경우 */
  recommendations?: RoleRecommendation[]
}

// SPEC §4.5 버튼 순서·라벨은 고정
const ACTIONS: { key: ActionKey; label: string }[] = [
  { key: 'job_description', label: '직무 설명' },
  { key: 'skill_gap', label: '나의 역량 진단하기' },
  { key: 'job_issues', label: '직무 이슈 분석' },
  { key: 'interview_questions', label: '면접 예상 질문' },
]

type Attachment = {
  id: string
  fileName: string
  size: number
} & (
  | { status: 'loading' }
  | { status: 'ready'; extracted: ExtractedFile }
  | { status: 'error'; message: string }
)

type Props = {
  sessionId: string
  companyId: string
  positionId: string
  completed: Set<ActionKey>
  onComplete: (action: ActionKey) => void
  onResult: (action: ActionKey, label: string, result: ActionResult) => void
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function describePages(extracted: ExtractedFile): string {
  const numbered = extracted.pages.filter((p) => p.page !== null)
  const suffix = extracted.truncated ? ', 앞부분만 사용' : ''
  if (numbered.length === 0) return `텍스트 추출 완료${suffix}`
  return `${numbered.length}쪽 추출 완료${suffix}`
}

export default function ActionMenu({ sessionId, companyId, positionId, completed, onComplete, onResult }: Props) {
  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null)
  const [profileNeededFor, setProfileNeededFor] = useState<ActionKey | null>(null)
  const [coverLetterText, setCoverLetterText] = useState('')
  const [portfolioText, setPortfolioText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // showModal()로 열면 브라우저가 이 요소를 top layer에 올린다.
  // 조상의 overflow/z-index/height에 잘리지 않고, ESC 닫기와 포커스 가둠도 브라우저가 처리한다.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (profileNeededFor && !dialog.open) dialog.showModal()
    else if (!profileNeededFor && dialog.open) dialog.close()
  }, [profileNeededFor])

  const readyFiles = attachments.flatMap((a) => (a.status === 'ready' ? [a.extracted] : []))
  const isExtracting = attachments.some((a) => a.status === 'loading')

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return

    for (const file of Array.from(fileList)) {
      const id = crypto.randomUUID()
      setAttachments((prev) => [...prev, { id, fileName: file.name, size: file.size, status: 'loading' }])

      // 추출은 브라우저에서 한다. 파일 자체는 서버로 올라가지 않는다.
      // 파서(pdf.js)는 무거워서 파일을 고른 지금에야 내려받는다.
      import('../lib/extractFileText')
        .then(({ extractFileText }) => extractFileText(file))
        .then((extracted) => {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'ready' as const, extracted } : a)))
        })
        .catch((error: unknown) => {
          const message = error instanceof ExtractError ? error.message : '파일을 읽는 중 오류가 발생했습니다.'
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'error' as const, message } : a)))
        })
    }

    // 같은 파일을 지웠다가 다시 고를 수 있도록 input 값을 비운다.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id))

  const resetProfileInputs = () => {
    setProfileNeededFor(null)
    setCoverLetterText('')
    setPortfolioText('')
    setAttachments([])
  }

  type Overrides = { coverLetterText?: string; portfolioText?: string; portfolioFileNames?: string[] }

  const callAction = async (action: ActionKey, overrides?: Overrides) => {
    setLoadingAction(action)
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          action,
          company_id: companyId,
          position_id: positionId,
          cover_letter_text: overrides?.coverLetterText,
          portfolio_text: overrides?.portfolioText,
          // 제출과 동시에 팝업을 닫으면서 첨부 목록도 비워지므로, 파일명은 인자로 받은 값을 쓴다.
          portfolio_file_names: overrides?.portfolioFileNames ?? readyFiles.map((f) => f.fileName),
        }),
      })
      const data: ActionResult = await res.json()

      if (data.state === 'needs_profile') {
        setProfileNeededFor(action)
        return
      }

      const label = ACTIONS.find((a) => a.key === action)?.label ?? action
      onResult(action, label, data)
      onComplete(action)
    } catch {
      const label = ACTIONS.find((a) => a.key === action)?.label ?? action
      onResult(action, label, {
        action,
        blocks: [],
        sources: [],
        state: 'fallback',
        notice: '요청 중 오류가 발생했습니다. 백엔드 서버가 실행 중인지 확인해주세요.',
      })
    } finally {
      setLoadingAction(null)
    }
  }

  /**
   * 제출과 동시에 팝업을 닫는다.
   * 역량 진단은 응답까지 수십 초 걸릴 수 있어서, 응답을 기다렸다 닫으면
   * 그동안 팝업이 화면을 가린 채 멈춰 있는 것처럼 보인다.
   * 진행 상태는 액션 버튼의 스피너가 대신 보여준다.
   */
  const submitProfile = () => {
    if (!profileNeededFor) return
    const action = profileNeededFor
    const payload: Overrides = {
      coverLetterText,
      portfolioText: buildPortfolioText(readyFiles, portfolioText),
      portfolioFileNames: readyFiles.map((f) => f.fileName),
    }
    dialogRef.current?.close() // onClose가 입력값·첨부를 정리한다
    callAction(action, payload)
  }

  // 나의 역량 진단하기는 API를 먼저 부르지 않고 항상 입력 패널을 바로 띄운다.
  // 세션에 남아있는 이전 입력으로 조용히 대답하지 않고, 매번 직접 입력을 받는다.
  const handleButtonClick = (action: ActionKey) => {
    if (action === 'skill_gap') {
      setProfileNeededFor('skill_gap')
      return
    }
    callAction(action)
  }

  return (
    <div className="action-menu">
      <div className="action-menu-grid">
        {ACTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="action-btn"
            onClick={() => handleButtonClick(key)}
            disabled={loadingAction === key}
          >
            {loadingAction === key ? (
              <span className="action-spinner" aria-label="로딩 중" />
            ) : completed.has(key) ? (
              <span className="action-check">✓</span>
            ) : null}
            {label}
          </button>
        ))}
      </div>

      {/* 항상 렌더링해 둔다. 닫힌 <dialog>는 스스로 display:none이고, ref가 있어야 showModal()을 부를 수 있다.
          ESC와 backdrop 클릭으로 닫히면 onClose가 돌아 입력값을 정리한다. */}
      <dialog className="profile-dialog" ref={dialogRef} onClose={resetProfileInputs} aria-labelledby="profile-dialog-title">
        <div className="profile-dialog-head">
          <h2 id="profile-dialog-title">나의 역량 진단하기</h2>
          <button
            type="button"
            className="profile-dialog-close"
            onClick={() => dialogRef.current?.close()}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="profile-panel">
          <p>
            역량 진단을 위해 자기소개서를 입력해주세요 (포트폴리오는 선택). 입력 내용은 서버에 저장되지 않고
            이번 세션에서만 사용된 뒤 폐기됩니다.
          </p>
          <label className="profile-field-label" htmlFor="cover-letter-input">
            자기소개서
          </label>
          <textarea
            id="cover-letter-input"
            value={coverLetterText}
            onChange={(e) => setCoverLetterText(e.target.value)}
            placeholder="자기소개서 내용을 붙여넣어 주세요"
            rows={6}
          />

          <label className="profile-field-label">포트폴리오 (선택)</label>
          <textarea
            value={portfolioText}
            onChange={(e) => setPortfolioText(e.target.value)}
            placeholder="포트폴리오 내용을 텍스트로 붙여넣어 주세요 (없으면 비워두세요)"
            rows={4}
          />

          <div className="profile-file-row">
            <input
              ref={fileInputRef}
              id="portfolio-file-input"
              className="profile-file-input"
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS.join(',')}
              onChange={(e) => handleFiles(e.target.files)}
            />
            <label className="profile-file-button" htmlFor="portfolio-file-input">
              파일 첨부
            </label>
            <span className="profile-file-hint">
              PDF · DOCX · PPTX — 파일은 서버로 전송되지 않고 브라우저에서 텍스트만 추출합니다
            </span>
          </div>

          {attachments.length > 0 && (
            <ul className="profile-file-list">
              {attachments.map((a) => (
                <li key={a.id} className={`profile-file-item is-${a.status}`}>
                  <span className="profile-file-name">{a.fileName}</span>
                  <span className="profile-file-status">
                    {a.status === 'loading' && '읽는 중…'}
                    {a.status === 'ready' && `${describePages(a.extracted)} · ${formatSize(a.size)}`}
                    {a.status === 'error' && a.message}
                  </span>
                  <button
                    type="button"
                    className="profile-file-remove"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`${a.fileName} 첨부 취소`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

        </div>

        {/* 제출/취소는 스크롤 영역 밖에 고정해 내용이 길어져도 항상 보이게 한다 */}
        <div className="profile-actions">
          <button type="button" onClick={submitProfile} disabled={!coverLetterText.trim() || isExtracting}>
            {isExtracting ? '파일 읽는 중…' : '제출'}
          </button>
          <button type="button" className="ghost" onClick={() => dialogRef.current?.close()}>
            취소
          </button>
        </div>
      </dialog>
    </div>
  )
}
