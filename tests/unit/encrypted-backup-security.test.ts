import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const root = process.cwd()
const read = (...segments: string[]) => readFileSync(resolve(root, ...segments), 'utf8')
const workflowDirectory = resolve(root, '.github', 'workflows')
const workflowSources = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => read('.github', 'workflows', name))
  .join('\n')

const workflow = read('.github', 'workflows', 'daily-db-backup.yml')
const installAge = read('.github', 'scripts', 'backup', 'install-age.sh')
const backupShell = read('.github', 'scripts', 'backup', 'backup.sh')
const backupModule = read('.github', 'scripts', 'backup', 'backup.mjs')
const retentionModule = read('.github', 'scripts', 'backup', 'retention.mjs')
const failureReport = read('.github', 'scripts', 'backup', 'report-failure.sh')
const backupPackage = JSON.parse(read('.github', 'scripts', 'backup', 'package.json'))
const backupLock = JSON.parse(read('.github', 'scripts', 'backup', 'package-lock.json'))
const restore = read('docs', 'RESTORE.md')
const strategy = read('docs', 'strategy', '2026-07-10-shop-os-spec-and-phased-plan.md')
const backupSources = [workflow, installAge, backupShell, backupModule, retentionModule, failureReport].join('\n')

const retention = await import(resolve(root, '.github', 'scripts', 'backup', 'retention.mjs'))
const backup = await import(resolve(root, '.github', 'scripts', 'backup', 'backup.mjs'))

const oldDailyPath = 'database-backups/daily/2026/01/vyntechs-2026-01-01.dump.age'
const recentDailyPath = 'database-backups/daily/2026/08/vyntechs-2026-08-23.dump.age'

function missingBlobError() {
  return Object.assign(new Error('not found'), { name: 'BlobNotFoundError' })
}

function preconditionError() {
  return Object.assign(new Error('duplicate'), { name: 'BlobPreconditionFailedError' })
}

function privateReadback(ciphertext: Buffer, pathname: string, etag: string) {
  return {
    statusCode: 200,
    stream: Readable.toWeb(Readable.from([ciphertext])),
    blob: { pathname, etag },
  }
}

