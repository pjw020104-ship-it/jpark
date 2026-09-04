// prototypes/ 폴더를 정적 서빙하는 최소 서버.
// 실행: node prototypes/serve.mjs  →  http://localhost:4180
// (HTML 파일을 그냥 더블클릭해도 열리지만, 브라우저에 따라 로컬 파일 제약이 있으면 이걸 쓴다)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = 4180
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path === '/') path = '/intro-slideshow.html'
  try {
    const file = join(ROOT, path)
    if (!file.startsWith(ROOT)) throw new Error('outside root')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))
