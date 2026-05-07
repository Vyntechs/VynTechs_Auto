import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Separate vitest config for integration tests that need real Supabase access.
// These tests intentionally do NOT load tests/setup.ts (the PGlite setup) —
// they hit the live database via @supabase/supabase-js.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    // No setupFiles — these tests manage their own clients.
    // Sequential: each test makes real network calls; parallelism here
    // adds little speed but increases flake risk against the live API.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 15_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
