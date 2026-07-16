import type {
  CandidateBindingV1,
  CanonicalMutationEnvelopeV1,
  CanonicalValue,
  MutationFingerprintKeyringV1,
  RevisionDecimal,
  TicketCreatingEnvelopeBaseV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { createMutationFingerprintKeyringV1 } from '@/lib/shop-os/continuity/mutation-foundation/keyring'
import { beforeAll, describe, expect, it } from 'vitest'

const SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n
const KEY_V1_B64 = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString(
  'base64',
)
const KEY_V2_B64 = Buffer.from(Array.from({ length: 32 }, (_, index) => 255 - index)).toString(
  'base64',
)

type CanonicalModule = Readonly<Record<string, unknown>>

let canonicalModule: CanonicalModule

beforeAll(async () => {
  canonicalModule = (await import(
    '@/lib/shop-os/continuity/mutation-foundation/canonical'
  )) as CanonicalModule
})

function requiredFunction<T>(name: string): T {
  const value = canonicalModule[name]
  expect(value, `${name} must be exported`).toBeTypeOf('function')
  return value as T
}

describe('ShopOS continuity revision transport', () => {
  it('parses only canonical nonnegative signed-bigint decimal strings', () => {
    const parseRevisionDecimal = requiredFunction<(value: unknown) => bigint>(
      'parseRevisionDecimal',
    )

    expect(parseRevisionDecimal('0')).toBe(0n)
    expect(parseRevisionDecimal('42')).toBe(42n)
    expect(parseRevisionDecimal(SIGNED_BIGINT_MAX.toString())).toBe(SIGNED_BIGINT_MAX)

    for (const invalid of [
      undefined,
      null,
      0,
      1n,
      '',
      '00',
      '01',
      '-1',
      '+1',
      ' 1',
      '1 ',
      '1.0',
      (SIGNED_BIGINT_MAX + 1n).toString(),
    ]) {
      expect(() => parseRevisionDecimal(invalid)).toThrowError('invalid_revision_decimal')
    }
  })

  it('serializes only nonnegative signed-bigint values', () => {
    const serializeRevisionDecimal = requiredFunction<(value: bigint) => RevisionDecimal>(
      'serializeRevisionDecimal',
    )

    expect(serializeRevisionDecimal(0n)).toBe('0')
    expect(serializeRevisionDecimal(SIGNED_BIGINT_MAX)).toBe(SIGNED_BIGINT_MAX.toString())

    for (const invalid of [-1n, SIGNED_BIGINT_MAX + 1n, 1] as unknown[]) {
      expect(() => serializeRevisionDecimal(invalid as bigint)).toThrowError(
        'invalid_revision_decimal',
      )
    }
  })

  it('uses one privacy-safe not-found domain error with no row identifier input', () => {
    const error = new ShopOsMutationNotFound()

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ShopOsMutationNotFound')
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('shop_os_mutation_not_found')
  })
})

describe('ShopOS strict canonical JSON', () => {
  it('sorts object keys, preserves array order, and supports repeated acyclic values', () => {
    const canonicalJsonV1 = requiredFunction<(value: CanonicalValue) => string>(
      'canonicalJsonV1',
    )
    const shared = { z: null, a: true }
    const nullPrototype = Object.assign(Object.create(null) as Record<string, CanonicalValue>, {
      beta: 2,
      alpha: 1,
    })

    expect(
      canonicalJsonV1({
        z: [3, 2, 1],
        sharedRight: shared,
        sharedLeft: shared,
        nullPrototype,
        a: 'value',
        negativeZero: -0,
      }),
    ).toBe(
      '{"a":"value","negativeZero":0,"nullPrototype":{"alpha":1,"beta":2},"sharedLeft":{"a":true,"z":null},"sharedRight":{"a":true,"z":null},"z":[3,2,1]}',
    )
    expect(canonicalJsonV1(['first', 'second'])).not.toBe(
      canonicalJsonV1(['second', 'first']),
    )
  })

  it('rejects hostile, ambiguous, non-JSON, and prototype-pollution values', () => {
    const canonicalJsonV1 = requiredFunction<(value: CanonicalValue) => string>(
      'canonicalJsonV1',
    )
    const sparse = new Array(2)
    sparse[1] = 'present'
    const withSymbolKey = { safe: true }
    Object.defineProperty(withSymbolKey, Symbol('hidden'), { value: 'secret', enumerable: true })
    const nonEnumerable = { safe: true }
    Object.defineProperty(nonEnumerable, 'hidden', { value: 'secret', enumerable: false })
    const pollutedKey = { safe: true } as Record<string, unknown>
    Object.defineProperty(pollutedKey, '__proto__', { value: 'secret', enumerable: true })
    const extraArrayProperty = ['safe'] as string[] & { extra?: string }
    extraArrayProperty.extra = 'secret'
    const symbolArrayProperty = ['safe']
    Object.defineProperty(symbolArrayProperty, Symbol('hidden'), {
      value: 'secret',
      enumerable: true,
    })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let getterInvocations = 0
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        getterInvocations += 1
        return 'must-not-run'
      },
    })
    class CustomValue {
      value = 'secret'
    }

    const invalidValues: unknown[] = [
      undefined,
      1n,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      Symbol('secret'),
      () => 'secret',
      sparse,
      withSymbolKey,
      nonEnumerable,
      pollutedKey,
      { constructor: 'secret' },
      { prototype: 'secret' },
      extraArrayProperty,
      symbolArrayProperty,
      cyclic,
      accessor,
      new Date(),
      new Map(),
      new Set(),
      new CustomValue(),
    ]

    for (const invalid of invalidValues) {
      expect(() => canonicalJsonV1(invalid as CanonicalValue)).toThrowError(
        'invalid_canonical_value',
      )
    }
    expect(getterInvocations).toBe(0)
  })

  it('fails closed without exposing hostile keys or values in errors', () => {
    const canonicalJsonV1 = requiredFunction<(value: CanonicalValue) => string>(
      'canonicalJsonV1',
    )
    const secret = 'do-not-echo-canonical-input'
    const hostile = new Proxy(
      { [secret]: true },
      {
        ownKeys() {
          throw new Error(secret)
        },
      },
    )

    expect(() => canonicalJsonV1(hostile)).toThrowError('invalid_canonical_value')
    try {
      canonicalJsonV1(hostile)
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })

  it('reads array length and elements only through data descriptors', () => {
    const canonicalJsonV1 = requiredFunction<(value: CanonicalValue) => string>(
      'canonicalJsonV1',
    )
    let propertyReads = 0
    const guarded = new Proxy(['safe'], {
      get(target, property, receiver) {
        propertyReads += 1
        return Reflect.get(target, property, receiver)
      },
    })

    expect(canonicalJsonV1(guarded)).toBe('["safe"]')
    expect(propertyReads).toBe(0)
  })
})

