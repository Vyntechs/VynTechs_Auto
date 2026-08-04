import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CANONICAL_QUOTE_COMMITMENT_BASE_URL,
  assertQuoteCommitmentHarnessSafety,
} from './safety.mjs'

assertQuoteCommitmentHarnessSafety(process.env, CANONICAL_QUOTE_COMMITMENT_BASE_URL)

const { default: react } = await import('@vitejs/plugin-react')
const require = createRequire(import.meta.url)
const vitestEntry = require.resolve('vitest')
const viteEntry = require.resolve('vite', { paths: [dirname(vitestEntry)] })
const { createServer } = await import(pathToFileURL(viteEntry).href)
const repositoryRoot = process.cwd()
const harnessRoot = resolve(repositoryRoot, 'tests/e2e/quote-composition-commitment-harness')

const server = await createServer({
  root: harnessRoot,
  envFile: false,
  publicDir: resolve(repositoryRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      'node:crypto': resolve(harnessRoot, 'node-crypto.ts'),
      'next/image': resolve(harnessRoot, 'next-image.tsx'),
      'next/link': resolve(harnessRoot, 'next-link.tsx'),
      'next/navigation': resolve(harnessRoot, 'next-navigation.ts'),
      '@': repositoryRoot,
    },
  },
  server: { host: '127.0.0.1', port: 4182, strictPort: true },
})

await server.listen()
