import { describe, expect, it } from 'vitest'
import {
  addUtcCalendarMonthsClamped,
  addUtcCalendarYearsClamped,
  consentProofRetainUntil,
  deliveryRetainUntil,
  fingerprintDestination,
  fingerprintsForKeyRing,
  normalizeE164,
  notificationRetainUntil,
  validatePurgeBatchSize,
} from '@/lib/shop-os/messaging-retention-policy'

const FICTIONAL_DESTINATION = '+12025550123'
const CURRENT_SECRET = 'shop-a-key-material-that-is-at-least-32-bytes'
const LEGACY_SECRET = 'shop-a-legacy-key-material-at-least-32-bytes'

function errorMessage(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected action to throw')
}

describe('Shop OS messaging retention policy', () => {
  describe('strict destination fingerprints', () => {
    it('accepts only an already-normalized fictional E.164 destination', () => {
      expect(normalizeE164(FICTIONAL_DESTINATION)).toBe(FICTIONAL_DESTINATION)
    })

    it.each([
      ' +12025550123',
      '+1 202 555 0123',
      '+1-202-555-0123',
      '2025550123',
      '+00000000',
      '+1202555012345678',
    ])('rejects a non-E.164 destination without echoing it: %s', (input) => {
      const message = errorMessage(() => normalizeE164(input))
      expect(message).toBe('invalid_e164_destination')
      expect(message).not.toContain(input)
    })

    it('rejects non-string destinations with the same sanitized error', () => {
      expect(() => normalizeE164(12025550123)).toThrow('invalid_e164_destination')
    })

    it('returns the stable lowercase HMAC-SHA-256 contract', () => {
      expect(fingerprintDestination(FICTIONAL_DESTINATION, 'v1', CURRENT_SECRET)).toBe(
        'd4e7fe9d51015c5dfe10c9242a4a3427d1d04c05e27466555bad2e89e02f1bbf',
      )
      expect(fingerprintDestination(FICTIONAL_DESTINATION, 'v1', CURRENT_SECRET)).toMatch(
        /^[0-9a-f]{64}$/,
      )
    })

    it('binds the fingerprint to both key version and shop key material', () => {
      const baseline = fingerprintDestination(FICTIONAL_DESTINATION, 'v1', CURRENT_SECRET)
      expect(fingerprintDestination(FICTIONAL_DESTINATION, 'v2', CURRENT_SECRET)).not.toBe(
        baseline,
      )
      expect(fingerprintDestination(FICTIONAL_DESTINATION, 'v1', LEGACY_SECRET)).not.toBe(
        baseline,
      )
    })

    it('rejects invalid versions and short keys without echoing sensitive inputs', () => {
      const shortSecret = 'short-secret'
      const invalidDestination = '+1 202 555 0123'
      for (const message of [
        errorMessage(() =>
          fingerprintDestination(invalidDestination, 'v1', CURRENT_SECRET),
        ),
        errorMessage(() =>
          fingerprintDestination(FICTIONAL_DESTINATION, 'V1', CURRENT_SECRET),
        ),
        errorMessage(() =>
          fingerprintDestination(FICTIONAL_DESTINATION, 'v1', shortSecret),
        ),
      ]) {
        expect(message).not.toContain(FICTIONAL_DESTINATION)
        expect(message).not.toContain(invalidDestination)
        expect(message).not.toContain(CURRENT_SECRET)
        expect(message).not.toContain(shortSecret)
      }
    })

    it('returns current first and legacy versions in deterministic lexical order', () => {
      const keyRing = Object.freeze({
        currentVersion: 'v2',
        keys: Object.freeze({
          v3: 'shop-a-future-key-material-at-least-32-bytes',
          v2: CURRENT_SECRET,
          v1: LEGACY_SECRET,
        }),
      })

      const result = fingerprintsForKeyRing(FICTIONAL_DESTINATION, keyRing)

      expect(result.map(({ keyVersion }) => keyVersion)).toEqual(['v2', 'v1', 'v3'])
      expect(new Set(result.map(({ fingerprint }) => fingerprint)).size).toBe(3)
      expect(keyRing).toEqual({
        currentVersion: 'v2',
        keys: {
          v3: 'shop-a-future-key-material-at-least-32-bytes',
          v2: CURRENT_SECRET,
          v1: LEGACY_SECRET,
        },
      })
    })

    it('emits the current key version exactly once', () => {
      const result = fingerprintsForKeyRing(FICTIONAL_DESTINATION, {
        currentVersion: 'v1',
        keys: { v1: CURRENT_SECRET },
      })
      expect(result).toHaveLength(1)
      expect(result[0]?.keyVersion).toBe('v1')
    })

    it('rejects a missing or inherited current key and ignores inherited legacy keys', () => {
      expect(() =>
        fingerprintsForKeyRing(FICTIONAL_DESTINATION, {
          currentVersion: 'v2',
          keys: { v1: LEGACY_SECRET },
        }),
      ).toThrow('missing_current_fingerprint_key')

      const inheritedCurrent = Object.create({ v2: CURRENT_SECRET }) as Record<string, string>
      expect(() =>
        fingerprintsForKeyRing(FICTIONAL_DESTINATION, {
          currentVersion: 'v2',
          keys: inheritedCurrent,
        }),
      ).toThrow('missing_current_fingerprint_key')

      const ownCurrent = Object.assign(Object.create({ v0: LEGACY_SECRET }), {
        v1: CURRENT_SECRET,
      }) as Record<string, string>
      expect(
        fingerprintsForKeyRing(FICTIONAL_DESTINATION, {
          currentVersion: 'v1',
          keys: ownCurrent,
        }).map(({ keyVersion }) => keyVersion),
      ).toEqual(['v1'])
    })

    it('rejects invalid own key versions and short key-ring secrets safely', () => {
      const pollutedKeys = { v1: CURRENT_SECRET } as Record<string, string>
      Object.defineProperty(pollutedKeys, '__proto__', {
        enumerable: true,
        value: LEGACY_SECRET,
      })

      expect(() =>
        fingerprintsForKeyRing(FICTIONAL_DESTINATION, {
          currentVersion: 'v1',
          keys: pollutedKeys,
        }),
      ).toThrow('invalid_fingerprint_key_version')

      const message = errorMessage(() =>
        fingerprintsForKeyRing(FICTIONAL_DESTINATION, {
          currentVersion: 'v1',
          keys: { v1: 'too-short' },
        }),
      )
      expect(message).toBe('invalid_fingerprint_key')
      expect(message).not.toContain(FICTIONAL_DESTINATION)
      expect(message).not.toContain('too-short')
    })
  })

  describe('immutable retention clocks', () => {
    it('adds five UTC calendar years and clamps leap day', () => {
      const input = new Date('2024-02-29T23:45:06.789Z')
      const originalTime = input.getTime()

      expect(consentProofRetainUntil(input).toISOString()).toBe(
        '2029-02-28T23:45:06.789Z',
      )
      expect(input.getTime()).toBe(originalTime)
    })

    it('adds twelve UTC calendar months and clamps month end', () => {
      const leapDay = new Date('2024-02-29T08:09:10.011Z')
      const monthEnd = new Date('2024-03-31T08:09:10.011Z')

      expect(deliveryRetainUntil(leapDay).toISOString()).toBe(
        '2025-02-28T08:09:10.011Z',
      )
      expect(addUtcCalendarMonthsClamped(monthEnd, 1).toISOString()).toBe(
        '2024-04-30T08:09:10.011Z',
      )
      expect(leapDay.toISOString()).toBe('2024-02-29T08:09:10.011Z')
      expect(monthEnd.toISOString()).toBe('2024-03-31T08:09:10.011Z')
    })

    it('uses exact ninety-day UTC arithmetic without mutating the input', () => {
      const input = new Date('2024-02-29T23:59:59.999Z')
      const originalTime = input.getTime()
      const result = notificationRetainUntil(input)

      expect(result.getTime() - input.getTime()).toBe(90 * 24 * 60 * 60 * 1_000)
      expect(result.toISOString()).toBe('2024-05-29T23:59:59.999Z')
      expect(input.getTime()).toBe(originalTime)
    })

    it('rejects invalid dates and unsafe calendar offsets instead of normalizing', () => {
      const validDate = new Date('2024-01-31T00:00:00.000Z')
      const invalidDate = new Date(Number.NaN)

      expect(() => addUtcCalendarYearsClamped(invalidDate, 5)).toThrow(
        'invalid_retention_date',
      )
      expect(() => addUtcCalendarMonthsClamped(invalidDate, 12)).toThrow(
        'invalid_retention_date',
      )
      expect(() => notificationRetainUntil(invalidDate)).toThrow('invalid_retention_date')
      for (const years of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER]) {
        expect(() => addUtcCalendarYearsClamped(validDate, years)).toThrow(
          'invalid_calendar_offset',
        )
      }
      for (const months of [
        Number.NaN,
        Number.NEGATIVE_INFINITY,
        1.5,
        Number.MAX_SAFE_INTEGER,
      ]) {
        expect(() => addUtcCalendarMonthsClamped(validDate, months)).toThrow(
          'invalid_calendar_offset',
        )
      }
    })

    it('supports explicit clamped year arithmetic without changing the source', () => {
      const input = new Date('2020-02-29T12:00:00.000Z')
      expect(addUtcCalendarYearsClamped(input, 1).toISOString()).toBe(
        '2021-02-28T12:00:00.000Z',
      )
      expect(input.toISOString()).toBe('2020-02-29T12:00:00.000Z')
    })
  })

  describe('bounded purge batches', () => {
    it.each([1, 50, 100])('accepts the integer batch size %s', (input) => {
      expect(validatePurgeBatchSize(input)).toBe(input)
    })

    it.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null])(
      'rejects the invalid batch size %s',
      (input) => {
        expect(() => validatePurgeBatchSize(input)).toThrow('invalid_purge_batch_size')
      },
    )
  })
})
