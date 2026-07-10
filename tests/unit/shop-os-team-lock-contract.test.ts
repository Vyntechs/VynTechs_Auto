import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Shop OS last-owner lock contract', () => {
  it('locks the ordered active-owner set before reading a mutation target', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'lib/shop-os/team.ts'),
      'utf8',
    )
    const normalized = source.replace(/\s+/g, ' ')
    const lockStart = normalized.indexOf('async function lockActiveOwners')
    const orderedLock = normalized.indexOf(".orderBy(profiles.id) .for('update')", lockStart)
    const updateCall = normalized.indexOf('const activeOwnerIds = await lockActiveOwners', orderedLock)
    const targetRead = normalized.indexOf('const [target] = await tx', updateCall)

    expect(lockStart).toBeGreaterThan(-1)
    expect(orderedLock).toBeGreaterThan(lockStart)
    expect(updateCall).toBeGreaterThan(orderedLock)
    expect(targetRead).toBeGreaterThan(updateCall)
  })
})