async function withSyntheticArchive(
  run: (archive: { ciphertext: Buffer; ciphertextPath: string; readbackPath: string }) => Promise<void>,
) {
  const workDir = await mkdtemp(join(tmpdir(), 'vyntechs-backup-test-'))
  const ciphertext = Buffer.from('synthetic encrypted archive only')
  const ciphertextPath = join(workDir, 'input.dump.age')
  const readbackPath = join(workDir, 'readback.dump.age')
  await writeFile(ciphertextPath, ciphertext, { mode: 0o600 })
  try {
    await run({ ciphertext, ciphertextPath, readbackPath })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

describe('encrypted database backup security boundary', () => {
  it('streams a custom PostgreSQL archive to age before any storage call and pins its release', () => {
    expect(backupShell).toMatch(/pg_dump_binary[\s\S]*--format=custom[\s\S]*\|\s*"\$age_binary" --encrypt/)
    expect(backupShell).toContain('--compress=zstd:9')
    expect(backupShell).toContain('database.dump.age')
    expect(installAge).toContain('age-v${AGE_VERSION}-linux-amd64.tar.gz')
    expect(installAge).toContain('bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377')
    expect(installAge).toContain("readonly AGE_VERSION='1.3.1'")
    expect(backupShell).toContain('node "$script_dir/backup.mjs"')
  })

  it('uses the locked SDK package and excludes public GitHub sinks and write permissions', () => {
    expect(backupPackage.dependencies['@vercel/blob']).toBe('2.8.0')
    expect(backupLock.packages['node_modules/@vercel/blob'].version).toBe('2.8.0')
    expect(backupLock.packages['node_modules/@vercel/blob'].integrity).toBe(
      'sha512-Nu+HWKpkgovCh/ezlG7wCVwF7RErTzLzZMbGKFBdGBCbTKyK+s5VXPLl+0+TpNEQPH8AVaGzOpIsXUOtkqylCQ==',
    )
    expect(workflow).toContain('npm ci --ignore-scripts --omit=dev --prefix .github/scripts/backup')
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/)
    expect(workflow).toMatch(/concurrency:\s*\n\s*group: encrypted-database-backup\s*\n\s*cancel-in-progress: false/)
    expect(backupModule).toContain("access: 'private'")
    expect(backupModule).toContain('addRandomSuffix: false')
    expect(backupModule).toContain('allowOverwrite: false')
    expect(workflowSources).not.toMatch(/gh\s+release|upload-artifact|contents:\s*write/i)
    expect(backupSources).not.toMatch(/\.sql\.gz|gzip|gh\s+release|upload-artifact/i)
  })

  it('traverses every retention page before conditionally deleting only expired exact paths', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        blobs: [{ pathname: oldDailyPath, etag: 'etag-old' }],
        hasMore: true,
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: recentDailyPath, etag: 'etag-recent' }],
        hasMore: false,
      })
    const del = vi.fn().mockResolvedValue(undefined)
    const head = vi.fn().mockRejectedValue(missingBlobError())

    await expect(
      retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), { list, del, head }),
    ).resolves.toEqual({ inventoryCount: 2, deletedCount: 1 })
    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: 'database-backups/',
      limit: 1_000,
      mode: 'expanded',
    })
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: 'database-backups/',
      limit: 1_000,
      mode: 'expanded',
      cursor: 'page-2',
    })
    expect(del).toHaveBeenCalledOnce()
    expect(del).toHaveBeenCalledWith(oldDailyPath, { ifMatch: 'etag-old' })
  })

  it('halts unsafe retention inventories before any deletion', async () => {
    const noDelete = vi.fn()
    await expect(
      retention.collectBackupInventory({
        list: vi.fn().mockResolvedValue({
          blobs: [{ pathname: oldDailyPath, etag: 'etag-old' }],
          hasMore: true,
        }),
      }),
    ).rejects.toThrow('omitted its cursor')

    const repeatedCursorList = vi
      .fn()
      .mockResolvedValueOnce({
        blobs: [{ pathname: oldDailyPath, etag: 'etag-old' }],
        hasMore: true,
        cursor: 'next',
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: recentDailyPath, etag: 'etag-recent' }],
        hasMore: true,
        cursor: 'next',
      })
    await expect(
      retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), {
        list: repeatedCursorList,
        del: noDelete,
        head: vi.fn(),
      }),
    ).rejects.toThrow('repeated a cursor')

    for (const [description, blobs, message] of [
      ['duplicate pathnames', [{ pathname: oldDailyPath, etag: 'a' }, { pathname: oldDailyPath, etag: 'b' }], 'duplicate pathname'],
      ['malformed pathnames', [{ pathname: 'database-backups/untrusted.dump.age', etag: 'a' }], 'outside the backup contract'],
      ['missing ETags', [{ pathname: oldDailyPath }], 'without an ETag'],
      ['inventories over the cap', Array.from({ length: 1_001 }, () => ({})), '1,000-object safety cap'],
    ] as const) {
      await expect(
        retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), {
          list: vi.fn().mockResolvedValue({ blobs, hasMore: false }),
          del: noDelete,
          head: vi.fn(),
        }),
      ).rejects.toThrow(message)
      expect(noDelete, description).not.toHaveBeenCalled()
    }
  })

  it('reconciles one ambiguous exact-path retention deletion but stops when the object remains', async () => {
    const list = vi.fn().mockResolvedValue({
      blobs: [{ pathname: oldDailyPath, etag: 'etag-old' }],
      hasMore: false,
    })
    const del = vi.fn().mockRejectedValue(new Error('ambiguous transport result'))
    const head = vi.fn().mockRejectedValue(missingBlobError())

    await expect(
      retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), { list, del, head }),
    ).resolves.toEqual({ inventoryCount: 1, deletedCount: 1 })
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith(oldDailyPath, { ifMatch: 'etag-old' })
    expect(head).toHaveBeenCalledWith(oldDailyPath)

    const presentDel = vi.fn().mockRejectedValue(new Error('ambiguous transport result'))
    const presentHead = vi.fn().mockResolvedValue({ pathname: oldDailyPath, etag: 'etag-old' })
    await expect(
      retention.reconcileDelete(oldDailyPath, 'etag-old', { del: presentDel, head: presentHead }),
    ).rejects.toThrow('outcome remains ambiguous')
    expect(presentDel).toHaveBeenCalledOnce()
    expect(presentHead).toHaveBeenCalledOnce()
  })

  it('uses private immutable upload and verifies matching upload and readback object metadata', async () => {
    await withSyntheticArchive(async ({ ciphertext, ciphertextPath, readbackPath }) => {
      const put = vi.fn(async (pathname, body, options) => {
        for await (const _chunk of body) {
          // Consume the synthetic stream so the mocked upload has the same shape as the SDK call.
        }
        expect(pathname).toBe(recentDailyPath)
        expect(options).toMatchObject({
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          multipart: false,
        })
        return { pathname, etag: 'etag-upload' }
      })
      const get = vi.fn().mockResolvedValue(privateReadback(ciphertext, recentDailyPath, 'etag-upload'))
      const head = vi.fn().mockRejectedValue(missingBlobError())
      const del = vi.fn()

      await backup.uploadAndVerify(
        { ciphertextPath, objectPath: recentDailyPath, readbackPath },
        { put, get, head, del },
      )
      await expect(readFile(readbackPath)).resolves.toEqual(ciphertext)
      expect(get).toHaveBeenCalledWith(recentDailyPath, { access: 'private', useCache: false })
      expect(del).not.toHaveBeenCalled()
    })
  })

  it('conditionally cleans up its own uploaded object when readback verification fails', async () => {
    await withSyntheticArchive(async ({ ciphertextPath, readbackPath }) => {
      const put = vi.fn().mockResolvedValue({ pathname: recentDailyPath, etag: 'etag-upload' })
      const get = vi
        .fn()
        .mockResolvedValue(privateReadback(Buffer.from('different synthetic ciphertext'), recentDailyPath, 'etag-upload'))
      const head = vi.fn().mockRejectedValue(missingBlobError())
      const del = vi.fn().mockResolvedValue(undefined)

      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath },
          { put, get, head, del },
        ),
      ).rejects.toThrow('checksum did not match')
      expect(del).toHaveBeenCalledOnce()
      expect(del).toHaveBeenCalledWith(recentDailyPath, { ifMatch: 'etag-upload' })
      expect(head).toHaveBeenCalledTimes(2)

      const unreadablePut = vi.fn().mockResolvedValue({ pathname: recentDailyPath, etag: 'etag-unreadable' })
      const unreadableHead = vi.fn().mockRejectedValue(missingBlobError())
      const unreadableDel = vi.fn().mockResolvedValue(undefined)
      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath: `${readbackPath}.unreadable` },
          {
            put: unreadablePut,
            get: vi.fn().mockRejectedValue(new Error('provider locator must not escape')),
            head: unreadableHead,
            del: unreadableDel,
          },
        ),
      ).rejects.toThrow('readback could not be completed')
      expect(unreadableDel).toHaveBeenCalledWith(recentDailyPath, { ifMatch: 'etag-unreadable' })
      expect(unreadableHead).toHaveBeenCalledTimes(2)
    })
  })

  it('never deletes after an ambiguous put and accepts only an exact encrypted readback reconciliation', async () => {
    await withSyntheticArchive(async ({ ciphertext, ciphertextPath, readbackPath }) => {
      const put = vi.fn().mockRejectedValue(new Error('transport interrupted'))
      const head = vi
        .fn()
        .mockRejectedValueOnce(missingBlobError())
        .mockResolvedValueOnce({ pathname: recentDailyPath, etag: 'etag-reconciled' })
      const get = vi.fn().mockResolvedValue(privateReadback(ciphertext, recentDailyPath, 'etag-reconciled'))
      const del = vi.fn()

      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath },
          { put, get, head, del },
        ),
      ).resolves.toBeUndefined()
      expect(put).toHaveBeenCalledOnce()
      expect(head).toHaveBeenCalledTimes(2)
      expect(del).not.toHaveBeenCalled()
    })
  })

  it('classifies put conflicts as duplicates and stops unknown put outcomes without deletion', async () => {
    await withSyntheticArchive(async ({ ciphertextPath, readbackPath }) => {
      const conflictPut = vi.fn().mockRejectedValue(preconditionError())
      const conflictHead = vi.fn().mockRejectedValue(missingBlobError())
      const conflictDel = vi.fn()

      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath },
          { put: conflictPut, get: vi.fn(), head: conflictHead, del: conflictDel },
        ),
      ).rejects.toThrow('pathname already exists')
      expect(conflictHead).toHaveBeenCalledOnce()
      expect(conflictDel).not.toHaveBeenCalled()

      const unknownPut = vi.fn().mockRejectedValue(new Error('transport interrupted'))
      const unknownHead = vi
        .fn()
        .mockRejectedValueOnce(missingBlobError())
        .mockResolvedValueOnce({ pathname: recentDailyPath, etag: 'etag-unknown' })
      const unknownDel = vi.fn()
      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath: `${readbackPath}.unknown` },
          {
            put: unknownPut,
            get: vi.fn().mockResolvedValue(privateReadback(Buffer.from('different ciphertext'), recentDailyPath, 'etag-unknown')),
            head: unknownHead,
            del: unknownDel,
          },
        ),
      ).rejects.toThrow('outcome is unknown')
      expect(unknownPut).toHaveBeenCalledOnce()
      expect(unknownHead).toHaveBeenCalledTimes(2)
      expect(unknownDel).not.toHaveBeenCalled()
    })
  })

  it('requires safe cleanup, non-sensitive failure reporting, and the A4/A5 restore gates', () => {
    expect(backupShell).toContain('trap cleanup EXIT')
    expect(backupShell).toContain('rm -rf -- "$backup_work_dir"')
    expect(retentionModule).toContain('MAX_INVENTORY_ITEMS = 1_000')
    expect(retentionModule).toContain('backup inventory contains a duplicate pathname')
    expect(retentionModule).toContain('repeated a cursor')
    expect(retentionModule).toContain('it will not be retried')
    expect(retentionModule).not.toMatch(/delete-store|empty-store|\brm\s+-rf\s+.*database-backups/i)
    expect(failureReport).toContain('No backup was marked successful')
    expect(failureReport).toContain('do not create or publish a plaintext archive')
    expect(restore).toMatch(/key custody and rotation/i)
    expect(restore).toMatch(/never pipe `age` directly into `pg_restore`/i)
    expect(restore).toMatch(/wrong key/i)
    expect(restore).toMatch(/synthetic\/non-production/i)
    expect(restore).toMatch(/securely remove the decrypted archive/i)
    expect(restore).toMatch(/disable the workflow/i)
    expect(restore).toMatch(/A4 synthetic proof/i)
    expect(restore).toMatch(/A5-only/i)
    expect(strategy).toMatch(/VTA-SEC-001/)
  })
})
