'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn, MainHeader, Topbar, VtPill } from '@/components/vt/desktop'
import { PlanTree, type PlanStep } from '@/components/vt/desktop/plan-tree'

export type QuoteLine = {
  title: string
  sub: string
  hours: string
  laborUSD: string
}

export type CounterPlanQuoteProps = {
  draftId: string
  customerLabel: string
  steps: PlanStep[]
  gate?: number
  craftedInSeconds?: number
  quote: {
    lines: QuoteLine[]
    totalHours: string
    totalUSD: string
    rateNote: string
  }
  writerNoteDefault?: string
}

export function CounterPlanQuote({
  draftId,
  customerLabel,
  steps,
  gate = 70,
  craftedInSeconds,
  quote,
  writerNoteDefault = '',
}: CounterPlanQuoteProps) {
  const router = useRouter()
  const [lines, setLines] = useState<QuoteLine[]>(quote.lines)
  const [writerNote, setWriterNote] = useState(writerNoteDefault)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eyebrow = craftedInSeconds
    ? `Pre-bay plan · drafted in ${craftedInSeconds.toFixed(1)} s`
    : 'Pre-bay plan'

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index))
    setError(null)
  }

  const handleWriterNoteChange = (value: string) => {
    setWriterNote(value)
    setError(null)
  }

  const totals = lines.reduce(
    (acc, line) => {
      const h = Number.parseFloat(line.hours)
      const usd = Number.parseFloat(line.laborUSD.replace(/[^\d.-]/g, ''))
      if (Number.isFinite(h)) acc.hours += h
      if (Number.isFinite(usd)) acc.usd += usd
      return acc
    },
    { hours: 0, usd: 0 },
  )
  const totalHours = `${Number(totals.hours.toFixed(2))} hr`
  const totalUSD = `$${Number(totals.usd.toFixed(2))}`

  const handleAuthorize = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/intake/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId, writerNote, lines, steps }),
      })
      const payload = (await res.json()) as { workOrderId?: string; error?: string }
      if (!res.ok || !payload.workOrderId) {
        setError(payload.error ?? 'Could not authorize. Try again.')
        setBusy(false)
        return
      }
      router.push(`/intake/confirmed/${payload.workOrderId}`)
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="vt-app">
      <Topbar
        product="Counter"
        crumbs={[
          { label: 'Today' },
          { label: customerLabel },
          { label: 'AI plan & quote', bold: true },
        ]}
        user="Diana"
      />
      <div className="vt-workspace">
        <main className="vt-main" style={{ overflow: 'hidden' }}>
          <MainHeader
            eyebrow={eyebrow}
            title="Here's what we'll do, and what it'll likely cost."
            sub="Walk the customer through this. Edit hours or remove steps before they authorize."
            actions={
              <>
                <Btn
                  kind="ghost"
                  size="sm"
                  type="button"
                  disabled
                  title="Wires up in Counter 04"
                >
                  Re-run AI
                </Btn>
                <Btn
                  kind="secondary"
                  type="button"
                  disabled
                  title="Wires up in Counter 04"
                >
                  Print for customer
                </Btn>
                <Btn
                  kind="primary"
                  type="button"
                  kbd="⌘ ↵"
                  onClick={handleAuthorize}
                  disabled={busy}
                >
                  Authorize &amp; queue
                </Btn>
              </>
            }
          />
          <div className="vt-twopane">
            {/* LEFT — plan tree */}
            <section className="vt-pane">
              <div className="vt-pane__header">
                <div>
                  <span className="vt-pane__eyebrow">Diagnostic plan · {steps.length} steps</span>
                  <h2 className="vt-pane__title">What the bay tech will do</h2>
                </div>
                <VtPill kind="accent">
                  {craftedInSeconds ? `AI · ${craftedInSeconds.toFixed(1)} s` : 'AI'}
                </VtPill>
              </div>
              <div className="vt-pane__body">
                <PlanTree steps={steps} variant="editable" gate={gate} />
              </div>
            </section>

            {/* RIGHT — quote + writer note */}
            <section className="vt-pane vt-pane--right">
              <div className="vt-pane__header">
                <div>
                  <span className="vt-pane__eyebrow">Quote draft</span>
                  <h2 className="vt-pane__title">Estimate</h2>
                </div>
                <VtPill kind="active">Editable</VtPill>
              </div>
              <div className="vt-pane__body">
                <div className="vt-quote">
                  <div className="vt-quote__row vt-quote__row--head">
                    <span className="vt-quote__cell vt-quote__cell--head">Line item</span>
                    <span className="vt-quote__cell vt-quote__cell--head">Hours</span>
                    <span className="vt-quote__cell vt-quote__cell--head">Labor $</span>
                    <span />
                  </div>

                  {lines.map((line, i) => (
                    <div key={`${line.title}-${i}`} className="vt-quote__row">
                      <div>
                        <div className="vt-quote__title">{line.title}</div>
                        <div className="vt-quote__sub">{line.sub}</div>
                      </div>
                      <span className="vt-quote__cell--num">{line.hours}</span>
                      <span className="vt-quote__cell--num">{line.laborUSD}</span>
                      <button
                        type="button"
                        className="vt-quote__remove"
                        aria-label={`Remove ${line.title}`}
                        onClick={() => removeLine(i)}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <div className="vt-quote__row vt-quote__row--total">
                    <strong style={{ fontFamily: 'var(--vt-font-serif)', fontSize: 17 }}>
                      Estimated labor
                    </strong>
                    <span className="vt-quote__cell--num" style={{ fontWeight: 600 }}>
                      {totalHours}
                    </span>
                    <span className="vt-quote__cell--num" style={{ fontWeight: 600 }}>
                      {totalUSD}
                    </span>
                    <span />
                  </div>
                  <div className="vt-quote__rate-note">{quote.rateNote}</div>
                </div>

                <div className="vt-writer-note">
                  <label htmlFor="writer-note" className="vt-writer-note__label">
                    Writer's note · stays with the work order
                  </label>
                  <textarea
                    id="writer-note"
                    className="vt-writer-note__textarea"
                    value={writerNote}
                    onChange={(e) => handleWriterNoteChange(e.target.value)}
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 14,
                      padding: '10px 14px',
                      borderLeft: '2px solid var(--vt-risk-high)',
                      background: 'var(--vt-bone-100)',
                      fontFamily: 'var(--vt-font-serif)',
                      fontStyle: 'italic',
                      fontSize: 14,
                      color: 'var(--vt-fg-2)',
                    }}
                  >
                    {error}
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
