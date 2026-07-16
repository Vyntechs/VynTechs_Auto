import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'
import type {
  MutationFingerprintKeyringV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type KeyringEnv = Readonly<{
  SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION?: string
  SHOP_OS_MUTATION_HMAC_KEYS_B64?: string
}>
type SignResult = Readonly<{ keyVersion: number; digest: string }>
type VerificationResult = 'match' | 'mismatch' | 'verification_unavailable'
type KeyringModule = Readonly<Record<string, unknown>>

const DOMAIN = 'vyntechs:ticket-mutation:v1\0'
const KEY_V1 = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1))
const KEY_V2 = Buffer.from(Array.from({ length: 64 }, (_, index) => 255 - index))
const KEY_V1_B64 = KEY_V1.toString('base64')
const KEY_V2_B64 = KEY_V2.toString('base64')

let keyringModule: KeyringModule

beforeAll(async () => {
  keyringModule = (await import(
    '@/lib/shop-os/continuity/mutation-foundation/keyring'
  )) as KeyringModule
})

function requiredFunction<T>(name: string): T {
  const value = keyringModule[name]
  expect(value, `${name} must be exported`).toBeTypeOf('function')
  return value as T
}

function createKeyring(env: KeyringEnv): MutationFingerprintKeyringV1 {
  return requiredFunction<(value: KeyringEnv) => MutationFingerprintKeyringV1>(
    'createMutationFingerprintKeyringV1',
  )(env)
}

function sign(keyring: MutationFingerprintKeyringV1, payload: string): SignResult {
  return requiredFunction<
    (value: MutationFingerprintKeyringV1, canonicalPayload: string) => SignResult
  >('signCanonicalMutationPayloadV1')(keyring, payload)
}

function verify(
  keyring: MutationFingerprintKeyringV1,
  keyVersion: number,
  payload: string,
  digest: string,
): VerificationResult {
  return requiredFunction<
    (
      value: MutationFingerprintKeyringV1,
      version: number,
      canonicalPayload: string,
      candidateDigest: string,
    ) => VerificationResult
  >('verifyCanonicalMutationPayloadV1')(keyring, keyVersion, payload, digest)
}

function env(activeVersion: string, entries: readonly Readonly<[string, string]>[]): KeyringEnv {
  return {
    SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: activeVersion,
    SHOP_OS_MUTATION_HMAC_KEYS_B64: entries
      .map(([version, encoded]) => `${version}:${encoded}`)
      .join(';'),
  }
}

function expectedDigest(key: Uint8Array, payload: string): string {
  return createHmac('sha256', key).update(DOMAIN).update(payload).digest('hex')
}

function keyFragments(key: Uint8Array): string[] {
  const fragments = new Set<string>()
  for (let index = 0; index <= key.length - 4; index += 1) {
    const fragment = Buffer.from(key.subarray(index, index + 4))
    fragments.add(fragment.toString('latin1'))
    fragments.add(fragment.toString('hex'))
    fragments.add(fragment.toString('base64'))
  }
  return [...fragments].filter(Boolean)
}

function expectNoKeyFragments(value: unknown, key: Uint8Array): void {
  const rendered = typeof value === 'string' ? value : inspect(value, { depth: 8 })
  for (const fragment of keyFragments(key)) {
    expect(rendered).not.toContain(fragment)
  }
}

