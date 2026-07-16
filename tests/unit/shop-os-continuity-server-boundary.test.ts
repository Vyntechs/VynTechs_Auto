import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const FOUNDATION_DIRECTORY = resolve(
  process.cwd(),
  'lib/shop-os/continuity/mutation-foundation',
)

function readFoundationSource(fileName: string): string {
  return readFileSync(resolve(FOUNDATION_DIRECTORY, fileName), 'utf8')
}

describe('ShopOS continuity server boundary', () => {
  it('marks both keyring modules server-only and isolates the sole process loader', () => {
    const keyringSource = readFoundationSource('keyring.ts')
    const loaderSource = readFoundationSource('keyring.server.ts')
    const processReaders = readdirSync(FOUNDATION_DIRECTORY)
      .filter((fileName) => fileName.endsWith('.ts'))
      .filter((fileName) => readFoundationSource(fileName).includes('process.env'))

    expect(keyringSource.startsWith("import 'server-only'\n")).toBe(true)
    expect(loaderSource.startsWith("import 'server-only'\n")).toBe(true)
    expect(processReaders).toEqual(['keyring.server.ts'])
    expect(loaderSource).toContain("from './keyring'")
    expect(loaderSource).toContain('createMutationFingerprintKeyringV1({')
    expect(loaderSource).toContain(
      'export function loadMutationFingerprintKeyringFromProcessV1()',
    )
    expect(loaderSource).not.toMatch(/console\.|random|fallback|ANTHROPIC|SUPABASE|STRIPE/i)
  })

  it('keeps every keyring value and the process loader out of the general barrel', () => {
    const barrelPath = resolve(FOUNDATION_DIRECTORY, 'index.ts')
    const contractsSource = readFoundationSource('contracts.ts')
    expect(existsSync(barrelPath)).toBe(true)
    if (!existsSync(barrelPath)) return
    const barrelSource = readFileSync(barrelPath, 'utf8')

    expect(barrelSource).toContain('export type {')
    expect(barrelSource).toContain('MutationFingerprintKeyringV1')
    expect(barrelSource).not.toMatch(/from ['"]\.\/keyring(?:\.server)?['"]/)
    expect(barrelSource).not.toMatch(
      /createMutationFingerprintKeyringV1|signCanonicalMutationPayloadV1|verifyCanonicalMutationPayloadV1|loadMutationFingerprintKeyringFromProcessV1/,
    )
    expect(contractsSource).toMatch(
      /Omit<CanonicalMutationEnvelopeV1, 'operationOrigin' \| 'actorProfileId'>/,
    )
  })

  it('fails a bounded Next client build only at the key-owning server boundary', () => {
    const fixtureDirectory = resolve(
      process.cwd(),
      'tests/fixtures/shop-os-keyring-client-boundary',
    )
    const buildDirectory = resolve(fixtureDirectory, '.next')
    const nextCli = resolve(process.cwd(), 'node_modules/next/dist/bin/next')

    try {
      const result = spawnSync(
        process.execPath,
        [nextCli, 'build', '--webpack', fixtureDirectory],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
          maxBuffer: 1_000_000,
          shell: false,
          timeout: 30_000,
        },
      )
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

      expect(result.error, 'the negative build must not time out or fail to spawn').toBeUndefined()
      expect(result.signal, 'the negative build must finish inside its bound').toBeNull()
      expect(result.status, 'the client boundary build must fail').not.toBe(0)
      expect(output).toMatch(/server-only/i)
      expect(output).toMatch(/Client Component|only available in Server Components|Pages Router/i)
      expect(output).toContain('mutation-foundation/keyring.ts')
      expect(output).toMatch(/app\/page\.tsx|\.\/app\/page/)
      expect(output).not.toMatch(
        /Failed to load next\.config|Invalid next\.config|Cannot find module|Module not found|Type error:|TS\d{4}|does not have a root layout/i,
      )
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 35_000)
})
