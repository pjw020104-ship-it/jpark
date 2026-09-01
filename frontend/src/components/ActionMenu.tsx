import { useState } from 'react'

export type ActionKey = 'job_description' | 'skill_gap' | 'job_issues' | 'interview_questions'

export type ActionBlock = { label: string; content: string }
export type ActionSource = { outlet?: string; date?: string; url?: string }

export type ActionResult = {
  action: ActionKey
  blocks: ActionBlock[]
  sources?: ActionSource[]
  as_of?: string
  state: 'ok' | 'fallback' | 'needs_profile'
  notice?: string
}

// SPEC §4.5 버튼 순서·라벨은 고정
const ACTIONS: { key: ActionKey; label: string }[] = [
  { key: 'job_description', label: '직무 설명' },
  { key: 'skill_gap', label: '나의 역량 진단하기' },
  { key: 'job_issues', label: '직무 이슈 분석' },
  { key: 'interview_questions', label: '면접 예상 질문' },
]

type Props = {
  sessionId: string
  companyId: string
  positionId: string
  completed: Set<ActionKey>
  onComplete: (action: ActionKey) => void
  onResult: (action: ActionKey, label: string, result: ActionResult) => void
}

export default function ActionMenu({ sessionId, companyId, positionId, completed, onComplete, onResult }: Props) {
  const [loadingAction, setLoadingAction] = useState<ActionKey | null>(null)
  const [profileNeededFor, setProfileNeededFor] = useState<ActionKey | null>(null)
  const [coverLetterText, setCoverLetterText] = useState('')
  const [portfolioText, setPortfolioText] = useState('')

  const callAction = async (action: ActionKey, overrides?: { coverLetterText?: string; portfolioText?: string }) => {
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
        }),
      })
      const data: ActionResult = await res.json()

      if (data.state === 'needs_profile') {
        setProfileNeededFor(action)
        return
      }

      const label = ACTIONS.find((a) => a.key === action)?.label ?? action
      setProfileNeededFor(null)
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

      {profileNeededFor && (
        <div className="profile-panel">
          <p>
            역량 진단을 위해 자기소개서를 입력해주세요 (포트폴리오는 선택). 입력 내용은 서버에 저장되지 않고
            이번 세션에서만 사용된 뒤 폐기됩니다.
          </p>
          <label className="profile-field-label">자기소개서</label>
          <textarea
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
          <div className="profile-actions">
            <button
              type="button"
              onClick={() => callAction(profileNeededFor, { coverLetterText, portfolioText })}
              disabled={!coverLetterText.trim()}
            >
              제출
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setProfileNeededFor(null)
                setCoverLetterText('')
                setPortfolioText('')
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
