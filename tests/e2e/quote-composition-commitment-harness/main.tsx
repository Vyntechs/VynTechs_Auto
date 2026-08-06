import { createRoot } from 'react-dom/client'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import '@/app/globals.css'
import './style.css'

type Builder = Extract<QuoteBuilderResult, { ok: true }>['builder']

const TICKET = '00000000-0000-4000-8000-000000000101'
const JOB = '00000000-0000-4000-8000-000000000201'
const ACTOR = '00000000-0000-4000-8000-000000000100'

const builder: Builder = {
  ticket: { id: TICKET, status: 'open', reconciled: true },
  configuration: {
    laborRateCents: 15_000,
    taxRateBps: 825,
    partsMarkupBps: null,
    laborRateConfigured: true,
    taxRateConfigured: true,
  },
  jobs: [{
    id: JOB,
    title: 'Replace front brakes',
    kind: 'repair',
    workStatus: 'open',
    canEdit: true,
    customerSuppliedPartsNote: null,
    story: { content: null, source: null, reviewStatus: null, revision: 0 },
    storyMode: null,
    decisionEligible: false,
    approval: { state: 'pending_quote', quoteVersionId: null },
    lines: [],
  }],
  capabilities: { canPrepareQuote: true, canRecordCustomerApproval: true },
  activeVersion: null,
  lastPreparedVersion: null,
  draftCommitment: null,
}

const root = document.getElementById('root')
if (!root) throw new Error('quote commitment harness root missing')
createRoot(root).render(
  <main className="quote-proof-shell">
    <ManualQuoteBuilder
      actorId={ACTOR}
      ticket={{
        id: TICKET,
        ticketNumber: 42,
        concern: 'Brake vibration',
        customer: { name: 'Marisol Vega' },
        vehicle: { year: 2019, make: 'Ford', model: 'F-150' },
      }}
      builder={builder}
    />
  </main>,
)
