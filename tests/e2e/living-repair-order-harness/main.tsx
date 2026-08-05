import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CustomerCopy } from '@/components/screens/customer-copy'
import type { CustomerCopyProjection, CustomerCopyResult } from '@/lib/shop-os/customer-copy'
import { customerCopyFixture } from '@/tests/helpers/customer-copy'
import { ImplementationHarness } from './implementation-harness'
import '@/app/globals.css'
import './style.css'

type BuilderStage =
  | 'closed'
  | 'empty'
  | 'part-choice'
  | 'part-form'
  | 'part-saved'
  | 'labor-form'
  | 'ready'
  | 'fee-form'
  | 'confirm'
  | 'settled'

type SupplierMode = 'attached' | 'manual'

const JOBS = [
  { id: 'brakes', title: 'Front brake service', kind: 'Repair', assignment: 'Assigned · A-tech' },
  { id: 'fluid', title: 'Brake fluid service', kind: 'Maintenance', assignment: 'Assigned · B-tech' },
] as const

const PARTS_MARKUP_PERCENT = 40
const TAX_PERCENT = 8

const proofCustomerCopy: CustomerCopyProjection = {
  ...customerCopyFixture,
  documentKind: 'estimate',
  jobs: [{
    title: 'Front brake service',
    kind: 'repair',
    lines: [
      {
        kind: 'part', description: 'Front brake pad set', quantity: '1', priceCents: 14_000,
        taxable: true, partNumber: null, brand: null,
      },
      {
        kind: 'labor', description: 'Install front brake pads', hours: '1.25', priceCents: 18_750,
        taxable: false, laborRateCents: 15_000,
      },
    ],
  }],
  decisions: [],
  totals: {
    subtotalCents: 32_750,
    taxCents: 1_120,
    totalCents: 33_870,
    payments: [],
    paidCents: 0,
    balanceCents: 33_870,
  },
  closedAt: null,
}

