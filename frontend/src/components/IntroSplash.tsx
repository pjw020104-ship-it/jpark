import { useEffect, useState } from 'react'
import hanwhaLogo from '../assets/hanwha_logo.png'

const HOLD_MS = 1100
const FADE_MS = 600

export default function IntroSplash() {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), HOLD_MS)
    const removeTimer = setTimeout(() => setVisible(false), HOLD_MS + FADE_MS)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(removeTimer)
    }
  }, [])

  if (!visible) return null

  return (
    <div className={`intro-splash ${fading ? 'intro-splash-fade' : ''}`} aria-hidden="true">
      <img src={hanwhaLogo} alt="" className="intro-splash-logo" />
    </div>
  )
}
