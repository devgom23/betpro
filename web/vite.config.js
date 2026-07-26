import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // React가 '/api/...'로 호출하면 FastAPI 서버(8000)로 전달
      '/api': {
        // localhost는 Node가 IPv6(::1)부터 시도했다가 실패하고서야 IPv4로 넘어가
        // 매 요청마다 ~200ms가 그냥 깔린다. 127.0.0.1로 바로 붙여서 그 지연을 없앤다.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
