import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MutationFingerprintKeyringV1 } from './contracts'

export type MutationFingerprintKeyringEnvV1 = Readonly<{
  SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION?: string
  SHOP_OS_MUTATION_HMAC_KEYS_B64?: string
}>

type PrivateKeyringStateV1 = Readonly<{
  activeVersion: number
  keys: ReadonlyMap<number, Uint8Array>
}>

const DOMAIN = 'vyntechs:ticket-mutation:v1\0'
const MAX_KEY_VERSION = 2_147_483_647
const MAX_KEYRING_TEXT_LENGTH = 4096
const MIN_KEY_BYTES = 32
const MAX_KEY_BYTES = 64
const MAX_KEY_COUNT = 8
const KEY_VERSION_PATTERN = /^[1-9][0-9]*$/
const KEY_ENTRY_PATTERN = /^([1-9][0-9]*):([A-Za-z0-9+/]+={0,2})$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/

const privateKeyrings = new WeakMap<object, PrivateKeyringStateV1>()

function unavailable(): never {
  throw new Error('mutation_keyring_unavailable')
}

function parseKeyVersion(value: unknown): number {
  if (typeof value !== 'string' || !KEY_VERSION_PATTERN.test(value)) return unavailable()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_KEY_VERSION) {
    return unavailable()
  }
  return parsed
}

function parsePrivateState(env: MutationFingerprintKeyringEnvV1): PrivateKeyringStateV1 {
  const parsedKeys = new Map<number, Uint8Array>()
  let succeeded = false

  try {
    const activeVersion = parseKeyVersion(env.SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION)
    const encodedKeyring = env.SHOP_OS_MUTATION_HMAC_KEYS_B64
    if (
      typeof encodedKeyring !== 'string' ||
      encodedKeyring.length === 0 ||
      encodedKeyring.length > MAX_KEYRING_TEXT_LENGTH
    ) {
      return unavailable()
    }

    const entries = encodedKeyring.split(';')
    if (entries.length < 1 || entries.length > MAX_KEY_COUNT) return unavailable()

    let previousVersion = 0
    for (const entry of entries) {
      const match = KEY_ENTRY_PATTERN.exec(entry)
      if (!match) return unavailable()
      const version = parseKeyVersion(match[1])
      if (version <= previousVersion) return unavailable()
      previousVersion = version

      const encodedKey = match[2]
      const decodedKey = Buffer.from(encodedKey, 'base64')
      try {
        if (
          decodedKey.length < MIN_KEY_BYTES ||
          decodedKey.length > MAX_KEY_BYTES ||
          decodedKey.toString('base64') !== encodedKey
        ) {
          return unavailable()
        }
        parsedKeys.set(version, Uint8Array.from(decodedKey))
      } finally {
        decodedKey.fill(0)
      }
    }

    if (!parsedKeys.has(activeVersion)) return unavailable()
    succeeded = true
    return { activeVersion, keys: parsedKeys }
  } finally {
    if (!succeeded) {
      for (const key of parsedKeys.values()) key.fill(0)
      parsedKeys.clear()
    }
  }
}

function getPrivateState(keyring: MutationFingerprintKeyringV1): PrivateKeyringStateV1 {
  if (typeof keyring !== 'object' || keyring === null) return unavailable()
  const state = privateKeyrings.get(keyring)
  if (!state) return unavailable()
  return state
}

function digestWithKey(key: Uint8Array, canonicalPayload: string): Buffer {
  const keyCopy = Buffer.from(key)
  try {
    return createHmac('sha256', keyCopy).update(DOMAIN).update(canonicalPayload).digest()
  } finally {
    keyCopy.fill(0)
  }
}

export function createMutationFingerprintKeyringV1(
  env: MutationFingerprintKeyringEnvV1,
): MutationFingerprintKeyringV1 {
  try {
    const state = parsePrivateState(env)
    const handle = Object.freeze(Object.create(null)) as MutationFingerprintKeyringV1
    privateKeyrings.set(handle, state)
    return handle
  } catch {
    return unavailable()
  }
}

export function signCanonicalMutationPayloadV1(
  keyring: MutationFingerprintKeyringV1,
  canonicalPayload: string,
): Readonly<{ keyVersion: number; digest: string }> {
  const state = getPrivateState(keyring)
  if (typeof canonicalPayload !== 'string') return unavailable()
  const key = state.keys.get(state.activeVersion)
  if (!key) return unavailable()
  const digestBytes = digestWithKey(key, canonicalPayload)
  try {
    return { keyVersion: state.activeVersion, digest: digestBytes.toString('hex') }
  } finally {
    digestBytes.fill(0)
  }
}

export function verifyCanonicalMutationPayloadV1(
  keyring: MutationFingerprintKeyringV1,
  keyVersion: number,
  canonicalPayload: string,
  digest: string,
): 'match' | 'mismatch' | 'verification_unavailable' {
  const state = getPrivateState(keyring)
  if (typeof canonicalPayload !== 'string') return unavailable()
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) return 'mismatch'
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > MAX_KEY_VERSION) {
    return 'verification_unavailable'
  }
  const key = state.keys.get(keyVersion)
  if (!key) return 'verification_unavailable'

  const expectedBytes = digestWithKey(key, canonicalPayload)
  const actualBytes = Buffer.from(digest, 'hex')
  try {
    if (actualBytes.length !== 32 || expectedBytes.length !== actualBytes.length) return 'mismatch'
    return timingSafeEqual(expectedBytes, actualBytes) ? 'match' : 'mismatch'
  } finally {
    expectedBytes.fill(0)
    actualBytes.fill(0)
  }
}
