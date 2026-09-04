// Resolver hooks so a plain `node` process can run this repository's
// TypeScript directly.
//
// Node 24 strips and transforms types itself; what it does not do is understand
// the two things every module in `lib/` relies on — the `@/` alias from
// `tsconfig.json`, and imports written without a file extension. This adds
// exactly those two rules and nothing else, which is why the seed runner needs
// no bundler, no loader dependency and no build step that could drift from what
// `tsc --noEmit` and Vitest actually check.

import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = process.env.VYNTECHS_REPO_ROOT

const SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const suffix of SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (ROOT && specifier.startsWith('@/')) {
    const found = resolveFile(`${ROOT}/${specifier.slice(2)}`)
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parent = context.parentURL?.startsWith('file:')
      ? fileURLToPath(context.parentURL)
      : null
    if (parent) {
      const found = resolveFile(fileURLToPath(new URL(specifier, pathToFileURL(parent))))
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
