import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue2'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const octopOrigin = env.OCTOP_API_ORIGIN || 'http://127.0.0.1:8200'
  return {
    base: env.VITE_BASE_PATH || '/',
    build: { emptyOutDir: true, chunkSizeWarningLimit: 700 },
    plugins: [vue()],
    server: {
      proxy: {
        '/api/admission-registration': octopOrigin,
        '/api/voice': octopOrigin,
        '/api/admission-demo': octopOrigin,
      },
    },
    test: { environment: 'jsdom' },
  }
})
