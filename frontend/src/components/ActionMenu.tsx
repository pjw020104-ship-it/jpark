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
  const [profileText, setProfileText] = useState('')

  const callAction = async (action: ActionKey, profileTextOverride?: string) => {
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
          profile_text: profileTextOverride,
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

  return (
    <div className="action-menu">
      <div className="action-menu-grid">
        {ACTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="action-btn"
            onClick={() => callAction(key)}
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
            역량 진단을 위해 이력서 텍스트를 붙여넣거나 간단한 프로필을 적어주세요. 입력 내용은 서버에 저장되지
            않고 이번 세션에서만 사용된 뒤 폐기됩니다.
          </p>
          <textarea
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
            placeholder={
              '이력서를 붙여넣거나, 아래 4가지를 자유롭게 적어주세요:\n' +
              '1) 전공 계열  2) 관심 산업  3) 보유 경험(인턴/프로젝트/자격증/어학)  4) 선호 업무 성향'
            }
            rows={6}
          />
          <div className="profile-actions">
            <button type="button" onClick={() => callAction(profileNeededFor, profileText)} disabled={!profileText.trim()}>
              제출
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setProfileNeededFor(null)
                setProfileText('')
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
