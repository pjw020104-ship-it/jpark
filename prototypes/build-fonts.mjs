// hanwha-fonts.css 재생성 스크립트.
// 프로토타입 HTML은 file:// 로도 열 수 있어야 하는데 Chrome은 file:// 페이지에서
// 별도 폰트 파일 로드를 CORS로 막는다. 그래서 woff2를 data URI로 인라인해 둔다.
// 실행: node prototypes/build-fonts.mjs  (프로젝트 루트 기준)
import { readFileSync, writeFileSync, statSync } from 'node:fs'

const DIR = 'frontend/src/assets/fonts/hanwha'
const FACES = [['Light', 300], ['Regular', 400], ['Bold', 700]]

let css = `/* 자동 생성 파일 — 손으로 편집하지 말 것. 재생성: node prototypes/build-fonts.mjs */\n\n`
for (const [name, weight] of FACES) {
  const b64 = readFileSync(`${DIR}/Hanwha-${name}.woff2`).toString('base64')
  css += `@font-face{font-family:'Hanwha';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}\n`
}
writeFileSync('prototypes/hanwha-fonts.css', css)
console.log(`hanwha-fonts.css 생성 완료 (${(statSync('prototypes/hanwha-fonts.css').size / 1024).toFixed(0)}KB)`)
