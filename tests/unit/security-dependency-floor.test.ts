import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FLOOR = [16, 2, 6] as const

function versionTuple(value: string): [number, number, number] {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new Error(`No semantic version in ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeastFloor(value: string): boolean {
  const actual = versionTuple(value)
  for (let index = 0; index < FLOOR.length; index += 1) {
    if (actual[index] > FLOOR[index]) return true
    if (actual[index] < FLOOR[index]) return false
  }
  return true
}

describe('Next.js security floor', () => {
  it('keeps the manifest and every resolved lockfile entry at or above 16.2.6', () => {
    const root = process.cwd()
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(atLeastFloor(pkg.dependencies.next)).toBe(true)

    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')
    const resolved = [...lock.matchAll(/(?:^|\s)next@(\d+\.\d+\.\d+)/gm)].map(
      (match) => match[1],
    )
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved.every(atLeastFloor)).toBe(true)
  })
})
