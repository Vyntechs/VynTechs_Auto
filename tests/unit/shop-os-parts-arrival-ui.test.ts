import { describe, expect, it } from 'vitest'
import {
  parsePartsArrivalMutationResponse,
  parsePartsArrivalReadResponse,
} from '@/lib/shop-os/parts-arrival-ui'

const job = {
  jobId: '00000000-0000-4000-8000-000000000030',
  approvedQuoteVersionId: '00000000-0000-4000-8000-000000000040',
  title: 'Front brake service',
  readOnly: false,
  receivedCount: 0,
  totalCount: 1,
  allHere: false,
  lines: [{
    id: '00000000-0000-4000-8000-000000000050',
    description: 'Front brake pads', quantity: '1', partNumber: 'PAD-1', brand: 'ACME',
    state: 'needs_order', nextAction: 'mark_ordered', ordered: null, received: null,
  }],
}

describe('parts arrival UI contract', () => {
  it('accepts exact read and mutation envelopes', () => {
    expect(parsePartsArrivalReadResponse({ job })).toEqual(job)
    expect(parsePartsArrivalMutationResponse({ changed: true, job })).toEqual({ changed: true, job })
  })

  it('rejects unknown keys, mismatched counts, invalid transitions, and unsafe fields', () => {
    for (const value of [
      { job: { ...job, shopId: 'secret' } },
      { job: { ...job, totalCount: 2 } },
      { job: { ...job, allHere: true } },
      { job: { ...job, lines: [{ ...job.lines[0], unitCostCents: 1 }] } },
      { job: { ...job, lines: [{ ...job.lines[0], state: 'received', nextAction: 'mark_received' }] } },
      { job: { ...job, lines: [{ ...job.lines[0], ordered: { actorName: 'Pat', at: 'not-a-date' } }] } },
    ]) expect(parsePartsArrivalReadResponse(value)).toBeNull()
  })
})
