import { useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import hanwhaLogo from './assets/hanwha_logo.png'
import ActionMenu, { type ActionKey, type ActionResult } from './components/ActionMenu'
import { shouldShowActionMenu } from './lib/actionTrigger'
import './App.css'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type Company = { id: string; name_ko: string }
type JobRole = { id: string; name_ko: string }
type JobFamily = { id: string; name_ko: string; roles: JobRole[] }

const CUSTOM_COMPANY_VALUE = '__custom__'

const STORAGE_KEY = 'hanwha-explainer-messages'
const SESSION_KEY = 'hanwha-explainer-session-id'

const WELCOME: Message = {
  role: 'assistant',
  content:
    '안녕하세요! 저는 한화 지원자를 위한 직무 가이드예요. 회사와 직무명을 입력하면 어떤 일을 하는지, 어떤 역량이 필요한지, 최근 이슈는 뭔지 정리해드릴게요 🙂',
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [WELCOME]
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME]
  } catch {
    return [WELCOME]
  }
}

function loadOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, created)
    return created
  } catch {
    return crypto.randomUUID()
  }
}

function formatActionResult(result: ActionResult): string {
  const parts: string[] = []

  if (result.notice) parts.push(`_${result.notice}_`)

  if (result.blocks.length === 0 && !result.notice) {
    parts.push('아직 준비된 내용이 없습니다.')
  }

  for (const b of result.blocks) {
    parts.push(`**${b.label}**\n${b.content}`)
  }

  if (result.sources && result.sources.length > 0) {
    const lines = result.sources.map((s) => `- ${[s.outlet, s.date, s.url].filter(Boolean).join(' · ')}`)
    parts.push(`---\n**출처**\n${lines.join('\n')}`)
  }

  if (result.as_of) {
    parts.push(`*기준일자: ${result.as_of}*`)
  }

  return parts.filter(Boolean).join('\n\n')
}

