import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 施工图 API 契约:HTTP 接口与 TTS 音频 → 本地服务 :8080
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/tts': { target: 'http://localhost:8080', changeOrigin: true },
      // WebSocket 聊天流
      '/stream': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
