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
const objectPathModule = read('.github', 'scripts', 'backup', 'object-path.mjs')
const retentionModule = read('.github', 'scripts', 'backup', 'retention.mjs')
const signedMutationModule = read('.github', 'scripts', 'backup', 'signed-mutations.mjs')
const failureReport = read('.github', 'scripts', 'backup', 'report-failure.sh')
const backupPackage = JSON.parse(read('.github', 'scripts', 'backup', 'package.json'))
const backupLock = JSON.parse(read('.github', 'scripts', 'backup', 'package-lock.json'))
const restore = read('docs', 'RESTORE.md')
const strategy = read('docs', 'strategy', '2026-07-10-shop-os-spec-and-phased-plan.md')
const backupSources = [
  workflow,
  installAge,
  backupShell,
  backupModule,
  objectPathModule,
  retentionModule,
  signedMutationModule,
  failureReport,
].join('\n')

const retention = await import(resolve(root, '.github', 'scripts', 'backup', 'retention.mjs'))
const backup = await import(resolve(root, '.github', 'scripts', 'backup', 'backup.mjs'))
const objectPaths = await import(resolve(root, '.github', 'scripts', 'backup', 'object-path.mjs'))

const oldDailyPath = 'database-backups/daily/vyntechs-run-1001.dump.age'
const recentDailyPath = 'database-backups/daily/vyntechs-run-1002.dump.age'
const oldManualPath = 'database-backups/manual/vyntechs-run-2001.dump.age'

function missingBlobError() {
  return Object.assign(new Error('not found'), { name: 'BlobNotFoundError' })
}

function privateReadback(ciphertext: Buffer, pathname: string, etag: string) {
  return {
    statusCode: 200,
    stream: Readable.toWeb(Readable.from([ciphertext])),
    blob: { pathname, etag },
  }
}

