import { describe, expect, it } from 'vitest'
import {
  classifyCannedJobFailure,
  normalizeCannedJobDraft,
  parseAppliedCannedJobResponse,
  parseCannedJobListResponse,
  parseCannedJobMutationResponse,
  parseManagementCannedJobMutationResponse,
  isJobLimitReachedFailure,
  type CannedJobProjection,
} from '@/lib/shop-os/canned-jobs-ui'

const job: CannedJobProjection = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Brake service', kind: 'repair',
  defaultRequiredSkillTier: 2, sort: 10, fingerprint: 'a'.repeat(64),
  lines: [{ kind: 'part', description: 'Brake pads', sort: 0, quantity: '1', priceCents: 12500, taxable: true }],
  summary: { subtotalCents: 12500, taxableSubtotalCents: 12500, taxCents: 1000, totalCents: 13500 },
}

describe('canned job client contracts', () => {
  it('strictly parses list and paired create/apply envelopes', () => {
    expect(parseCannedJobListResponse({ cannedJobs: [job], taxRateBps: 800 })).toEqual({ cannedJobs: [job], taxRateBps: 800 })
    expect(parseCannedJobListResponse({ cannedJobs: [job], taxRateBps: 800, internal: true })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [job, job], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobMutationResponse(201, { changed: true, cannedJob: job })).not.toBeNull()
    expect(parseCannedJobMutationResponse(200, { changed: false, cannedJob: job })).not.toBeNull()
    expect(parseCannedJobMutationResponse(200, { changed: true, cannedJob: job })).toBeNull()
    expect(parseManagementCannedJobMutationResponse({ changed: true, cannedJob: job })).not.toBeNull()

    const applied = { changed: true, job: { id: job.id, title: job.title, kind: job.kind, requiredSkillTier: 2, lineCount: 1 } }
    expect(parseAppliedCannedJobResponse(201, applied)).toEqual(applied)
    expect(parseAppliedCannedJobResponse(200, applied)).toBeNull()
    expect(parseAppliedCannedJobResponse(201, { ...applied, hidden: true })).toBeNull()
  })

  it('rejects noncanonical decimals, unstable line order, and hostile summary arithmetic', () => {
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, lines: [{ ...job.lines[0], quantity: '1.0' }] }], taxRateBps: 800 })).toBeNull()
    const second = { kind: 'fee' as const, description: 'Fee', sort: 1, priceCents: 100, taxable: false }
    const twoLine = { ...job, lines: [second, { ...job.lines[0], sort: 0 }], summary: { subtotalCents: 12600, taxableSubtotalCents: 12500, taxCents: 1000, totalCents: 13600 } }
    expect(parseCannedJobListResponse({ cannedJobs: [twoLine], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, summary: { ...job.summary, subtotalCents: 499 } }], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, summary: { ...job.summary, taxCents: 999, totalCents: 1499 } }], taxRateBps: 800 })).toBeNull()
    expect(parseManagementCannedJobMutationResponse({ changed: true, cannedJob: { ...job, summary: { ...job.summary, totalCents: 13499 } } })).toBeNull()
  })

  it('rejects text the domain would trim and combined subtotal overflow', () => {
    const part = job.lines[0]
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, title: ' Brake service' }], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, title: '   ' }], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, lines: [{ ...part, description: 'Brake pads ' }] }], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, lines: [{ ...part, partNumber: ' PAD-1' }] }], taxRateBps: 800 })).toBeNull()
    expect(parseCannedJobListResponse({ cannedJobs: [{ ...job, lines: [{ ...part, brand: 'ACME ' }] }], taxRateBps: 800 })).toBeNull()
    expect(parseAppliedCannedJobResponse(201, { changed: true, job: { id: job.id, title: ' Brake service', kind: 'repair', requiredSkillTier: 2, lineCount: 1 } })).toBeNull()

    const priceCents = 5_000_000_000_000_000
    const overflow = {
      ...job,
      lines: [{ ...part, priceCents }],
      summary: { subtotalCents: priceCents, taxableSubtotalCents: priceCents, taxCents: null, totalCents: null },
    }
    expect(parseCannedJobListResponse({ cannedJobs: [overflow], taxRateBps: null })).toBeNull()
    expect(parseManagementCannedJobMutationResponse({ changed: true, cannedJob: overflow })).toBeNull()
  })

  it('normalizes all three safe line kinds with exact decimal money', () => {
    expect(normalizeCannedJobDraft({
      title: '  Service package ', kind: 'maintenance', tier: '3', sort: '15',
      lines: [
        { key: '1', kind: 'part', description: ' Filter ', sort: '0', price: '12.34', taxable: true, quantity: '2.500', partNumber: ' PF-1 ', brand: ' Wix ', hours: '1', laborRate: '' },
        { key: '2', kind: 'labor', description: ' Install ', sort: '1', price: '50', taxable: false, quantity: '1', partNumber: '', brand: '', hours: '0.50', laborRate: '100' },
        { key: '3', kind: 'fee', description: ' Disposal ', sort: '2', price: '5.00', taxable: true, quantity: '1', partNumber: '', brand: '', hours: '1', laborRate: '' },
      ],
    })).toEqual({
      title: 'Service package', kind: 'maintenance', defaultRequiredSkillTier: 3, sort: 15,
      lines: [
        { kind: 'part', description: 'Filter', sort: 0, priceCents: 1234, taxable: true, quantity: '2.5', partNumber: 'PF-1', brand: 'Wix' },
        { kind: 'labor', description: 'Install', sort: 1, priceCents: 5000, taxable: false, hours: '0.5', laborRateCents: 10000 },
        { kind: 'fee', description: 'Disposal', sort: 2, priceCents: 500, taxable: true },
      ],
    })
  })

  it.each([
    { field: 'quantity', value: '0' }, { field: 'quantity', value: '1.0001' },
    { field: 'price', value: '1.001' }, { field: 'sort', value: '1000001' },
  ])('rejects unsafe $field bounds', ({ field, value }) => {
    const line = { key: '1', kind: 'part' as const, description: 'Part', sort: '0', price: '1', taxable: true, quantity: '1', partNumber: '', brand: '', hours: '1', laborRate: '' }
    expect(() => normalizeCannedJobDraft({ title: 'Job', kind: 'repair', tier: '1', sort: field === 'sort' ? value : '0', lines: [{ ...line, ...(field === 'sort' ? {} : { [field]: value }) }] })).toThrow()
  })

  it('maps stale and calm recovery without inventing a cause', () => {
    expect(classifyCannedJobFailure(409)).toMatch(/changed.*Refresh/i)
    expect(classifyCannedJobFailure(401)).toMatch(/Sign in/i)
    expect(classifyCannedJobFailure(500)).toMatch(/Could not update/i)
  })

  it('recognizes the terminal per-ticket job limit without calling it stale state', () => {
    expect(isJobLimitReachedFailure(409, { error: 'job_limit_reached' })).toBe(true)
    expect(isJobLimitReachedFailure(409, { error: 'conflict' })).toBe(false)
    expect(isJobLimitReachedFailure(500, { error: 'job_limit_reached' })).toBe(false)
  })
})
