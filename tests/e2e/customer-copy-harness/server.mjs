import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const vitestEntry = require.resolve('vitest')
const viteEntry = require.resolve('vite', { paths: [dirname(vitestEntry)] })
const { createServer } = await import(pathToFileURL(viteEntry).href)
const repositoryRoot = process.cwd()

const server = await createServer({
  root: resolve(repositoryRoot, 'tests/e2e/customer-copy-harness'),
  publicDir: resolve(repositoryRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      'next/link': resolve(repositoryRoot, 'tests/e2e/customer-copy-harness/next-link.tsx'),
      '@': repositoryRoot,
    },
  },
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
})

await server.listen()
