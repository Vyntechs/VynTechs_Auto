import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CANONICAL_TECHNICIAN_HANDOFF_BASE_URL,
  assertTechnicianHandoffHarnessSafety,
} from './safety.mjs'

assertTechnicianHandoffHarnessSafety(process.env, CANONICAL_TECHNICIAN_HANDOFF_BASE_URL)

const { default: react } = await import('@vitejs/plugin-react')
const require = createRequire(import.meta.url)
const vitestEntry = require.resolve('vitest')
const viteEntry = require.resolve('vite', { paths: [dirname(vitestEntry)] })
const { createServer } = await import(pathToFileURL(viteEntry).href)
const repositoryRoot = process.cwd()
const harnessRoot = resolve(repositoryRoot, 'tests/e2e/technician-handoff-harness')
const sharedHarness = resolve(repositoryRoot, 'tests/e2e/quote-composition-commitment-harness')

const server = await createServer({
  root: harnessRoot,
  envFile: false,
  publicDir: resolve(repositoryRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      'node:crypto': resolve(sharedHarness, 'node-crypto.ts'),
      'next/image': resolve(sharedHarness, 'next-image.tsx'),
      'next/link': resolve(sharedHarness, 'next-link.tsx'),
      'next/navigation': resolve(sharedHarness, 'next-navigation.ts'),
      '@': repositoryRoot,
    },
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
})

await server.listen()
