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
  root: resolve(repositoryRoot, 'tests/e2e/living-repair-order-harness'),
  publicDir: resolve(repositoryRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'next/link', replacement: resolve(repositoryRoot, 'tests/e2e/living-repair-order-harness/next-link.tsx') },
      { find: 'next/image', replacement: resolve(repositoryRoot, 'tests/e2e/living-repair-order-harness/next-image.tsx') },
      { find: 'next/navigation', replacement: resolve(repositoryRoot, 'tests/e2e/living-repair-order-harness/next-navigation.ts') },
      { find: /^@\/components\/vt$/, replacement: resolve(repositoryRoot, 'tests/e2e/living-repair-order-harness/vt.ts') },
      { find: /^@\/lib\/shop-os\/ready-to-collect$/, replacement: resolve(repositoryRoot, 'tests/e2e/living-repair-order-harness/ready-to-collect.ts') },
      { find: '@', replacement: repositoryRoot },
    ],
  },
  server: { host: '127.0.0.1', port: 4183, strictPort: true },
})

await server.listen()
