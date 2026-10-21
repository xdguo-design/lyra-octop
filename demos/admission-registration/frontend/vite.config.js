import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue2'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const octopOrigin = env.OCTOP_API_ORIGIN || 'http://127.0.0.1:8200'
  const admissionApiOrigin = env.ADMISSION_API_ORIGIN || 'http://127.0.0.1:8765'
  return {
    base: env.VITE_BASE_PATH || '/',
    resolve: {
      alias: [{ find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm.js' }],
    },
    build: {
      emptyOutDir: true,
      // index.html 为固定比例舞台（iframe 缩放壳），app.html 为应用本体
      rollupOptions: { input: { index: 'index.html', app: 'app.html' } },
    },
    plugins: [vue()],
    server: {
      proxy: {
        '/admission-registration-api': {
          target: admissionApiOrigin,
          rewrite: (path) =>
            path.replace(/^\/admission-registration-api/, '/api/admission-registration'),
        },
        '/api/admission-registration': octopOrigin,
        '/api/voice': octopOrigin,
        '/api/admission-demo': octopOrigin,
      },
    },
    test: { environment: 'jsdom' },
  }
})
