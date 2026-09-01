import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ActionResult } from './ActionMenu'

type Props = {
  result: ActionResult
}

// prompt_function.txt: 출처는 접힌 토글로 시작해서 클릭하면 펼쳐지고,
// 기사 링크는 새 탭에서 열리는 버튼 형태로 보여준다.
export default function ActionResultView({ result }: Props) {
  return (
    <div className="action-result">
      {result.notice && <p className="action-result-notice">{result.notice}</p>}

      {result.blocks.length === 0 && !result.notice && (
        <p className="action-result-notice">아직 준비된 내용이 없습니다.</p>
      )}

      {result.blocks.map((block, i) => (
        <div key={i} className="action-result-block">
          <div className="action-result-label">{block.label}</div>
          <div className="action-result-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
          </div>
        </div>
      ))}

      {result.sources && result.sources.length > 0 && (
        <details className="action-result-sources">
          <summary>출처 ({result.sources.length})</summary>
          <ul>
            {result.sources.map((s, i) => (
              <li key={i}>
                <span className="source-meta">{[s.outlet, s.date].filter(Boolean).join(' · ')}</span>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    기사 원문 보기 →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.as_of && <p className="action-result-as-of">기준일자: {result.as_of}</p>}
    </div>
  )
}
