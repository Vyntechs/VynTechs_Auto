import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../../components/diagram-kit')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(e.name) ? [full] : []
  })
}

/**
 * Strip block + line comments so the purity scan checks the draw-path CODE, not
 * its prose. The frozen part-api.ts header literally disclaims "NO @xyflow, NO
 * AI" — a disclaimer is the OPPOSITE of a violation. Stripping comments ignores
 * that prose while still catching any real import/call (the threat we guard).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('draw-path purity guards', () => {
  const files = walk(ROOT).filter(
    (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
  )

  it('the draw-path code references no AI and no AI/network/data-fetch imports', () => {
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      expect(code, f).not.toMatch(/\bAI\b/)
      expect(code, f).not.toMatch(/@xyflow|dagre|fetch\(|loadSystemTopology|anthropic/i)
    }
  })

  it('no consumer resolves a part with a switch over kind (registry only)', () => {
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      expect(code, f).not.toMatch(/switch\s*\(\s*\w*kind/i)
    }
  })
})