describe('ShopOS mutation keyring grammar', () => {
  it('rejects missing and empty configuration with one stable unavailable error', () => {
    for (const invalid of [
      {},
      { SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1' },
      { SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${KEY_V1_B64}` },
      {
        SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '',
        SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${KEY_V1_B64}`,
      },
      {
        SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
        SHOP_OS_MUTATION_HMAC_KEYS_B64: '',
      },
    ]) {
      expect(() => createKeyring(invalid)).toThrowError('mutation_keyring_unavailable')
    }
  })

  it('rejects every version, ordering, delimiter, count, and active-key violation', () => {
    const nineEntries = Array.from({ length: 9 }, (_, index) => [
      String(index + 1),
      KEY_V1_B64,
    ] as const)
    const invalid: KeyringEnv[] = [
      env('0', [['1', KEY_V1_B64]]),
      env('01', [['1', KEY_V1_B64]]),
      env('-1', [['1', KEY_V1_B64]]),
      env('+1', [['1', KEY_V1_B64]]),
      env(' 1', [['1', KEY_V1_B64]]),
      env('1 ', [['1', KEY_V1_B64]]),
      env('2147483648', [['1', KEY_V1_B64]]),
      env('1', [['0', KEY_V1_B64]]),
      env('1', [['01', KEY_V1_B64]]),
      env('1', [['2147483648', KEY_V1_B64]]),
      env('1', [
        ['1', KEY_V1_B64],
        ['1', KEY_V2_B64],
      ]),
      env('1', [
        ['2', KEY_V2_B64],
        ['1', KEY_V1_B64],
      ]),
      env('2', [
        ['10', KEY_V2_B64],
        ['2', KEY_V1_B64],
      ]),
      env('3', [
        ['1', KEY_V1_B64],
        ['2', KEY_V2_B64],
      ]),
      env('1', nineEntries),
      {
        SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
        SHOP_OS_MUTATION_HMAC_KEYS_B64: `;1:${KEY_V1_B64}`,
      },
      {
        SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
        SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${KEY_V1_B64};`,
      },
      {
        SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
        SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${KEY_V1_B64};;2:${KEY_V2_B64}`,
      },
      {
        SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
        SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${KEY_V1_B64}${'A'.repeat(4097)}`,
      },
    ]

    for (const candidate of invalid) {
      expect(() => createKeyring(candidate)).toThrowError('mutation_keyring_unavailable')
    }
  })

  it('rejects invalid, noncanonical, short, and oversized base64 keys', () => {
    const invalidKeys = [
      '****',
      KEY_V1_B64.slice(0, -1),
      `${KEY_V1_B64}=`,
      ` ${KEY_V1_B64}`,
      `${KEY_V1_B64} `,
      Buffer.alloc(31, 1).toString('base64'),
      Buffer.alloc(65, 1).toString('base64'),
    ]

    for (const invalidKey of invalidKeys) {
      expect(() => createKeyring(env('1', [['1', invalidKey]]))).toThrowError(
        'mutation_keyring_unavailable',
      )
    }
  })

  it('accepts numeric ascending order rather than lexicographic order', () => {
    const keyring = createKeyring(
      env('10', [
        ['2', KEY_V1_B64],
        ['10', KEY_V2_B64],
      ]),
    )

    expect(sign(keyring, '{"ok":true}').keyVersion).toBe(10)
  })
})

describe('ShopOS mutation keyring privacy and HMAC behavior', () => {
  it('uses the exact domain, active version, and defensive key copies', () => {
    const sourceKey = Buffer.from(KEY_V1)
    const mutableEnv = {
      SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
      SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${sourceKey.toString('base64')}`,
    }
    const keyring = createKeyring(mutableEnv)
    sourceKey.fill(0)
    mutableEnv.SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION = '2'
    mutableEnv.SHOP_OS_MUTATION_HMAC_KEYS_B64 = `2:${KEY_V2_B64}`
    const payload = '{"schemaVersion":1}'

    expect(sign(keyring, payload)).toEqual({
      keyVersion: 1,
      digest: expectedDigest(KEY_V1, payload),
    })
  })

  it('retains historical keys across activation and fails closed when one is unavailable', () => {
    const payload = '{"payload":"original"}'
    const v1Only = createKeyring(env('1', [['1', KEY_V1_B64]]))
    const persistedV1 = sign(v1Only, payload)
    const v2WithHistory = createKeyring(
      env('2', [
        ['1', KEY_V1_B64],
        ['2', KEY_V2_B64],
      ]),
    )
    const v2WithoutHistory = createKeyring(env('2', [['2', KEY_V2_B64]]))

    expect(sign(v2WithHistory, payload).keyVersion).toBe(2)
    expect(verify(v2WithHistory, 1, payload, persistedV1.digest)).toBe('match')
    expect(verify(v2WithHistory, 1, `${payload}changed`, persistedV1.digest)).toBe('mismatch')
    expect(verify(v2WithoutHistory, 1, payload, persistedV1.digest)).toBe(
      'verification_unavailable',
    )
  })

  it('rejects malformed digests before comparison and compares exact bytes', () => {
    const payload = '{"payload":true}'
    const keyring = createKeyring(env('1', [['1', KEY_V1_B64]]))
    const persisted = sign(keyring, payload)

    expect(verify(keyring, 1, payload, persisted.digest)).toBe('match')
    expect(verify(keyring, 1, `${payload}x`, persisted.digest)).toBe('mismatch')
    for (const malformed of [
      '',
      persisted.digest.slice(1),
      `${persisted.digest}00`,
      persisted.digest.toUpperCase(),
      'g'.repeat(64),
    ]) {
      expect(verify(keyring, 999, payload, malformed)).toBe('mismatch')
    }
  })

  it('exposes an own-property-free opaque handle with no reflection or serialization path', () => {
    const keyring = createKeyring(
      env('2', [
        ['1', KEY_V1_B64],
        ['2', KEY_V2_B64],
      ]),
    )

    expect(Reflect.ownKeys(keyring)).toEqual([])
    expect(Object.getOwnPropertyDescriptors(keyring)).toEqual({})
    expect(Object.getPrototypeOf(keyring)).toBeNull()
    expect(Object.isFrozen(keyring)).toBe(true)
    expect(JSON.stringify(keyring)).toBe('{}')
    expect((keyring as unknown as { activeVersion?: unknown }).activeVersion).toBeUndefined()
    expect((keyring as unknown as { keys?: unknown }).keys).toBeUndefined()
    expect((keyring as unknown as { [Symbol.iterator]?: unknown })[Symbol.iterator]).toBeUndefined()
    expectNoKeyFragments(keyring, KEY_V1)
    expectNoKeyFragments(keyring, KEY_V2)
  })

  it('keeps known results stable after callers mutate every returned object field', () => {
    const keyring = createKeyring(env('1', [['1', KEY_V1_B64]]))
    const payload = '{"immutable":true}'
    const first = sign(keyring, payload)
    const expected = { ...first }

    ;(first as { keyVersion: number; digest: string }).keyVersion = 99
    ;(first as { keyVersion: number; digest: string }).digest = '0'.repeat(64)

    expect(sign(keyring, payload)).toEqual(expected)
    expect(verify(keyring, expected.keyVersion, payload, expected.digest)).toBe('match')
  })

  it('uses the same stable unavailable contract for forged and foreign handles', async () => {
    const forged = Object.freeze(Object.create(null)) as MutationFingerprintKeyringV1
    expect(() => sign(forged, '{}')).toThrowError('mutation_keyring_unavailable')
    expect(() => verify(forged, 1, '{}', '0'.repeat(64))).toThrowError(
      'mutation_keyring_unavailable',
    )

    const firstModule = await import('@/lib/shop-os/continuity/mutation-foundation/keyring')
    const foreign = firstModule.createMutationFingerprintKeyringV1(
      env('1', [['1', KEY_V1_B64]]),
    )
    vi.resetModules()
    const secondModule = await import('@/lib/shop-os/continuity/mutation-foundation/keyring')
    expect(() => secondModule.signCanonicalMutationPayloadV1(foreign, '{}')).toThrowError(
      'mutation_keyring_unavailable',
    )
  })

  it('never writes or throws key/body fragments on invalid input', () => {
    const secretBody = 'do-not-echo-body'
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const signed = sign(createKeyring(env('1', [['1', KEY_V1_B64]])), secretBody)
      let capturedError: unknown
      try {
        createKeyring(env('1', [['1', `${KEY_V1_B64}not-canonical`]]))
      } catch (error) {
        capturedError = error
      }

      expect(String(capturedError)).toBe('Error: mutation_keyring_unavailable')
      expect(String(capturedError)).not.toContain(secretBody)
      expect(inspect(signed)).not.toContain(secretBody)
      expectNoKeyFragments(capturedError, KEY_V1)
      expectNoKeyFragments(signed, KEY_V1)
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
    }
  })
})
