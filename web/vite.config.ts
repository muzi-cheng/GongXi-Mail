import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const normalizeBase = (value?: string): string => {
  const rawValue = (value || '/').trim()

  if (!rawValue || rawValue === '/') {
    return '/'
  }

  const withLeadingSlash = rawValue.startsWith('/') ? rawValue : `/${rawValue}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: normalizeBase(env.VITE_APP_BASE),
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/admin': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      chunkSizeWarningLimit: 1600,
    },
  }
})
