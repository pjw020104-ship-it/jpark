import { useEffect, useRef, useState } from 'react'
import hanwhaSymbol from '../assets/hanwha_symbol.png'

// hanwha-recruit-intro.html의 인트로 모션을 컴포넌트로 옮긴 것.
// 점 3개가 모여 한화 CI가 되고 워드마크가 뜨는 데까지 약 3.1초 걸린다.
const HOLD_MS = 3200
const FADE_MS = 700

export default function IntroSplash() {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)
  const timers = useRef<number[]>([])

  const dismiss = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setFading(true)
    timers.current.push(window.setTimeout(() => setVisible(false), FADE_MS))
  }

  useEffect(() => {
    timers.current.push(window.setTimeout(() => setFading(true), HOLD_MS))
    timers.current.push(window.setTimeout(() => setVisible(false), HOLD_MS + FADE_MS))
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [])

  if (!visible) return null

  return (
    <div className={`intro-splash ${fading ? 'intro-splash-fade' : ''}`}>
      <div className="intro-grid" aria-hidden="true" />

      {/* 로고는 화면 정중앙에 두고, 큰 텍스트는 그 위 / 작은 텍스트는 그 아래에 각각 한 줄로 놓는다 */}
      <div className="intro-copy">
        <p className="intro-kicker">HANWHA CAREERS</p>
        <h1>당신의 가능성이 한화와 만나는 순간</h1>
      </div>

      {/* 환형(고리) 3개가 각자 날아와 한화 CI 배치로 자리잡고,
          마지막에 실제 CI 이미지로 부드럽게 넘어간다 */}
      <div className="intro-piece" aria-hidden="true">
        <i className="intro-ring intro-ring-a" />
        <i className="intro-ring intro-ring-b" />
        <i className="intro-ring intro-ring-c" />
        <img className="intro-logo" src={hanwhaSymbol} alt="" />
      </div>

      <p className="intro-wordmark" aria-label="Hanwha">
        Hanwha
      </p>

      <p className="intro-lede">채용에 관한 궁금한 점을 편하게 물어보세요. 당신에게 맞는 기회를 함께 찾아드릴게요.</p>

      <button type="button" className="intro-skip" onClick={dismiss}>
        건너뛰기
      </button>
    </div>
  )
}
