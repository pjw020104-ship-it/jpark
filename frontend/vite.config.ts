import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    // Cloudflare Pages 배포 폴더(cloudflare/)로 직접 빌드한다. functions/와 같은 위치에
    // 있어야 `wrangler pages deploy`가 정적 자산과 API 함수를 함께 배포한다.
    outDir: '../cloudflare/dist',
    emptyOutDir: true,
  },
})
