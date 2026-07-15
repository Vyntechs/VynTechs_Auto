import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => readFile(path.join(root, relative), 'utf8')

describe('fresh and restored no-media environments', () => {
  it('has no canonical storage bootstrap that creates an artifacts bucket', async () => {
    await expect(access(path.join(root, 'supabase/storage-setup.sql'))).rejects.toBeTruthy()
    const instructions = await read('AGENTS.md')
    expect(instructions).not.toMatch(/storage-setup\.sql|create.*artifacts.*bucket/i)
  })

  it('requires zero-media reconciliation before a restored environment reopens', async () => {
    const restore = await read('docs/RESTORE.md')
    expect(restore).toContain('Operational object storage is intentionally absent')
    expect(restore).toContain('Old database backups may restore dormant media metadata rows, but never media bytes.')
    expect(restore).toContain('Complete the Row 49 zero-media reconciliation before reopening the restored environment.')
    expect(restore).not.toMatch(/backup workflow.*media backup/i)
  })
})
