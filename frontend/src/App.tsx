import { useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import hanwhaLogo from './assets/hanwha_logo.png'
import ActionMenu, { type ActionKey, type ActionResult, type RoleRecommendation } from './components/ActionMenu'
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

  const [activeEntry, setActiveEntry] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatWindowRef = useRef<HTMLDivElement>(null)
  const entryRefs = useRef<(HTMLDivElement | null)[]>([])

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

  // 오른쪽 질문 목록에서 "지금 보고 있는 질문"을 표시하기 위한 관찰.
  // 대화 영역만 스크롤되므로 뷰포트가 아니라 .chat-window를 root로 잡는다.
  useEffect(() => {
    const root = chatWindowRef.current
    const nodes = entryRefs.current.filter((node): node is HTMLDivElement => Boolean(node))
    if (!root || nodes.length === 0) return

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (!visible) return
        const index = nodes.indexOf(visible.target as HTMLDivElement)
        if (index !== -1) setActiveEntry(index)
      },
      // 화면 위쪽 1/3에 걸친 항목을 "현재 질문"으로 본다.
      { root, rootMargin: '0px 0px -66% 0px', threshold: 0 },
    )

    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
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

  // 액션 버튼은 대화 흐름에 끼워 넣지 않고 입력창 위에 고정한다.
  // 버튼을 누를 때마다 답변이 쌓이면서 버튼이 위로 밀려 올라가는 걸 막기 위함이다.
  // 기준은 "가장 마지막으로 확정된 회사·직무"다.
  const activeMeta = (() => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const meta = resolvedMeta[i]
      if (!meta) continue
      const answer = entries[i].answer
      const hasAnswer = answer?.kind === 'action-result' || Boolean(answer?.content)
      const answerReady = hasAnswer && !(isStreaming && i === entries.length - 1)
      if (answerReady) return meta
    }
    return null
  })()
  const activeComboKey = activeMeta ? `${activeMeta.companyId}:${activeMeta.positionId}` : null

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

  // 추천 직무를 고르면 그 회사·직무로 새 질문을 띄운다.
  // handleJobLookup과 같은 방식으로 resolvedMeta를 등록해야 액션 버튼이 그 직무 기준으로 붙는다.
  const pickRecommendation = (rec: RoleRecommendation) => {
    if (isStreaming) return
    setCompanyId(rec.company_id)
    setResolvedMeta((prev) => ({
      ...prev,
      [entries.length]: { companyId: rec.company_id, positionId: rec.position_id },
    }))
    sendMessage(`${rec.company_name}의 "${rec.position_name}" 직무에 대해 알려줘.`)
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

  const goToEntry = (index: number) => {
    setActiveEntry(index)
    entryRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <IntroSplash />

      {/* 헤더는 챗봇 카드 밖, 페이지 최상단에 독립적으로 떠 있는 가로형 영역이다. */}
      <header className="site-header">
        <div className="site-header-inner">
          <div className="site-brand">
            <span className="brand-logo-wrap">
              <img src={hanwhaLogo} alt="Hanwha" className="brand-logo" />
            </span>
            <div>
              <h1>
                <span className="accent">한화</span> 직무 가이드
              </h1>
              <p>회사와 직무를 입력하면 하는 일 · 필요 역량 · 최근 이슈를 알려드려요</p>
              <a className="brand-link" href="https://www.hanwhain.com/" target="_blank" rel="noreferrer">
                한화 채용사이트 바로가기 →
              </a>
            </div>
          </div>

          <form className="site-search" onSubmit={handleJobLookup}>
            <div className="site-search-row">
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ko}
                  </option>
                ))}
              </select>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="직무명을 입력하세요 (예: 생산관리, 해외영업...)"
                disabled={isStreaming}
              />
              <button type="submit" disabled={isStreaming || !jobTitle.trim() || !resolvedCompanyName}>
                직무 알아보기
              </button>
              {/* 폼 안에 있으므로 type="button"이 없으면 클릭 시 직무 조회가 제출된다 */}
              <button type="button" className="reset-btn" onClick={resetChat}>
                새 대화
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

        </div>
      </header>

      <div className="layout">
        <main className="app">
      <div className="chat-window" ref={chatWindowRef}>
        <p className="intro">{messages[0].content}</p>
        {entries.map((entry, index) => {
          return (
            <div
              key={index}
              className="entry"
              id={`entry-${index}`}
              ref={(node) => {
                entryRefs.current[index] = node
              }}
            >
              <div className="entry-query">{entry.query.content}</div>
              <div className="entry-answer">
                {entry.answer?.kind === 'action-result' && entry.answer.result ? (
                  <ActionResultView result={entry.answer.result} onPickRecommendation={pickRecommendation} />
                ) : entry.answer?.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{entry.answer.content}</ReactMarkdown>
                ) : isStreaming && index === entries.length - 1 ? (
                  <span className="typing">답변을 정리하는 중...</span>
                ) : null}
              </div>
            </div>
          )
        })}
        <div ref={chatEndRef} />
      </div>

      {activeMeta && activeComboKey && (
        <div className="action-dock">
          <ActionMenu
            // 회사·직무가 바뀌면 입력하던 자기소개서·첨부가 남지 않도록 컴포넌트를 새로 만든다
            key={activeComboKey}
            sessionId={sessionId}
            companyId={activeMeta.companyId}
            positionId={activeMeta.positionId}
            completed={completedByCombo[activeComboKey] ?? new Set()}
            onComplete={(action) =>
              setCompletedByCombo((prev) => {
                const next = new Set(prev[activeComboKey] ?? [])
                next.add(action)
                return { ...prev, [activeComboKey]: next }
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
        </div>
      )}

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
        </main>

        {/* Notion 목차처럼 동작하는 질문 목록. 대화 영역만 스크롤되므로 이 카드는 늘 화면에 남는다. */}
        {entries.length > 0 && (
          <aside className="qnav" aria-label="질문 목록">
            <div className="qnav-title">질문 목록</div>
            <ol className="qnav-list">
              {entries.map((entry, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className={`qnav-item${index === activeEntry ? ' is-active' : ''}`}
                    onClick={() => goToEntry(index)}
                    title={entry.query.content}
                  >
                    <span className="qnav-index">{index + 1}</span>
                    <span className="qnav-text">{entry.query.content}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </>
  )
}

export default App
