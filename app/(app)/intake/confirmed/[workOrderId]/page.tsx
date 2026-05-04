import { CounterWorkOrderConfirm } from '@/components/screens/counter-work-order-confirm'
import type { CounterWorkOrderConfirmProps } from '@/components/screens/counter-work-order-confirm'

// Stub data placeholder. Counter 04 replaces this with a real work
// order fetched by id from lib/intake.ts (or wherever the authorize
// handler persists the WorkOrder record).
function stubWorkOrder(workOrderId: string): CounterWorkOrderConfirmProps {
  return {
    workOrderId,
    customerLabel: 'Sandoval · 2014 BMW 335i',
    vehicle: { line: '2014 BMW 335i', sub: 'N55 · 110,400 mi' },
    customer: { line: 'Sandoval, R.', sub: '(303) 555-0142' },
    estimate: { line: '2.25 hr · $247', sub: 'labor · parts TBD' },
    techAssigned: { line: 'Marcus T.', sub: 'Bay 3 · queued #2' },
    steps: [
      { n: '01', title: 'Pull DTCs and freeze frame', auth: true },
      { n: '02', title: 'Inspect K-CAN bus integrity at junction box', auth: true },
      { n: '03', title: 'Verify charging system under load', auth: true },
      { n: '04', title: 'Test FRM3 footwell module wake-up state', auth: true },
      {
        n: '05',
        title: 'K-CAN splice repair (curator-gated, customer call before commit)',
        auth: false,
      },
    ],
    authSummary: '5 steps · authorized for 01–04',
    customerMessage: {
      sentAt: 'Sent · 11:27 am',
      body:
        "Hi Robert — your 335i is checked in. Diagnostic estimate is 1.5 hrs / $165. We'll text you before any repair work begins. — Diana, Mountain Auto",
    },
  }
}

export default async function ConfirmedPage({
  params,
}: {
  params: Promise<{ workOrderId: string }>
}) {
  const { workOrderId } = await params
  return <CounterWorkOrderConfirm {...stubWorkOrder(workOrderId)} />
}
