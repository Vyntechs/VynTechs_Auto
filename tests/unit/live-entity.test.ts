import { describe, expect, it } from 'vitest'
import {
  applyEntityRemoval,
  applyEntityReplacement,
  type EntityRemoval,
  type EntityReplacement,
  type VersionedEntity,
} from '@/lib/ui/live-entity'

type JobSummary = Readonly<{
  label: string
  priority: number
}>

function entity(
  id = 'job-17',
  version = 'opaque:current',
  label = 'Waiting on approval',
): VersionedEntity<JobSummary> {
  return {
    id,
    version,
    data: { label, priority: 2 },
  }
}

describe('applyEntityReplacement', () => {
  it('applies the exact replacement entity when ID and expected version match', () => {
    const current = entity()
    const next = entity('job-17', 'opaque:next', 'Ready for technician')

    const result = applyEntityReplacement(current, {
      expectedVersion: 'opaque:current',
      entity: next,
    })

    expect(result).toEqual({ status: 'applied', entity: next })
    expect(result.entity).toBe(next)
  })

  it('returns stale and preserves the exact current object when its version changed', () => {
    const current = entity('job-17', 'server-won')

    const result = applyEntityReplacement(current, {
      expectedVersion: 'client-started-here',
      entity: entity('job-17', 'client-proposed'),
    })

    expect(result).toEqual({ status: 'stale', entity: current })
    expect(result.entity).toBe(current)
  })

  it('returns mismatch for a changed ID even when expected version matches', () => {
    const current = entity('job-17', 'same-token')

    const result = applyEntityReplacement(current, {
      expectedVersion: 'same-token',
      entity: entity('job-18', 'next-token'),
    })

    expect(result).toEqual({ status: 'mismatch', entity: current })
    expect(result.entity).toBe(current)
  })

  it('treats version strings as opaque equality tokens', () => {
    const current = entity('job-17', 'release-10')
    const exact = entity('job-17', '0001')

    expect(
      applyEntityReplacement(current, {
        expectedVersion: 'release-10',
        entity: exact,
      }),
    ).toEqual({ status: 'applied', entity: exact })

    const result = applyEntityReplacement(current, {
      expectedVersion: 'release-2',
      entity: entity('job-17', 'release-11'),
    })

    expect(result).toEqual({ status: 'stale', entity: current })
    expect(result.entity).toBe(current)
  })

  it.each([
    ['empty current ID', entity('', 'current'), 'current', entity('', 'next')],
    ['empty current version', entity('job-17', ''), '', entity('job-17', 'next')],
    [
      'empty expected version',
      entity('job-17', 'current'),
      '',
      entity('job-17', 'next'),
    ],
    [
      'empty replacement ID',
      entity('job-17', 'current'),
      'current',
      entity('', 'next'),
    ],
    [
      'empty replacement version',
      entity('job-17', 'current'),
      'current',
      entity('job-17', ''),
    ],
  ])('fails closed as mismatch for %s', (_label, current, expectedVersion, next) => {
    const result = applyEntityReplacement(current, {
      expectedVersion,
      entity: next,
    })

    expect(result).toEqual({ status: 'mismatch', entity: current })
    expect(result.entity).toBe(current)
  })

  it('does not mutate replacement inputs', () => {
    const current = Object.freeze({
      ...entity(),
      data: Object.freeze({ label: 'Original', priority: 1 }),
    })
    const next = Object.freeze({
      ...entity('job-17', 'next'),
      data: Object.freeze({ label: 'Updated', priority: 3 }),
    })
    const replacement: EntityReplacement<JobSummary> = Object.freeze({
      expectedVersion: 'opaque:current',
      entity: next,
    })
    const before = JSON.stringify({ current, replacement })

    expect(applyEntityReplacement(current, replacement)).toEqual({
      status: 'applied',
      entity: next,
    })
    expect(JSON.stringify({ current, replacement })).toBe(before)
  })
})

describe('applyEntityRemoval', () => {
  it('applies a removal only when ID and expected version both match', () => {
    const current = entity()

    expect(
      applyEntityRemoval(current, {
        id: 'job-17',
        expectedVersion: 'opaque:current',
      }),
    ).toEqual({ status: 'applied', entity: null })
  })

  it('returns stale and preserves the exact current object after a version change', () => {
    const current = entity('job-17', 'server-won')

    const result = applyEntityRemoval(current, {
      id: 'job-17',
      expectedVersion: 'client-started-here',
    })

    expect(result).toEqual({ status: 'stale', entity: current })
    expect(result.entity).toBe(current)
  })

  it('returns mismatch for a changed ID even when expected version matches', () => {
    const current = entity('job-17', 'same-token')

    const result = applyEntityRemoval(current, {
      id: 'job-18',
      expectedVersion: 'same-token',
    })

    expect(result).toEqual({ status: 'mismatch', entity: current })
    expect(result.entity).toBe(current)
  })

  it.each([
    ['empty current ID', entity('', 'current'), { id: '', expectedVersion: 'current' }],
    [
      'empty current version',
      entity('job-17', ''),
      { id: 'job-17', expectedVersion: '' },
    ],
    [
      'empty removal ID',
      entity('job-17', 'current'),
      { id: '', expectedVersion: 'current' },
    ],
    [
      'empty expected version',
      entity('job-17', 'current'),
      { id: 'job-17', expectedVersion: '' },
    ],
  ])('fails closed as mismatch for %s', (_label, current, removal) => {
    const result = applyEntityRemoval(current, removal)

    expect(result).toEqual({ status: 'mismatch', entity: current })
    expect(result.entity).toBe(current)
  })

  it('does not mutate removal inputs', () => {
    const current = Object.freeze({
      ...entity(),
      data: Object.freeze({ label: 'Original', priority: 1 }),
    })
    const removal: EntityRemoval = Object.freeze({
      id: 'job-17',
      expectedVersion: 'opaque:current',
    })
    const before = JSON.stringify({ current, removal })

    expect(applyEntityRemoval(current, removal)).toEqual({
      status: 'applied',
      entity: null,
    })
    expect(JSON.stringify({ current, removal })).toBe(before)
  })
})