type SignedMutationClient = {
  issueSignedToken: ReturnType<typeof vi.fn>
  presignUrl: ReturnType<typeof vi.fn>
  head: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

function signedMutationClient(overrides: Partial<SignedMutationClient> = {}): SignedMutationClient {
  return {
    issueSignedToken: vi.fn().mockResolvedValue({
      delegationToken: 'delegation-token',
      clientSigningToken: 'client-signing-token',
      validUntil: Date.now() + 60_000,
    }),
    presignUrl: vi.fn().mockResolvedValue({ presignedUrl: 'https://signed.example.test/blob' }),
    head: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    ...overrides,
  }
}

function successfulPut(pathname: string, etag: string) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ pathname, etag }),
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
  it('streams a custom PostgreSQL archive to age before any storage call and derives stable invocation keys', () => {
    expect(backupShell).toMatch(/pg_dump_binary[\s\S]*--format=custom[\s\S]*\|\s*"\$age_binary" --encrypt/)
    expect(backupShell).toContain('--compress=zstd:9')
    expect(backupShell).toContain('database.dump.age')
    expect(installAge).toContain('age-v${AGE_VERSION}-linux-amd64.tar.gz')
    expect(installAge).toContain('bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377')
    expect(installAge).toContain("readonly AGE_VERSION='1.3.1'")
    expect(backupShell).toContain('node "$script_dir/object-path.mjs"')
    expect(backupShell).not.toContain('date -u')
    expect(restore).toContain('database-backups/daily/vyntechs-run-<GITHUB_RUN_ID>.dump.age')
    expect(restore).toContain('database-backups/manual/vyntechs-run-<GITHUB_RUN_ID>.dump.age')
    expect(restore).toContain('Blob `uploadedAt`')

    for (const [eventName, expectedPath] of [
      ['schedule', 'database-backups/daily/vyntechs-run-12345.dump.age'],
      ['workflow_dispatch', 'database-backups/manual/vyntechs-run-12345.dump.age'],
    ] as const) {
      expect(objectPaths.deriveBackupPath(eventName, '12345')).toBe(expectedPath)
      expect(objectPaths.deriveBackupPath(eventName, '12345')).toBe(expectedPath)
      expect(objectPaths.deriveBackupPath(eventName, '12346')).not.toBe(expectedPath)
    }
    expect(() => objectPaths.deriveBackupPath('push', '12345')).toThrow('not authorized')
    expect(() => objectPaths.deriveBackupPath('schedule', '012345')).toThrow('invalid')
    expect(() => retention.parseBackupPath('database-backups/manual/vyntechs-run-02001.dump.age')).toThrow(
      'outside the backup contract',
    )
  })

  it('uses the locked SDK package for reads and exact signed native mutations without public GitHub sinks', () => {
    expect(backupPackage.dependencies['@vercel/blob']).toBe('2.8.0')
    expect(backupLock.packages['node_modules/@vercel/blob'].version).toBe('2.8.0')
    expect(backupLock.packages['node_modules/@vercel/blob'].integrity).toBe(
      'sha512-Nu+HWKpkgovCh/ezlG7wCVwF7RErTzLzZMbGKFBdGBCbTKyK+s5VXPLl+0+TpNEQPH8AVaGzOpIsXUOtkqylCQ==',
    )
    expect(workflow).toContain('npm ci --ignore-scripts --omit=dev --prefix .github/scripts/backup')
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/)
    expect(workflow).toMatch(/concurrency:\s*\n\s*group: encrypted-database-backup\s*\n\s*cancel-in-progress: false/)
    expect(backupModule).toContain('createRequire(import.meta.url)')
    expect(backupModule).not.toMatch(/^\s*import\s+.*['"]@vercel\/blob['"]/m)
    expect(retentionModule).not.toMatch(/^\s*import\s+.*['"]@vercel\/blob['"]/m)
    expect(backupModule).not.toMatch(/client\.put|client\.del/)
    expect(retentionModule).not.toMatch(/client\.put|client\.del/)
    expect(signedMutationModule).toContain("access: 'private'")
    expect(signedMutationModule).toContain('operations: [operation]')
    expect(signedMutationModule).toContain('allowOverwrite: false')
    expect(signedMutationModule).toContain('addRandomSuffix: false')
    expect(signedMutationModule).toContain("redirect: 'error'")
    expect(signedMutationModule).toContain("operation === 'delete'")
    expect(backupSources).not.toContain('VERCEL_BLOB_RETRIES')
    expect(workflowSources).not.toMatch(/gh\s+release|upload-artifact|contents:\s*write/i)
    expect(backupSources).not.toMatch(/\.sql\.gz|gzip|gh\s+release|upload-artifact/i)
  })

  it('traverses every retention page and deletes only uploadedAt-expired exact paths with one signed request', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        blobs: [{ pathname: oldDailyPath, etag: 'etag-old', uploadedAt: new Date('2026-05-01T00:00:00Z') }],
        hasMore: true,
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: recentDailyPath, etag: 'etag-recent', uploadedAt: new Date('2026-08-23T00:00:00Z') }],
        hasMore: false,
      })
    const head = vi.fn().mockRejectedValue(missingBlobError())
    const client = signedMutationClient({ list, head })
    const mutationFetch = vi.fn().mockResolvedValue({ ok: true })

    await expect(
      retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), client, mutationFetch),
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
    expect(mutationFetch).toHaveBeenCalledOnce()
    expect(mutationFetch).toHaveBeenCalledWith('https://signed.example.test/blob', {
      method: 'DELETE',
      redirect: 'error',
    })
    expect(client.issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({
      pathname: oldDailyPath,
      operations: ['delete'],
    }))
    expect(client.presignUrl).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      access: 'private',
      pathname: oldDailyPath,
      operation: 'delete',
      ifMatch: 'etag-old',
    }))
    expect(head).toHaveBeenCalledOnce()
  })

  it('halts malformed retention inventory before any deletion', async () => {
    const mutationFetch = vi.fn()
    const noDeleteClient = () => signedMutationClient({ head: vi.fn() })

    await expect(
      retention.collectBackupInventory({
        list: vi.fn().mockResolvedValue({
          blobs: [{ pathname: oldDailyPath, etag: 'etag-old', uploadedAt: new Date('2026-01-01T00:00:00Z') }],
          hasMore: true,
        }),
      }),
    ).rejects.toThrow('omitted its cursor')

    const repeatedCursorList = vi
      .fn()
      .mockResolvedValueOnce({
        blobs: [{ pathname: oldDailyPath, etag: 'etag-old', uploadedAt: new Date('2026-01-01T00:00:00Z') }],
        hasMore: true,
        cursor: 'next',
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: recentDailyPath, etag: 'etag-recent', uploadedAt: new Date('2026-08-01T00:00:00Z') }],
        hasMore: true,
        cursor: 'next',
      })
    await expect(
      retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), { ...noDeleteClient(), list: repeatedCursorList }, mutationFetch),
    ).rejects.toThrow('repeated a cursor')

    for (const [description, blobs, message] of [
      ['duplicate pathnames', [
        { pathname: oldDailyPath, etag: 'a', uploadedAt: new Date('2026-01-01T00:00:00Z') },
        { pathname: oldDailyPath, etag: 'b', uploadedAt: new Date('2026-01-02T00:00:00Z') },
      ], 'duplicate pathname'],
      ['malformed pathnames', [{ pathname: 'database-backups/untrusted.dump.age', etag: 'a', uploadedAt: new Date() }], 'outside the backup contract'],
      ['missing ETags', [{ pathname: oldDailyPath, uploadedAt: new Date() }], 'without an ETag'],
      ['missing uploadedAt', [{ pathname: oldDailyPath, etag: 'a' }], 'without a valid uploadedAt'],
      ['inventories over the cap', Array.from({ length: 1_001 }, () => ({})), '1,000-object safety cap'],
    ] as const) {
      await expect(
        retention.retainExpiredBackups(new Date('2026-08-23T07:00:00Z'), {
          ...noDeleteClient(),
          list: vi.fn().mockResolvedValue({ blobs, hasMore: false }),
        }, mutationFetch),
      ).rejects.toThrow(message)
      expect(mutationFetch, description).not.toHaveBeenCalled()
    }
  })

  it('makes one conditional retention delete and stops when a changed-ETag object remains', async () => {
    const client = signedMutationClient({
      head: vi.fn().mockResolvedValue({ pathname: oldManualPath, etag: 'competitor-etag' }),
    })
    const mutationFetch = vi.fn().mockRejectedValue(new Error('transport interrupted'))

    await expect(
      retention.reconcileDelete(oldManualPath, 'owned-etag', client, mutationFetch),
    ).rejects.toThrow('outcome remains ambiguous')
    expect(mutationFetch).toHaveBeenCalledOnce()
    expect(client.head).toHaveBeenCalledOnce()
    expect(client.presignUrl).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      operation: 'delete',
      pathname: oldManualPath,
      ifMatch: 'owned-etag',
    }))
  })

  it('uses one private immutable signed PUT and verifies matching upload and readback metadata', async () => {
    await withSyntheticArchive(async ({ ciphertext, ciphertextPath, readbackPath }) => {
      const client = signedMutationClient({
        head: vi.fn().mockRejectedValue(missingBlobError()),
        get: vi.fn().mockResolvedValue(privateReadback(ciphertext, recentDailyPath, 'etag-upload')),
      })
      const mutationFetch = vi.fn().mockResolvedValue(successfulPut(recentDailyPath, 'etag-upload'))

      await backup.uploadAndVerify(
        { ciphertextPath, objectPath: recentDailyPath, readbackPath },
        client,
        mutationFetch,
      )
      await expect(readFile(readbackPath)).resolves.toEqual(ciphertext)
      expect(mutationFetch).toHaveBeenCalledOnce()
      expect(mutationFetch).toHaveBeenCalledWith('https://signed.example.test/blob', expect.objectContaining({
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        duplex: 'half',
        redirect: 'error',
      }))
      expect(client.issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({
        pathname: recentDailyPath,
        operations: ['put'],
        allowedContentTypes: ['application/octet-stream'],
        maximumSizeInBytes: ciphertext.length,
      }))
      expect(client.presignUrl).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        access: 'private',
        pathname: recentDailyPath,
        operation: 'put',
        allowOverwrite: false,
        addRandomSuffix: false,
      }))
      expect(client.get).toHaveBeenCalledWith(recentDailyPath, { access: 'private', useCache: false })
    })
  })

  it('fails closed on an existing deterministic pathname before signing or mutating', async () => {
    await withSyntheticArchive(async ({ ciphertextPath, readbackPath }) => {
      const client = signedMutationClient({
        head: vi.fn().mockResolvedValue({ pathname: recentDailyPath, etag: 'existing-etag' }),
      })
      const mutationFetch = vi.fn()

      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath },
          client,
          mutationFetch,
        ),
      ).rejects.toThrow('pathname already exists')
      expect(client.issueSignedToken).not.toHaveBeenCalled()
      expect(client.presignUrl).not.toHaveBeenCalled()
      expect(mutationFetch).not.toHaveBeenCalled()
    })
  })

  it('reconciles exactly once after commit/lost-response, precondition, and malformed PUT outcomes', async () => {
    await withSyntheticArchive(async ({ ciphertext, ciphertextPath, readbackPath }) => {
      const runReconciliation = async (mutationFetch: ReturnType<typeof vi.fn>, suffix: string) => {
        const client = signedMutationClient({
          head: vi
            .fn()
            .mockRejectedValueOnce(missingBlobError())
            .mockResolvedValueOnce({ pathname: recentDailyPath, etag: 'etag-reconciled' }),
          get: vi.fn().mockResolvedValue(privateReadback(ciphertext, recentDailyPath, 'etag-reconciled')),
        })
        await expect(
          backup.uploadAndVerify(
            { ciphertextPath, objectPath: recentDailyPath, readbackPath: `${readbackPath}-${suffix}` },
            client,
            mutationFetch,
          ),
        ).resolves.toBeUndefined()
        expect(mutationFetch).toHaveBeenCalledOnce()
        expect(client.head).toHaveBeenCalledTimes(2)
        expect(client.get).toHaveBeenCalledOnce()
      }

      await runReconciliation(vi.fn().mockRejectedValue(new Error('lost response')), 'lost')
      await runReconciliation(vi.fn().mockResolvedValue({ ok: false, status: 412 }), 'precondition')
      await runReconciliation(
        vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ pathname: recentDailyPath }) }),
        'malformed',
      )
    })
  })

  it('cleans up only its well-formed ETag-owned upload after readback failure', async () => {
    await withSyntheticArchive(async ({ ciphertextPath, readbackPath }) => {
      const client = signedMutationClient({
        head: vi.fn().mockRejectedValue(missingBlobError()),
        get: vi.fn().mockResolvedValue(privateReadback(Buffer.from('different ciphertext'), recentDailyPath, 'etag-upload')),
      })
      const mutationFetch = vi
        .fn()
        .mockResolvedValueOnce(successfulPut(recentDailyPath, 'etag-upload'))
        .mockResolvedValueOnce({ ok: true })

      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath },
          client,
          mutationFetch,
        ),
      ).rejects.toThrow('checksum did not match')
      expect(mutationFetch).toHaveBeenCalledTimes(2)
      expect(client.head).toHaveBeenCalledTimes(2)
      expect(client.presignUrl).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
        operation: 'delete',
        pathname: recentDailyPath,
        ifMatch: 'etag-upload',
      }))

      const changedEtagClient = signedMutationClient({
        head: vi
          .fn()
          .mockRejectedValueOnce(missingBlobError())
          .mockResolvedValueOnce({ pathname: recentDailyPath, etag: 'competitor-etag' }),
        get: vi.fn().mockResolvedValue(privateReadback(Buffer.from('different ciphertext'), recentDailyPath, 'etag-upload')),
      })
      const changedEtagFetch = vi
        .fn()
        .mockResolvedValueOnce(successfulPut(recentDailyPath, 'etag-upload'))
        .mockResolvedValueOnce({ ok: false, status: 412 })
      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath: `${readbackPath}.competitor` },
          changedEtagClient,
          changedEtagFetch,
        ),
      ).rejects.toThrow('cleanup outcome remains unknown')
      expect(changedEtagFetch).toHaveBeenCalledTimes(2)
      expect(changedEtagClient.head).toHaveBeenCalledTimes(2)
    })
  })

  it('stops unknown precondition reconciliation without deleting a competing object', async () => {
    await withSyntheticArchive(async ({ ciphertextPath, readbackPath }) => {
      const client = signedMutationClient({
        head: vi
          .fn()
          .mockRejectedValueOnce(missingBlobError())
          .mockResolvedValueOnce({ pathname: recentDailyPath, etag: 'competitor-etag' }),
        get: vi.fn().mockResolvedValue(privateReadback(Buffer.from('different ciphertext'), recentDailyPath, 'competitor-etag')),
      })
      const mutationFetch = vi.fn().mockResolvedValue({ ok: false, status: 412 })

      await expect(
        backup.uploadAndVerify(
          { ciphertextPath, objectPath: recentDailyPath, readbackPath },
          client,
          mutationFetch,
        ),
      ).rejects.toThrow('outcome is unknown')
      expect(mutationFetch).toHaveBeenCalledOnce()
      expect(client.head).toHaveBeenCalledTimes(2)
      expect(client.issueSignedToken).toHaveBeenCalledOnce()
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
