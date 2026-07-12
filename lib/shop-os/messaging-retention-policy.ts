import { createHmac } from 'node:crypto'
import { z } from 'zod'

const e164Schema = z.string().regex(/^\+[1-9][0-9]{7,14}$/)
const keyVersionSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)
const purgeBatchSizeSchema = z.number().int().min(1).max(100)

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000
const NOTIFICATION_RETENTION_DAYS = 90
const MINIMUM_FINGERPRINT_KEY_BYTES = 32

export type FingerprintKeyRing = {
  currentVersion: string
  keys: Readonly<Record<string, string>>
}

function requireKeyVersion(input: unknown): string {
  const result = keyVersionSchema.safeParse(input)
  if (!result.success) throw new Error('invalid_fingerprint_key_version')
  return result.data
}

function requireFingerprintSecret(input: unknown): string {
  if (
    typeof input !== 'string' ||
    Buffer.byteLength(input, 'utf8') < MINIMUM_FINGERPRINT_KEY_BYTES
  ) {
    throw new Error('invalid_fingerprint_key')
  }
  return input
}

function requireRetentionDate(at: Date): Date {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new Error('invalid_retention_date')
  }
  return new Date(at.getTime())
}

function requireCalendarOffset(offset: number): number {
  if (!Number.isSafeInteger(offset)) throw new Error('invalid_calendar_offset')
  return offset
}

function calendarDateClamped(at: Date, targetYear: number, targetMonth: number): Date {
  if (!Number.isSafeInteger(targetYear) || !Number.isInteger(targetMonth)) {
    throw new Error('invalid_calendar_offset')
  }

  const source = requireRetentionDate(at)
  const originalDay = source.getUTCDate()
  const lastDayProbe = new Date(source.getTime())
  lastDayProbe.setUTCDate(1)
  lastDayProbe.setUTCFullYear(targetYear)
  lastDayProbe.setUTCMonth(targetMonth + 1)
  lastDayProbe.setUTCDate(0)

  const result = new Date(source.getTime())
  result.setUTCDate(1)
  result.setUTCFullYear(targetYear)
  result.setUTCMonth(targetMonth)
  result.setUTCDate(Math.min(originalDay, lastDayProbe.getUTCDate()))

  if (!Number.isFinite(lastDayProbe.getTime()) || !Number.isFinite(result.getTime())) {
    throw new Error('invalid_calendar_offset')
  }
  return result
}

export function normalizeE164(input: unknown): string {
  const result = e164Schema.safeParse(input)
  if (!result.success) throw new Error('invalid_e164_destination')
  return result.data
}

export function fingerprintDestination(
  normalizedE164: string,
  keyVersion: string,
  secret: string,
): string {
  const destination = normalizeE164(normalizedE164)
  const version = requireKeyVersion(keyVersion)
  const key = requireFingerprintSecret(secret)

  return createHmac('sha256', key)
    .update('vyntechs:sms-destination:')
    .update(version)
    .update(':')
    .update(destination)
    .digest('hex')
}

export function fingerprintsForKeyRing(
  input: unknown,
  keyRing: FingerprintKeyRing,
): ReadonlyArray<{ keyVersion: string; fingerprint: string }> {
  const destination = normalizeE164(input)
  const currentVersion = requireKeyVersion(keyRing?.currentVersion)
  const keys = keyRing?.keys
  if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new Error('invalid_fingerprint_key_ring')
  }
  if (!Object.hasOwn(keys, currentVersion)) {
    throw new Error('missing_current_fingerprint_key')
  }

  const legacyVersions = Object.keys(keys)
    .filter((keyVersion) => keyVersion !== currentVersion)
    .sort()
  const versions = [currentVersion, ...legacyVersions]
  const fingerprints = versions.map((keyVersion) => {
    requireKeyVersion(keyVersion)
    const fingerprint = fingerprintDestination(destination, keyVersion, keys[keyVersion]!)
    return Object.freeze({ keyVersion, fingerprint })
  })

  return Object.freeze(fingerprints)
}

export function addUtcCalendarYearsClamped(at: Date, years: number): Date {
  const source = requireRetentionDate(at)
  const targetYear = source.getUTCFullYear() + requireCalendarOffset(years)
  return calendarDateClamped(source, targetYear, source.getUTCMonth())
}

export function addUtcCalendarMonthsClamped(at: Date, months: number): Date {
  const source = requireRetentionDate(at)
  const targetIndex =
    source.getUTCFullYear() * 12 + source.getUTCMonth() + requireCalendarOffset(months)
  if (!Number.isSafeInteger(targetIndex)) throw new Error('invalid_calendar_offset')
  const targetMonth = ((targetIndex % 12) + 12) % 12
  const targetYear = (targetIndex - targetMonth) / 12
  return calendarDateClamped(source, targetYear, targetMonth)
}

export function consentProofRetainUntil(latestRelevantAt: Date): Date {
  return addUtcCalendarYearsClamped(latestRelevantAt, 5)
}

export function deliveryRetainUntil(terminalAt: Date): Date {
  return addUtcCalendarMonthsClamped(terminalAt, 12)
}

export function notificationRetainUntil(createdAt: Date): Date {
  const source = requireRetentionDate(createdAt)
  const result = new Date(
    source.getTime() + NOTIFICATION_RETENTION_DAYS * DAY_IN_MILLISECONDS,
  )
  if (!Number.isFinite(result.getTime())) throw new Error('invalid_retention_date')
  return result
}

export function validatePurgeBatchSize(input: unknown): number {
  const result = purgeBatchSizeSchema.safeParse(input)
  if (!result.success) throw new Error('invalid_purge_batch_size')
  return result.data
}
