import { useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hanwhaLogo from './assets/hanwha_logo.png'
import ActionMenu, { type ActionKey, type ActionResult } from './components/ActionMenu'
import ActionResultView from './components/ActionResultView'
import IntroSplash from './components/IntroSplash'
import { shouldShowActionMenu } from './lib/actionTrigger'
import './App.css'

type Message = {
  role: 'user' | 'assistant'
  content: string
  kind?: 'action-result'
  result?: ActionResult
}

type Company = { id: string; name_ko: string }
type Job = { id: string; name_ko: string }

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

function App() {
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [sessionId] = useState<string>(loadOrCreateSessionId)

  const [companies, setCompanies] = useState<Company[]>([])
  const [jobs, setJobs] = useState<Job[]>([])

  const [companyId, setCompanyId] = useState<string>('')
  const [jobTitle, setJobTitle] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const [resolvedMeta, setResolvedMeta] = useState<Record<number, { companyId: string; positionId: string }>>({})
  const [completedByCombo, setCompletedByCombo] = useState<Record<string, Set<ActionKey>>>({})

  const abortRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // §9: 계열사명을 코드에 하드코딩하지 않고 data/*.json 기반 API에서 받아온다.
  useEffect(() => {
    fetch('/api/organizations')
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.companies ?? [])
        if (data.companies?.[0]) setCompanyId(data.companies[0].id)
      })
      .catch(() => setCompanies([]))
  }, [])

  // 회사별 실제 직무명(Job_name.txt 기반)을 회사가 바뀔 때마다 다시 받아온다.
  useEffect(() => {
    if (!companyId) {
      setJobs([])
      return
    }
    fetch(`/api/jobs?company_id=${encodeURIComponent(companyId)}`)
      .then((r) => r.json())
      .then((data) => setJobs(data.jobs ?? []))
      .catch(() => setJobs([]))
    setJobTitle('')
  }, [companyId])

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
  const resolvedCompanyName = selectedCompany?.name_ko ?? ''

  const entries: { query: Message; answer?: Message }[] = []
  for (let i = 1; i < messages.length; i += 2) {
    entries.push({ query: messages[i], answer: messages[i + 1] })
  }

  const handleJobLookup = (e: FormEvent) => {
    e.preventDefault()
    const job = jobTitle.trim()
    if (!job || !resolvedCompanyName || isStreaming) return

    // §4.5 트리거: company_id + position_id가 모두 정확히 확정될 때만 버튼 메뉴를 연결한다.
    const matchedRole = jobs.find((r) => r.name_ko === job)
    const nextEntryIndex = entries.length
    if (shouldShowActionMenu(companyId, matchedRole?.id)) {
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
    <>
      <IntroSplash />
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
          </select>
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
          {jobs.map((job) => (
            <button
              type="button"
              key={job.id}
              className="chip"
              onClick={() => setJobTitle(job.name_ko)}
              disabled={isStreaming}
            >
              {job.name_ko}
            </button>
          ))}
        </div>
      </form>

      <div className="chat-window">
        <p className="intro">{messages[0].content}</p>
        {entries.map((entry, index) => {
          const meta = resolvedMeta[index]
          const comboKey = meta ? `${meta.companyId}:${meta.positionId}` : null
          const hasAnswer = entry.answer?.kind === 'action-result' || Boolean(entry.answer?.content)
          const answerReady = hasAnswer && !(isStreaming && index === entries.length - 1)

          return (
            <div key={index} className="entry">
              <div className="entry-query">{entry.query.content}</div>
              <div className="entry-answer">
                {entry.answer?.kind === 'action-result' && entry.answer.result ? (
                  <ActionResultView result={entry.answer.result} />
                ) : entry.answer?.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.answer.content}</ReactMarkdown>
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
                      { role: 'assistant', content: '', kind: 'action-result', result },
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
    </>
  )
}

export default App