function Harness(): React.JSX.Element {
  const query = new URLSearchParams(window.location.search)
  const initialState = query.get('state') ?? 'collapsed'
  const tieMode = initialState === 'tie'
  const [stage, setStage] = useState<BuilderStage>('closed')
  const [tieOpen, setTieOpen] = useState(false)
  const [focusedJob, setFocusedJob] = useState<string | null>(null)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [approvalChoice, setApprovalChoice] = useState('approved')
  const [approvalRecorded, setApprovalRecorded] = useState(false)
  const [customerCopyOpen, setCustomerCopyOpen] = useState(initialState === 'print')
  const [supplierMode, setSupplierMode] = useState<SupplierMode>('attached')
  const [supplier, setSupplier] = useState('')
  const [partDescription, setPartDescription] = useState('')
  const [partQuantity, setPartQuantity] = useState('1')
  const [partUnitCost, setPartUnitCost] = useState('')
  const [laborDescription, setLaborDescription] = useState('')
  const [laborHours, setLaborHours] = useState('')
  const [laborRate, setLaborRate] = useState('150.00')
  const [feeDescription, setFeeDescription] = useState('')
  const [feePrice, setFeePrice] = useState('')
  const [savedFeeCents, setSavedFeeCents] = useState<number | null>(null)
  const ticketOpenerRef = useRef<HTMLButtonElement>(null)
  const builderRef = useRef<HTMLElement>(null)
  const activeJobRef = useRef<HTMLElement>(null)
  const workRef = useRef<HTMLElement>(null)
  const partInputRef = useRef<HTMLInputElement>(null)
  const laborInputRef = useRef<HTMLInputElement>(null)
  const feeInputRef = useRef<HTMLInputElement>(null)
  const settled = stage === 'settled'
  const builderOpen = stage !== 'closed' && !settled
  const visibleJobs = tieMode ? JOBS : JOBS.slice(0, 1)
  const partSaved = ['part-saved', 'labor-form', 'ready', 'fee-form', 'confirm', 'settled'].includes(stage)
  const laborSaved = ['ready', 'fee-form', 'confirm', 'settled'].includes(stage)
  const partCustomerCents = derivePartCustomerCents(partUnitCost, partQuantity)
  const laborLineCents = deriveLaborCents(laborHours, laborRate)
  const subtotalCents = (partSaved ? partCustomerCents ?? 0 : 0)
    + (laborSaved ? laborLineCents ?? 0 : 0)
    + (savedFeeCents ?? 0)
  const taxCents = partSaved && partCustomerCents !== null
    ? Math.round(partCustomerCents * TAX_PERCENT / 100)
    : 0
  const totalCents = subtotalCents + taxCents

  useEffect(() => {
    document.body.dataset.routeChanges = '0'
    document.body.dataset.printCalls = '0'
    document.body.dataset.printReadyAtCall = 'unset'
    window.print = () => {
      document.body.dataset.printReadyAtCall = document
        .querySelector('[data-customer-copy-document]')
        ?.getAttribute('data-print-ready') ?? 'missing'
      document.body.dataset.printCalls = String(Number(document.body.dataset.printCalls ?? '0') + 1)
    }
  }, [])

  useEffect(() => {
    if (!builderOpen) return
    const frame = window.requestAnimationFrame(() => {
      activeJobRef.current?.scrollIntoView({ block: 'start' })
      builderRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [builderOpen])

  useEffect(() => {
    const target = stage === 'part-form'
      ? partInputRef.current
      : stage === 'labor-form'
        ? laborInputRef.current
        : stage === 'fee-form'
          ? feeInputRef.current
          : null
    if (!target) return
    const frame = window.requestAnimationFrame(() => target.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [stage])

  useEffect(() => {
    if (!focusedJob) return
    const frame = window.requestAnimationFrame(() => workRef.current?.scrollIntoView({ block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [focusedJob])

  function closeBuilder(): void {
    setStage('closed')
    window.setTimeout(() => ticketOpenerRef.current?.focus(), 0)
  }

  function savePart(): void {
    if (!partDescription.trim() || !supplier.trim() || partCustomerCents === null) return
    setStage('part-saved')
  }

  function saveLabor(): void {
    if (!laborDescription.trim() || laborLineCents === null) return
    setStage('ready')
  }

  function saveFee(): void {
    const cents = moneyInputToCents(feePrice)
    if (!feeDescription.trim() || cents === null) return
    setSavedFeeCents(cents)
    setStage('ready')
  }

  function settleQuote(): void {
    setStage('settled')
    window.setTimeout(() => activeJobRef.current?.focus(), 0)
  }

  async function refreshCopy(_ticketId: string): Promise<CustomerCopyResult> {
    return { ok: true, copy: proofCustomerCopy }
  }

  return (
    <div className="proofWorkspace" data-lro-proof data-customer-copy-workspace>
      <div className="proofShell" data-customer-copy-shell>
        <header className="proofChrome" data-proof-chrome>
          <a href="#repair-order" className="backAction" aria-label="Back to shop floor">←</a>
          <img src="/brand/lockup.png" width="57" height="48" alt="Vyntechs" />
          <div className="chromeIdentity">
            <strong>RO 001042</strong>
            <span>Open · Synthetic proof</span>
          </div>
        </header>

        <main id="repair-order" className="proofCanvas" data-customer-copy-container>
          <section className="repairOrder" aria-label="Repair order 001042">
            <header className="repairIdentity">
              <div>
                <p className="microLabel">Repair order</p>
                <p className="repairNumber">RO 001042</p>
              </div>
              <div className="customerIdentity">
                <h1>Ada Driver</h1>
                <p>2020 Ford F-150 · 91,240 mi</p>
              </div>
            </header>

            <div className="repairLayout">
              <section className="request" aria-labelledby="request-heading">
                <p className="microLabel">What brought it in</p>
                <h2 id="request-heading">Brake pedal pulses at highway speeds.</h2>
                <p className="requestDetail">Scraping from the front right after rain.</p>
                <dl className="requestFacts">
                  <div><dt>Vehicle</dt><dd>2020 Ford F-150</dd></div>
                  <div><dt>Mileage</dt><dd>91,240 mi</dd></div>
                </dl>
              </section>

              <section ref={workRef} className="work" aria-labelledby="jobs-heading">
                <header className="workHeader">
                  <div>
                    <p className="microLabel">On this repair order</p>
                    <h2 id="jobs-heading">{tieMode ? '2 jobs' : 'Current job'}</h2>
                  </div>
                  <span className="truthCount">{tieMode ? '2 need attention' : settled ? 'Prepared' : 'Needs lines'}</span>
                </header>

                {tieMode && (
                  <div className="tieCommand">
                    <button
                      type="button"
                      className={focusedJob ? 'quietAction' : 'primaryAction'}
                      data-filled-action={focusedJob ? undefined : 'true'}
                      aria-expanded={tieOpen}
                      aria-controls="tie-choices"
                      onClick={() => setTieOpen((open) => !open)}
                    >
                      2 jobs need attention
                    </button>
                    {tieOpen && (
                      <div id="tie-choices" className="tieChoices" aria-label="Choose a job">
                        {JOBS.map((job) => (
                          <button
                            type="button"
                            key={job.id}
                            className="quietAction"
                            onClick={() => {
                              setFocusedJob(job.id)
                              setTieOpen(false)
                            }}
                          >
                            {job.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <ol className="jobList">
                  {visibleJobs.map((job, index) => {
                    const selected = focusedJob === job.id
                    const active = tieMode ? selected : job.id === 'brakes'
                    const jobSettled = active && settled
                    return (
                      <li className="jobRow" key={job.id} data-active={builderOpen && active ? 'true' : undefined} data-settled={jobSettled ? 'true' : undefined}>
                        <span className="jobIndex" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                        <article ref={active ? activeJobRef : undefined} className="jobTruth" tabIndex={active && jobSettled ? -1 : undefined}>
                          <header className="jobHeading">
                            <div>
                              <p>{job.kind} · {job.assignment}</p>
                              <h3>{job.title}</h3>
                            </div>
                            <div className="jobState">
                              <span>{jobSettled ? 'Quote V1 recorded' : 'Not started'}</span>
                              <strong>{jobSettled ? money(totalCents) : 'No lines yet'}</strong>
                            </div>
                          </header>

                          {active && (
                            <button
                              ref={ticketOpenerRef}
                              type="button"
                              className={builderOpen || approvalOpen ? 'quietAction jobAction' : 'primaryAction jobAction'}
                              data-filled-action={builderOpen || approvalOpen ? undefined : 'true'}
                              aria-expanded={builderOpen || approvalOpen}
                              aria-controls={approvalOpen ? 'approval-tool' : 'ticket-builder'}
                              onClick={builderOpen
                                ? closeBuilder
                                : settled
                                  ? () => setApprovalOpen((open) => !open)
                                  : () => setStage('empty')}
                            >
                              {builderOpen
                                ? 'Close ticket builder'
                                : approvalOpen
                                  ? 'Close approval'
                                  : settled
                                    ? 'Record approval'
                                    : 'Build ticket'}
                            </button>
                          )}

                          {jobSettled && (
                            <SettledTruth
                              partCents={partCustomerCents ?? 0}
                              laborCents={laborLineCents ?? 0}
                              feeCents={savedFeeCents}
                              taxCents={taxCents}
                              totalCents={totalCents}
                              approvalRecorded={approvalRecorded}
                            />
                          )}

                          {active && approvalOpen && (
                            <section id="approval-tool" className="approvalTool" aria-label="Record approval">
                              <fieldset>
                                <legend>Customer decision</legend>
                                {[
                                  ['approved', 'Approved'],
                                  ['declined', 'Declined'],
                                  ['deferred', 'Decision deferred'],
                                ].map(([value, label]) => (
                                  <label key={value}>
                                    <input type="radio" name="approval" value={value} checked={approvalChoice === value} onChange={() => setApprovalChoice(value)} />
                                    {label}
                                  </label>
                                ))}
                              </fieldset>
                              <button
                                type="button"
                                className="primaryAction benchAction"
                                data-filled-action="true"
                                onClick={() => {
                                  setApprovalOpen(false)
                                  setApprovalRecorded(true)
                                  window.setTimeout(() => activeJobRef.current?.focus(), 0)
                                }}
                              >
                                Save decision
                              </button>
                            </section>
                          )}

                          {active && builderOpen && (
                            <TicketBuilder
                              ref={builderRef}
                              jobTitle={job.title}
                              stage={stage}
                              supplierMode={supplierMode}
                              supplier={supplier}
                              partDescription={partDescription}
                              partQuantity={partQuantity}
                              partUnitCost={partUnitCost}
                              partCustomerCents={partCustomerCents}
                              laborDescription={laborDescription}
                              laborHours={laborHours}
                              laborRate={laborRate}
                              laborLineCents={laborLineCents}
                              feeDescription={feeDescription}
                              feePrice={feePrice}
                              savedFeeCents={savedFeeCents}
                              partSaved={partSaved}
                              laborSaved={laborSaved}
                              subtotalCents={subtotalCents}
                              taxCents={taxCents}
                              totalCents={totalCents}
                              partInputRef={partInputRef}
                              laborInputRef={laborInputRef}
                              feeInputRef={feeInputRef}
                              setStage={setStage}
                              setSupplierMode={setSupplierMode}
                              setSupplier={setSupplier}
                              setPartDescription={setPartDescription}
                              setPartQuantity={setPartQuantity}
                              setPartUnitCost={setPartUnitCost}
                              setLaborDescription={setLaborDescription}
                              setLaborHours={setLaborHours}
                              setLaborRate={setLaborRate}
                              setFeeDescription={setFeeDescription}
                              setFeePrice={setFeePrice}
                              onSavePart={savePart}
                              onSaveLabor={saveLabor}
                              onSaveFee={saveFee}
                              onSettle={settleQuote}
                            />
                          )}
                        </article>
                      </li>
                    )
                  })}
                </ol>

                <details className="moreDoor">
                  <summary>More</summary>
                  <ul>
                    <li>Add work</li>
                    <li>Repair order history</li>
                  </ul>
                </details>
              </section>
            </div>
          </section>

          <section className="customerCopyDoor" data-screen-customer-copy>
            <button type="button" className="quietAction" aria-expanded={customerCopyOpen} onClick={() => setCustomerCopyOpen((open) => !open)}>
              Customer copy
            </button>
          </section>

          {customerCopyOpen && (
            <CustomerCopy copy={proofCustomerCopy} canManageShopIdentity={false} ticketId="00000000-0000-4000-8000-000000000020" refreshCopy={refreshCopy} />
          )}
        </main>
      </div>
    </div>
  )
}

type TicketBuilderProps = {
  ref: React.Ref<HTMLElement>
  jobTitle: string
  stage: Exclude<BuilderStage, 'closed' | 'settled'>
  supplierMode: SupplierMode
  supplier: string
  partDescription: string
  partQuantity: string
  partUnitCost: string
  partCustomerCents: number | null
  laborDescription: string
  laborHours: string
  laborRate: string
  laborLineCents: number | null
  feeDescription: string
  feePrice: string
  savedFeeCents: number | null
  partSaved: boolean
  laborSaved: boolean
  subtotalCents: number
  taxCents: number
  totalCents: number
  partInputRef: React.RefObject<HTMLInputElement | null>
  laborInputRef: React.RefObject<HTMLInputElement | null>
  feeInputRef: React.RefObject<HTMLInputElement | null>
  setStage: (stage: BuilderStage) => void
  setSupplierMode: (mode: SupplierMode) => void
  setSupplier: (value: string) => void
  setPartDescription: (value: string) => void
  setPartQuantity: (value: string) => void
  setPartUnitCost: (value: string) => void
  setLaborDescription: (value: string) => void
  setLaborHours: (value: string) => void
  setLaborRate: (value: string) => void
  setFeeDescription: (value: string) => void
  setFeePrice: (value: string) => void
  onSavePart: () => void
  onSaveLabor: () => void
  onSaveFee: () => void
  onSettle: () => void
}

function TicketBuilder(props: TicketBuilderProps): React.JSX.Element {
  const {
    ref, jobTitle, stage, supplierMode, supplier, partDescription, partQuantity,
    partUnitCost, partCustomerCents, laborDescription, laborHours, laborRate,
    laborLineCents, feeDescription, feePrice, savedFeeCents, partSaved, laborSaved,
    subtotalCents, taxCents, totalCents, partInputRef, laborInputRef, feeInputRef,
    setStage, setSupplierMode, setSupplier, setPartDescription, setPartQuantity,
    setPartUnitCost, setLaborDescription, setLaborHours, setLaborRate,
    setFeeDescription, setFeePrice, onSavePart, onSaveLabor, onSaveFee, onSettle,
  } = props
  return (
    <section id="ticket-builder" ref={ref} tabIndex={-1} className="quoteBench" aria-label="Ticket builder">
      <header className="benchHeading">
        <div>
          <p className="microLabel">Temporary tool · {jobTitle}</p>
          <h4>Ticket builder</h4>
        </div>
        <span>{partSaved || laborSaved ? `${Number(partSaved) + Number(laborSaved) + Number(savedFeeCents !== null)} saved` : 'No lines yet'}</span>
      </header>

      {stage === 'empty' && (
        <div className="benchEmpty" data-builder-empty>
          <p>No parts, labor, or fees are on this job yet.</p>
          <button type="button" className="primaryAction benchAction" data-filled-action="true" onClick={() => setStage('part-choice')}>Add a part</button>
        </div>
      )}

      {stage === 'part-choice' && (
        <PartSourceDoors
          onAttach={() => { setSupplierMode('attached'); setStage('part-form') }}
          onManual={() => { setSupplierMode('manual'); setStage('part-form') }}
        />
      )}

      {stage === 'part-form' && (
        <section id="part-workspace" className="lineWorkspace" aria-labelledby="part-workspace-heading">
          <PartSourceLabels mode={supplierMode} />
          <h5 id="part-workspace-heading">{supplierMode === 'attached' ? 'Attach my part' : 'Enter supplier manually'}</h5>
          <div className="fieldGrid">
            <label className="wideField">Supplier <input ref={partInputRef} value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Enter supplier name" /></label>
            <label className="wideField">Part description <input value={partDescription} onChange={(event) => setPartDescription(event.target.value)} placeholder="What is the part?" /></label>
            <label>Quantity <input data-part-quantity inputMode="decimal" value={partQuantity} onChange={(event) => setPartQuantity(event.target.value)} /></label>
            <label>Supplier unit cost <input data-part-unit-cost inputMode="decimal" value={partUnitCost} onChange={(event) => setPartUnitCost(event.target.value)} placeholder="0.00" /></label>
          </div>
          <div className="calculation" data-part-calculation>
            <span>Customer line price</span>
            <strong data-part-customer-price>{partCustomerCents === null ? 'Enter cost and quantity' : money(partCustomerCents)}</strong>
            <small>Supplier cost × quantity + {PARTS_MARKUP_PERCENT}% shop markup</small>
          </div>
          <button type="button" className="primaryAction benchAction" data-filled-action="true" disabled={!supplier.trim() || !partDescription.trim() || partCustomerCents === null} onClick={onSavePart}>Save part</button>
        </section>
      )}

      {stage === 'part-saved' && (
        <>
          <SavedLines partCents={partCustomerCents ?? 0} laborCents={null} feeCents={null} laborHours={laborHours} laborRate={laborRate} />
          <button type="button" className="primaryAction benchAction" data-filled-action="true" onClick={() => setStage('labor-form')}>Add labor</button>
        </>
      )}

      {stage === 'labor-form' && (
        <>
          <SavedLines partCents={partCustomerCents ?? 0} laborCents={null} feeCents={null} laborHours={laborHours} laborRate={laborRate} />
          <section id="labor-workspace" className="lineWorkspace" aria-labelledby="labor-workspace-heading">
            <h5 id="labor-workspace-heading">Add labor</h5>
            <div className="fieldGrid">
              <label className="wideField">Labor description <input ref={laborInputRef} value={laborDescription} onChange={(event) => setLaborDescription(event.target.value)} placeholder="Work being performed" /></label>
              <label>Hours <input data-labor-hours inputMode="decimal" value={laborHours} onChange={(event) => setLaborHours(event.target.value)} placeholder="0.00" /></label>
              <label>Rate per hour <input data-labor-rate inputMode="decimal" value={laborRate} onChange={(event) => setLaborRate(event.target.value)} /></label>
            </div>
            <div className="calculation" data-labor-calculation>
              <span>Calculated labor line</span>
              <strong data-labor-line-price>{laborLineCents === null ? 'Enter hours and rate' : money(laborLineCents)}</strong>
              <small>{laborHours || 'Hours'} × {moneyInputLabel(laborRate)}/hr</small>
            </div>
            <button type="button" className="primaryAction benchAction" data-filled-action="true" disabled={!laborDescription.trim() || laborLineCents === null} onClick={onSaveLabor}>Save labor</button>
          </section>
        </>
      )}

      {(stage === 'ready' || stage === 'fee-form' || stage === 'confirm') && (
        <>
          <SavedLines partCents={partCustomerCents ?? 0} laborCents={laborLineCents ?? 0} feeCents={savedFeeCents} laborHours={laborHours} laborRate={laborRate} />
          <Totals subtotalCents={subtotalCents} taxCents={taxCents} totalCents={totalCents} partCents={partCustomerCents ?? 0} laborCents={laborLineCents ?? 0} feeCents={savedFeeCents ?? 0} />
        </>
      )}

      {stage === 'ready' && (
        <div className="readyActions">
          <button type="button" className="quietAction" onClick={() => setStage('fee-form')}>Add fee <span>(optional)</span></button>
          <button type="button" className="primaryAction" data-filled-action="true" onClick={() => setStage('confirm')}>Prepare quote</button>
        </div>
      )}

      {stage === 'fee-form' && (
        <section id="fee-workspace" className="lineWorkspace" aria-labelledby="fee-workspace-heading">
          <h5 id="fee-workspace-heading">Add fee <span>Optional</span></h5>
          <div className="fieldGrid">
            <label className="wideField">Fee description <input ref={feeInputRef} value={feeDescription} onChange={(event) => setFeeDescription(event.target.value)} /></label>
            <label className="wideField">Line price <input inputMode="decimal" value={feePrice} onChange={(event) => setFeePrice(event.target.value)} /></label>
          </div>
          <div className="dualActions">
            <button type="button" className="quietAction" onClick={() => setStage('ready')}>Cancel fee</button>
            <button type="button" className="primaryAction" data-filled-action="true" disabled={!feeDescription.trim() || moneyInputToCents(feePrice) === null} onClick={onSaveFee}>Save fee</button>
          </div>
        </section>
      )}

      {stage === 'confirm' && (
        <section className="confirmPrice" role="dialog" aria-label="Confirm prepared quote">
          <p>This records Quote V1 from the {2 + Number(savedFeeCents !== null)} visible saved lines.</p>
          <div className="dualActions">
            <button type="button" className="quietAction" onClick={() => setStage('ready')}>Back</button>
            <button type="button" className="primaryAction" data-filled-action="true" onClick={onSettle}>Prepare {money(totalCents)}</button>
          </div>
        </section>
      )}
    </section>
  )
}

function PartSourceDoors({ onAttach, onManual }: { onAttach: () => void; onManual: () => void }): React.JSX.Element {
  return (
    <section className="partSources" aria-labelledby="part-source-heading">
      <h5 id="part-source-heading">Add a part</h5>
      <PartSourceLabels />
      <div className="currentPaths">
        <button type="button" className="primaryAction" data-filled-action="true" onClick={onAttach}>Attach my part</button>
        <button type="button" className="quietAction" onClick={onManual}>Enter supplier manually</button>
      </div>
    </section>
  )
}

function PartSourceLabels({ mode }: { mode?: SupplierMode }): React.JSX.Element {
  return (
    <div className="sourceDoors">
      <p>Search supplier <span>Planned connectors · not live</span></p>
      <div aria-label="Planned supplier connectors">
        {['O’Reilly First Call', 'PartsTech', 'RepairLink'].map((name) => <span key={name}>{name}<small>Planned</small></span>)}
      </div>
      {mode && <p className="currentPath">Current path · {mode === 'attached' ? 'Attach my part' : 'Manual supplier entry'}</p>}
    </div>
  )
}

function SavedLines({ partCents, laborCents, feeCents, laborHours, laborRate }: {
  partCents: number
  laborCents: number | null
  feeCents: number | null
  laborHours: string
  laborRate: string
}): React.JSX.Element {
  return (
    <ul className="savedLines" aria-label="Saved ticket lines">
      <li data-line-kind="part" data-line-total-cents={partCents}>
        <div><span>Part</span><strong>Front brake pad set</strong><small>1 × supplier cost + 40% markup</small></div>
        <b>{money(partCents)}</b>
      </li>
      {laborCents !== null && (
        <li data-line-kind="labor" data-line-total-cents={laborCents}>
          <div><span>Labor</span><strong>Install front brake pads</strong><small>{laborHours} hr × {moneyInputLabel(laborRate)}/hr</small></div>
          <b>{money(laborCents)}</b>
        </li>
      )}
      {feeCents !== null && (
        <li data-line-kind="fee" data-line-total-cents={feeCents}>
          <div><span>Fee</span><strong>Shop fee</strong></div><b>{money(feeCents)}</b>
        </li>
      )}
    </ul>
  )
}

function Totals({ subtotalCents, taxCents, totalCents, partCents, laborCents, feeCents }: {
  subtotalCents: number
  taxCents: number
  totalCents: number
  partCents: number
  laborCents: number
  feeCents: number
}): React.JSX.Element {
  return (
    <dl
      className="quoteTotals"
      data-quote-math
      data-part-cents={partCents}
      data-labor-cents={laborCents}
      data-fee-cents={feeCents}
      data-tax-cents={taxCents}
      data-total-cents={totalCents}
    >
      <div><dt>Subtotal</dt><dd>{money(subtotalCents)}</dd></div>
      <div><dt>Tax · {TAX_PERCENT}% on part</dt><dd>{money(taxCents)}</dd></div>
      <div data-quote-total><dt>Quote total</dt><dd>{money(totalCents)}</dd></div>
    </dl>
  )
}

function SettledTruth({ partCents, laborCents, feeCents, taxCents, totalCents, approvalRecorded }: {
  partCents: number
  laborCents: number
  feeCents: number | null
  taxCents: number
  totalCents: number
  approvalRecorded: boolean
}): React.JSX.Element {
  return (
    <div className="settledTruth" role="status" aria-live="polite">
      <div className="settleReceipt"><span aria-hidden="true" /><p>{approvalRecorded ? 'Customer decision recorded.' : 'Saved ticket lines settled into this job.'}</p></div>
      <dl>
        <div><dt>Part</dt><dd>{money(partCents)}</dd></div>
        <div><dt>Labor</dt><dd>{money(laborCents)}</dd></div>
        {feeCents !== null && <div><dt>Fee</dt><dd>{money(feeCents)}</dd></div>}
        <div><dt>Tax</dt><dd>{money(taxCents)}</dd></div>
        <div><dt>Prepared total</dt><dd>{money(totalCents)}</dd></div>
      </dl>
    </div>
  )
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function moneyInputToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null
  const cents = Math.round(Number(trimmed) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

function decimalInput(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function derivePartCustomerCents(unitCost: string, quantity: string): number | null {
  const unitCents = moneyInputToCents(unitCost)
  const count = decimalInput(quantity)
  if (unitCents === null || count === null) return null
  return Math.round(unitCents * count * (1 + PARTS_MARKUP_PERCENT / 100))
}

function deriveLaborCents(hours: string, rate: string): number | null {
  const parsedHours = decimalInput(hours)
  const rateCents = moneyInputToCents(rate)
  if (parsedHours === null || rateCents === null) return null
  return Math.round(parsedHours * rateCents)
}

function moneyInputLabel(value: string): string {
  const cents = moneyInputToCents(value)
  return cents === null ? 'Enter rate' : money(cents)
}

const root = document.getElementById('root')
if (!root) throw new Error('Living Repair Order proof root missing')
const proofMode = new URLSearchParams(window.location.search).get('mode')
createRoot(root).render(proofMode === 'implementation' ? <ImplementationHarness /> : <Harness />)
