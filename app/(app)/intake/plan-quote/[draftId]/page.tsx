import { CounterPlanQuote } from '@/components/screens/counter-plan-quote'
import type { CounterPlanQuoteProps } from '@/components/screens/counter-plan-quote'
import { ViewportGate } from '@/components/vt/desktop/viewport-gate'

// Stub data placeholder. Counter 04 replaces this with a draft fetched
// from a real intake handler (lib/intake.ts) keyed by draftId.
function stubDraft(draftId: string): CounterPlanQuoteProps {
  return {
    draftId,
    customerLabel: 'Sandoval · 2014 BMW 335i',
    gate: 70,
    craftedInSeconds: 1.4,
    steps: [
      {
        n: '01',
        title: 'Pull DTCs and freeze frame',
        detail: 'Confirm crank-no-start fault path. Capture intermittent codes if present.',
        meta: '5 min · low risk · no parts',
        conf: 96,
      },
      {
        n: '02',
        title: 'Inspect K-CAN bus integrity at junction box',
        detail: 'Build-date-specific wire colors. Visual inspection only on first pass.',
        meta: '20 min · low risk · no parts',
        conf: 88,
      },
      {
        n: '03',
        title: 'Verify charging system under load',
        detail: 'Voltage drop test on alternator + battery cables, observe behavior on dash flicker.',
        meta: '25 min · low risk · no parts',
        conf: 84,
      },
      {
        n: '04',
        title: 'Test FRM3 footwell module wake-up state',
        detail: 'Common N55-era failure. Module bricks intermittently and presents as crank-no-start.',
        meta: '30 min · medium risk · no parts yet',
        conf: 73,
      },
      {
        n: '05',
        title: 'K-CAN splice repair if step 04 isolates the wire',
        detail: 'Destructive class. Requires curator-confirmed wire color before commit.',
        meta: '45 min · destructive · gating',
        conf: 62,
      },
    ],
    quote: {
      lines: [
        {
          title: 'Diagnostic — DTC pull, K-CAN, charging, FRM3',
          sub: 'Steps 01–04. Gets us to a defensible diagnosis.',
          hours: '1.5',
          laborUSD: '$165',
        },
        {
          title: 'Repair — K-CAN splice + verification',
          sub: 'Step 05. Conditional on diagnosis. Curator-gated.',
          hours: '0.75',
          laborUSD: '$82',
        },
        {
          title: 'Parts — likely needed',
          sub: 'FRM3 footwell module if isolated · ~$340 OEM, ~$190 reman. K-CAN splice kit · ~$28.',
          hours: '—',
          laborUSD: '—',
        },
      ],
      totalHours: '2.25 hr',
      totalUSD: '$247',
      rateNote: 'Shop rate $110/hr · parts not included in total',
    },
    writerNoteDefault:
      "Mr. Sandoval prefers reman if available — has the car back by Friday is the goal. Authorized diagnostic only at this stage; we'll call before any repair work.",
  }
}

export default async function PlanQuotePage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const { draftId } = await params
  return (
    <ViewportGate>
      <CounterPlanQuote {...stubDraft(draftId)} />
    </ViewportGate>
  )
}
