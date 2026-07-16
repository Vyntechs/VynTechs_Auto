import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'lib/**/*.test.ts',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
    ],
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
})
