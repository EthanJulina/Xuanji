import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite 配置:构建产物输出到 dist/,由 Electron 主进程在非开发模式下加载
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 1024 * 512
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1'
  }
})
