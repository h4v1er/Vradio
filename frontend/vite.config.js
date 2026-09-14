import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // PWA:Service Worker 缓存静态资源;开发模式不启用(避免缓存干扰,风险清单 #6)
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Vradio · 个人 AI 电台',
        short_name: 'Vradio',
        description: '个人 AI 电台:品味语料 + 天气日程 + Claude 编排,薄荷绿信号常亮。',
        theme_color: '#07090d',
        background_color: '#07090d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        // /api、/tts、/stream 均为运行时请求,绝不预缓存
        navigateFallbackDenylist: [/^\/api\//, /^\/tts\//, /^\/stream/],
      },
    }),
  ],
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
