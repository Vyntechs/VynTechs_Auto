'use client'

import { useRouter } from 'next/navigation'
import { Btn, MainHeader, Topbar } from '@/components/vt/desktop'
import { PlanTree, type PlanStep } from '@/components/vt/desktop/plan-tree'

export type CounterWorkOrderConfirmProps = {
  workOrderId: string
  customerLabel: string
  vehicle: { line: string; sub: string }
  customer: { line: string; sub: string }
  estimate: { line: string; sub: string }
  techAssigned: { line: string; sub: string }
  steps: PlanStep[]
  authSummary: string
  customerMessage: { sentAt: string; body: string }
  userEmail?: string
}

export function CounterWorkOrderConfirm({
  workOrderId,
  customerLabel,
  vehicle,
  customer,
  estimate,
  techAssigned,
  steps,
  authSummary,
  customerMessage,
  userEmail,
}: CounterWorkOrderConfirmProps) {
  const router = useRouter()

  const cells = [
    { label: 'Vehicle', value: vehicle.line, sub: vehicle.sub },
    { label: 'Customer', value: customer.line, sub: customer.sub },
    { label: 'Estimate', value: estimate.line, sub: estimate.sub },
    { label: 'Tech assigned', value: techAssigned.line, sub: techAssigned.sub },
  ]

  return (
    <div className="vt-app">
      <Topbar
        product="Counter"
        crumbs={[
          { label: 'Today' },
          { label: customerLabel },
          { label: 'Confirmed', bold: true },
        ]}
        user={userEmail || '—'}
      />
      <div className="vt-workspace">
        <main className="vt-main">
          <MainHeader
            eyebrow={`Work order · ${workOrderId}`}
            title="Queued for the next bay tech."
            sub="The customer has been notified by text. The AI plan is locked in. The next bay tech picks this up."
            actions={
              <>
                <Btn
                  kind="ghost"
                  size="sm"
                  type="button"
                  disabled
                  title="Wires up in Counter 04"
                >
                  Print receipt
                </Btn>
                <Btn
                  kind="primary"
                  type="button"
                  kbd="N"
                  onClick={() => router.push('/intake')}
                >
                  New intake
                </Btn>
              </>
            }
          />
          <div
            className="vt-main__body"
            style={{
              padding: 32,
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
              maxWidth: 920,
            }}
          >
            <div className="vt-plate">
              {cells.map((c) => (
                <div key={c.label} className="vt-plate__cell">
                  <span className="vt-plate__label">{c.label}</span>
                  <span className="vt-plate__value">{c.value}</span>
                  <span className="vt-plate__sub">{c.sub}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                }}
              >
                <h2
                  style={{
                    fontFamily: 'var(--vt-font-serif)',
                    fontSize: 24,
                    letterSpacing: '-0.02em',
                    margin: 0,
                    fontWeight: 400,
                  }}
                >
                  What the bay tech will do
                </h2>
                <span
                  style={{
                    fontFamily: 'var(--vt-font-mono)',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--vt-fg-3)',
                  }}
                >
                  {authSummary}
                </span>
              </div>
              <PlanTree steps={steps} variant="readonly" />
            </div>

            <div className="vt-msg-preview">
              <span className="vt-msg-preview__time">{customerMessage.sentAt}</span>
              <span className="vt-msg-preview__body">"{customerMessage.body}"</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