function App() {
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [sessionId] = useState<string>(loadOrCreateSessionId)

  const [companies, setCompanies] = useState<Company[]>([])
  const [jobFamilies, setJobFamilies] = useState<JobFamily[]>([])

  const [companyId, setCompanyId] = useState<string>('')
  const [customCompany, setCustomCompany] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const [resolvedMeta, setResolvedMeta] = useState<Record<number, { companyId: string; positionId: string }>>({})
  const [completedByCombo, setCompletedByCombo] = useState<Record<string, Set<ActionKey>>>({})

  const abortRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // §9: 계열사/직무명을 코드에 하드코딩하지 않고 data/*.json 기반 API에서 받아온다.
  useEffect(() => {
    fetch('/api/organizations')
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.companies ?? [])
        if (data.companies?.[0]) setCompanyId(data.companies[0].id)
      })
      .catch(() => setCompanies([]))

    fetch('/api/job-families')
      .then((r) => r.json())
      .then((data) => setJobFamilies(data.families ?? []))
      .catch(() => setJobFamilies([]))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch {
      // localStorage 사용 불가(프라이빗 모드 등) — 이번 세션 동안만 대화 유지
    }
  }, [messages])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const allRoles = jobFamilies.flatMap((f) => f.roles)

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return

    const nextMessages: Message[] = [...messages, { role: 'user', content: trimmed }]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
        signal: controller.signal,
      })

      if (!response.body) throw new Error('스트림 응답이 없습니다.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = JSON.parse(line.slice(6))
          if (payload.text) {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = { ...last, content: last.content + payload.text }
              return updated
            })
          }
          if (payload.error) {
            setMessages((prev) => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: `⚠️ ${payload.error}` }
              return updated
            })
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: '⚠️ 서버와 통신 중 오류가 발생했습니다. 백엔드 서버가 실행 중인지 확인해주세요.',
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const selectedCompany = companies.find((c) => c.id === companyId)
  const resolvedCompanyName = companyId === CUSTOM_COMPANY_VALUE ? customCompany.trim() : (selectedCompany?.name_ko ?? '')

  const entries: { query: Message; answer?: Message }[] = []
  for (let i = 1; i < messages.length; i += 2) {
    entries.push({ query: messages[i], answer: messages[i + 1] })
  }

  const handleJobLookup = (e: FormEvent) => {
    e.preventDefault()
    const job = jobTitle.trim()
    if (!job || !resolvedCompanyName || isStreaming) return

    // §4.5 트리거: company_id + position_id가 모두 정확히 확정될 때만 버튼 메뉴를 연결한다.
    const matchedRole = allRoles.find((r) => r.name_ko === job)
    const nextEntryIndex = entries.length
    if (shouldShowActionMenu(companyId, matchedRole?.id) && companyId !== CUSTOM_COMPANY_VALUE) {
      setResolvedMeta((prev) => ({ ...prev, [nextEntryIndex]: { companyId, positionId: matchedRole!.id } }))
    }

    sendMessage(`${resolvedCompanyName}의 "${job}" 직무에 대해 알려줘.`)
    setJobTitle('')
  }

  const handleFollowUp = (e: FormEvent) => {
    e.preventDefault()
    sendMessage(followUp)
    setFollowUp('')
  }

  const resetChat = () => {
    abortRef.current?.abort()
    setJobTitle('')
    setFollowUp('')
    setMessages([WELCOME])
    setResolvedMeta({})
    setCompletedByCombo({})
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <div className="brand">
            <span className="brand-logo-wrap">
              <img src={hanwhaLogo} alt="Hanwha" className="brand-logo" />
            </span>
            <div>
              <h1>
                <span className="accent">한화</span> 직무 가이드
              </h1>
              <p>회사와 직무를 입력하면 하는 일 · 필요 역량 · 최근 이슈를 알려드려요</p>
            </div>
          </div>
          <button className="reset-btn" onClick={resetChat}>
            새 대화
          </button>
        </div>
      </header>

      <form className="job-form" onSubmit={handleJobLookup}>
        <div className="job-form-row">
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ko}
              </option>
            ))}
            <option value={CUSTOM_COMPANY_VALUE}>기타(직접 입력)</option>
          </select>
          {companyId === CUSTOM_COMPANY_VALUE && (
            <input
              className="company-input"
              value={customCompany}
              onChange={(e) => setCustomCompany(e.target.value)}
              placeholder="회사명 입력"
            />
          )}
        </div>
        <div className="job-form-row">
          <input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="직무명을 입력하세요 (예: 생산관리, 해외영업...)"
            disabled={isStreaming}
          />
          <button type="submit" disabled={isStreaming || !jobTitle.trim() || !resolvedCompanyName}>
            직무 알아보기
          </button>
        </div>
        <div className="job-chips">
          {jobFamilies.map((family) => (
            <button
              type="button"
              key={family.id}
              className="chip"
              onClick={() => setJobTitle(family.roles[0]?.name_ko ?? family.name_ko)}
              disabled={isStreaming}
            >
              {family.name_ko}
            </button>
          ))}
        </div>
      </form>

      <div className="chat-window">
        <p className="intro">{messages[0].content}</p>
        {entries.map((entry, index) => {
          const meta = resolvedMeta[index]
          const comboKey = meta ? `${meta.companyId}:${meta.positionId}` : null
          const answerReady = Boolean(entry.answer?.content) && !(isStreaming && index === entries.length - 1)

          return (
            <div key={index} className="entry">
              <div className="entry-query">{entry.query.content}</div>
              <div className="entry-answer">
                {entry.answer?.content ? (
                  <ReactMarkdown>{entry.answer.content}</ReactMarkdown>
                ) : isStreaming && index === entries.length - 1 ? (
                  <span className="typing">답변을 정리하는 중...</span>
                ) : null}
              </div>

              {meta && answerReady && comboKey && (
                <ActionMenu
                  sessionId={sessionId}
                  companyId={meta.companyId}
                  positionId={meta.positionId}
                  completed={completedByCombo[comboKey] ?? new Set()}
                  onComplete={(action) =>
                    setCompletedByCombo((prev) => {
                      const next = new Set(prev[comboKey] ?? [])
                      next.add(action)
                      return { ...prev, [comboKey]: next }
                    })
                  }
                  onResult={(_action, label, result) => {
                    setMessages((prev) => [
                      ...prev,
                      { role: 'user', content: label },
                      { role: 'assistant', content: formatActionResult(result) },
                    ])
                  }}
                />
              )}
            </div>
          )
        })}
        <div ref={chatEndRef} />
      </div>

      <form className="input-row" onSubmit={handleFollowUp}>
        <input
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          placeholder="답변하거나 추가로 궁금한 점을 입력하세요..."
          disabled={isStreaming}
        />
        <button type="submit" disabled={isStreaming || !followUp.trim()}>
          {isStreaming ? '답변 중...' : '전송'}
        </button>
      </form>
    </div>
  )
}

export default App
