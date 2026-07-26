import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Many suites stand up a pglite database. The 5s default is tight enough
    // that they time out on a loaded machine or a slower CI runner while the
    // code under test is fine, so the suite gate reports noise as failure.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'lib/**/*.test.ts',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
    ],
    // macOS writes AppleDouble sidecars (`._name.test.tsx`) next to real files
    // on non-native volumes. They match the globs above and fail to parse, so
    // the run dies on junk that is already git-ignored.
    exclude: [...configDefaults.exclude, '**/._*'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