describe('ShopOS candidate binding normalization', () => {
  it('lowercases UUIDs, canonicalizes revisions, sorts copies, and preserves inputs', () => {
    const normalizeCandidateBindingsV1 = requiredFunction<
      (value: readonly CandidateBindingV1[]) => readonly CandidateBindingV1[]
    >('normalizeCandidateBindingsV1')
    const candidates = [
      {
        ticketId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
        continuityRevision: '2' as RevisionDecimal,
      },
      {
        ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        continuityRevision: '1' as RevisionDecimal,
      },
    ] as const
    const before = structuredClone(candidates)

    expect(normalizeCandidateBindingsV1(candidates)).toEqual([
      {
        ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        continuityRevision: '1',
      },
      {
        ticketId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        continuityRevision: '2',
      },
    ])
    expect(candidates).toEqual(before)
  })

  it('rejects duplicates after case normalization and invalid bindings without echoing them', () => {
    const normalizeCandidateBindingsV1 = requiredFunction<
      (value: readonly CandidateBindingV1[]) => readonly CandidateBindingV1[]
    >('normalizeCandidateBindingsV1')
    const duplicate = [
      {
        ticketId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
        continuityRevision: '1' as RevisionDecimal,
      },
      {
        ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        continuityRevision: '2' as RevisionDecimal,
      },
    ]

    expect(() => normalizeCandidateBindingsV1(duplicate)).toThrowError(
      'invalid_candidate_bindings',
    )
    for (const invalid of [
      [{ ticketId: 'not-a-uuid', continuityRevision: '1' }],
      [{ ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', continuityRevision: '01' }],
      [{ ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', continuityRevision: '1', extra: 1 }],
    ]) {
      expect(() =>
        normalizeCandidateBindingsV1(invalid as unknown as readonly CandidateBindingV1[]),
      ).toThrowError('invalid_candidate_bindings')
    }
    try {
      normalizeCandidateBindingsV1([
        {
          ticketId: 'do-not-echo-invalid-ticket',
          continuityRevision: '1' as RevisionDecimal,
        },
      ])
    } catch (error) {
      expect(String(error)).toBe('Error: invalid_candidate_bindings')
    }
  })

  it('normalizes candidate arrays without invoking property reads', () => {
    const normalizeCandidateBindingsV1 = requiredFunction<
      (value: readonly CandidateBindingV1[]) => readonly CandidateBindingV1[]
    >('normalizeCandidateBindingsV1')
    let propertyReads = 0
    const guarded = new Proxy(
      [
        {
          ticketId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
          continuityRevision: '1' as RevisionDecimal,
        },
      ],
      {
        get(target, property, receiver) {
          propertyReads += 1
          return Reflect.get(target, property, receiver)
        },
      },
    )

    expect(normalizeCandidateBindingsV1(guarded)).toEqual([
      {
        ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        continuityRevision: '1',
      },
    ])
    expect(propertyReads).toBe(0)
  })
})

function fingerprintKeyring(
  activeVersion = 1,
  entries: readonly Readonly<[number, string]>[] = [[1, KEY_V1_B64]],
): MutationFingerprintKeyringV1 {
  return createMutationFingerprintKeyringV1({
    SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: String(activeVersion),
    SHOP_OS_MUTATION_HMAC_KEYS_B64: entries
      .map(([version, key]) => `${version}:${key}`)
      .join(';'),
  })
}

function envelope(
  overrides: Partial<CanonicalMutationEnvelopeV1> = {},
): CanonicalMutationEnvelopeV1 {
  return {
    schemaVersion: 1,
    mutationKind: 'append_work_items',
    operationOrigin: null,
    actorProfileId: '11111111-1111-1111-1111-111111111111',
    target: {
      ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      mode: 'append',
    },
    candidates: [
      {
        ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        continuityRevision: '3' as RevisionDecimal,
      },
      {
        ticketId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        continuityRevision: '7' as RevisionDecimal,
      },
    ],
    payload: {
      workItems: [
        { id: 'first', kind: 'repair' },
        { id: 'second', kind: 'maintenance' },
      ],
      note: 'customer approved',
    },
    ...overrides,
  }
}

describe('ShopOS canonical mutation fingerprints', () => {
  it('is key-order and candidate-permutation invariant without mutating the envelope', () => {
    const createCanonicalMutationFingerprintV1 = requiredFunction<
      (
        value: CanonicalMutationEnvelopeV1,
        keyring: MutationFingerprintKeyringV1,
      ) => Readonly<{ keyVersion: number; digest: string }>
    >('createCanonicalMutationFingerprintV1')
    const keyring = fingerprintKeyring()
    const original = envelope()
    const originalBefore = structuredClone(original)
    const permuted = envelope({
      target: { mode: 'append', ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      candidates: [...original.candidates].reverse(),
      payload: {
        note: 'customer approved',
        workItems: original.payload.workItems as readonly CanonicalValue[],
      },
    })

    expect(createCanonicalMutationFingerprintV1(original, keyring)).toEqual(
      createCanonicalMutationFingerprintV1(permuted, keyring),
    )
    expect(original).toEqual(originalBefore)
  })

  it('is sensitive to ordered work, actor, kind, origin, payload, target, candidate, and key', () => {
    const createCanonicalMutationFingerprintV1 = requiredFunction<
      (
        value: CanonicalMutationEnvelopeV1,
        keyring: MutationFingerprintKeyringV1,
      ) => Readonly<{ keyVersion: number; digest: string }>
    >('createCanonicalMutationFingerprintV1')
    const keyring = fingerprintKeyring()
    const baselineEnvelope = envelope()
    const baseline = createCanonicalMutationFingerprintV1(baselineEnvelope, keyring)
    const changedEnvelopes: CanonicalMutationEnvelopeV1[] = [
      envelope({ actorProfileId: '22222222-2222-2222-2222-222222222222' }),
      envelope({ mutationKind: 'deliver_repair_order' }),
      envelope({ payload: { ...baselineEnvelope.payload, note: 'changed' } }),
      envelope({ target: { ...baselineEnvelope.target, mode: 'replace' } }),
      envelope({
        candidates: [
          { ...baselineEnvelope.candidates[0]!, continuityRevision: '4' as RevisionDecimal },
          baselineEnvelope.candidates[1]!,
        ],
      }),
      envelope({
        payload: {
          ...baselineEnvelope.payload,
          workItems: [
            (baselineEnvelope.payload.workItems as readonly CanonicalValue[])[1]!,
            (baselineEnvelope.payload.workItems as readonly CanonicalValue[])[0]!,
          ],
        },
      }),
    ]

    for (const changed of changedEnvelopes) {
      expect(createCanonicalMutationFingerprintV1(changed, keyring).digest).not.toBe(
        baseline.digest,
      )
    }

    const creating = envelope({ mutationKind: 'create_repair_order', operationOrigin: 'quick_quote' })
    expect(
      createCanonicalMutationFingerprintV1(
        { ...creating, operationOrigin: 'counter' },
        keyring,
      ).digest,
    ).not.toBe(createCanonicalMutationFingerprintV1(creating, keyring).digest)
    expect(createCanonicalMutationFingerprintV1(baselineEnvelope, fingerprintKeyring(1, [[1, KEY_V2_B64]]))).not.toEqual(
      baseline,
    )
    expect(
      createCanonicalMutationFingerprintV1(
        baselineEnvelope,
        fingerprintKeyring(2, [
          [1, KEY_V1_B64],
          [2, KEY_V2_B64],
        ]),
      ).keyVersion,
    ).toBe(2)
  })

  it('validates schema, mutation kind, and the exact creation-origin rule before HMAC', () => {
    const createCanonicalMutationFingerprintV1 = requiredFunction<
      (
        value: CanonicalMutationEnvelopeV1,
        keyring: MutationFingerprintKeyringV1,
      ) => Readonly<{ keyVersion: number; digest: string }>
    >('createCanonicalMutationFingerprintV1')
    const keyring = fingerprintKeyring()
    const invalid: unknown[] = [
      envelope({ mutationKind: 'create_repair_order', operationOrigin: null }),
      envelope({ mutationKind: 'create_separate_repair_order', operationOrigin: null }),
      envelope({ mutationKind: 'append_work_items', operationOrigin: 'quick_quote' }),
      { ...envelope(), schemaVersion: 2 },
      { ...envelope(), mutationKind: 'invented_mutation' },
      { ...envelope({ mutationKind: 'create_repair_order' }), operationOrigin: 'request_body' },
    ]

    for (const candidate of invalid) {
      expect(() =>
        createCanonicalMutationFingerprintV1(
          candidate as CanonicalMutationEnvelopeV1,
          keyring,
        ),
      ).toThrowError('invalid_canonical_mutation_envelope')
    }
    try {
      createCanonicalMutationFingerprintV1(
        {
          ...envelope(),
          mutationKind: 'do-not-echo-kind',
          payload: { secret: 'do-not-echo-payload' },
        } as unknown as CanonicalMutationEnvelopeV1,
        keyring,
      )
    } catch (error) {
      expect(String(error)).toBe('Error: invalid_canonical_mutation_envelope')
    }
  })

  it('replays against the stored version and distinguishes mismatch from unavailable history', () => {
    const createCanonicalMutationFingerprintV1 = requiredFunction<
      (
        value: CanonicalMutationEnvelopeV1,
        keyring: MutationFingerprintKeyringV1,
      ) => Readonly<{ keyVersion: number; digest: string }>
    >('createCanonicalMutationFingerprintV1')
    const verifyCanonicalMutationFingerprintV1 = requiredFunction<
      (
        value: CanonicalMutationEnvelopeV1,
        persisted: Readonly<{ keyVersion: number; digest: string }>,
        keyring: MutationFingerprintKeyringV1,
      ) => 'match' | 'mismatch' | 'verification_unavailable'
    >('verifyCanonicalMutationFingerprintV1')
    const original = envelope()
    const persistedV1 = createCanonicalMutationFingerprintV1(original, fingerprintKeyring())
    const v2WithHistory = fingerprintKeyring(2, [
      [1, KEY_V1_B64],
      [2, KEY_V2_B64],
    ])
    const v2WithoutHistory = fingerprintKeyring(2, [[2, KEY_V2_B64]])

    expect(verifyCanonicalMutationFingerprintV1(original, persistedV1, v2WithHistory)).toBe(
      'match',
    )
    expect(
      verifyCanonicalMutationFingerprintV1(
        envelope({ payload: { ...original.payload, note: 'changed' } }),
        persistedV1,
        v2WithHistory,
      ),
    ).toBe('mismatch')
    expect(verifyCanonicalMutationFingerprintV1(original, persistedV1, v2WithoutHistory)).toBe(
      'verification_unavailable',
    )
    expect(
      verifyCanonicalMutationFingerprintV1(
        original,
        { ...persistedV1, digest: persistedV1.digest.toUpperCase() },
        v2WithHistory,
      ),
    ).toBe('mismatch')
  })

  it('binds target and normalized candidates independently of full payload fields', () => {
    const createCanonicalTargetBindingFingerprintV1 = requiredFunction<
      (
        target: CanonicalMutationEnvelopeV1['target'],
        candidates: CanonicalMutationEnvelopeV1['candidates'],
        keyring: MutationFingerprintKeyringV1,
      ) => Readonly<{ keyVersion: number; digest: string }>
    >('createCanonicalTargetBindingFingerprintV1')
    const value = envelope()
    const keyring = fingerprintKeyring()
    const baseline = createCanonicalTargetBindingFingerprintV1(
      value.target,
      value.candidates,
      keyring,
    )

    expect(
      createCanonicalTargetBindingFingerprintV1(
        { mode: 'append', ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        [...value.candidates].reverse(),
        keyring,
      ),
    ).toEqual(baseline)
    expect(
      createCanonicalTargetBindingFingerprintV1(
        { ...value.target, mode: 'replace' },
        value.candidates,
        keyring,
      ).digest,
    ).not.toBe(baseline.digest)
  })
})

// These assignments are compile-only guards for the Quick creation base.
const quickBase: TicketCreatingEnvelopeBaseV1 = {
  schemaVersion: 1,
  mutationKind: 'create_repair_order',
  target: {},
  candidates: [],
  payload: {},
}
// @ts-expect-error operationOrigin must come from the locked origin resolver.
const quickBaseWithOrigin: TicketCreatingEnvelopeBaseV1 = { ...quickBase, operationOrigin: 'quick_quote' }
// @ts-expect-error actorProfileId must come from the locked actor scope.
const quickBaseWithActor: TicketCreatingEnvelopeBaseV1 = { ...quickBase, actorProfileId: 'actor' }
void quickBaseWithOrigin
void quickBaseWithActor
