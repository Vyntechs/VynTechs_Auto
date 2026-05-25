import Link from 'next/link'
import {
  ScenarioChip,
  MethodChip,
  InvasivenessDots,
  SymptomHero,
  CachedInstantBadge,
  ConfidenceGate,
} from '@/components/vt'
import { AbandonButton } from '@/components/screens/abandon-button'
import type { CachedDiagnostic, CachedDiagnosticTest } from '@/lib/diagnostics/cached-lookup'
import { symptomLabel } from '@/lib/diagnostics/symptom-label'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  sessionId: string
  diagnostic: CachedDiagnostic
  vehicleName: string
  vin: string | null
  mileage: number | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Mobile ledger row — mirrors RowLedger from the design package. */
function LedgerRow({ test }: { test: CachedDiagnosticTest }) {
  return (
    <div className="cov-row">
      <div className="cov-row__prio">{String(test.priority).padStart(2, '0')}</div>
      <div className="cov-row__body">
        <div className="cov-row__name">{test.description}</div>
        <div className="cov-row__chips">
          <ScenarioChip>{test.scenario}</ScenarioChip>
          <MethodChip method={test.observationMethod} />
        </div>
        {test.expectedReading !== null && (
          <div className="cov-row__expected">
            <b>expect</b>{' '}
            {test.expectedReading}
          </div>
        )}
      </div>
      <div className="cov-row__inv">
        <InvasivenessDots value={test.invasiveness} />
      </div>
    </div>
  )
}

/** Tiny inline brand sigil for the desktop rail. */
function BrandSigil() {
  return (
    <span style={{ display: 'inline-block', width: 10, height: 14 }}>
      <svg viewBox="0 0 56 80" width="10" height="14" aria-hidden="true">
        <line x1="10" y1="6" x2="10" y2="74" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="46" y1="6" x2="46" y2="74" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="10" y1="22" x2="46" y2="22" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="10" y1="42" x2="46" y2="42" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="10" y1="62" x2="46" y2="62" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Mobile layout — V1 Ledger (ScreenLedger from design package)
// ---------------------------------------------------------------------------

function MobileOverview({ sessionId, diagnostic, vehicleName, vin, mileage }: Props) {
  const { symptom, gateThreshold, priorFixCount, tests } = diagnostic

  const vinLine = [vin ? `VIN · ${vin}` : null, mileage !== null ? `${mileage.toLocaleString()} mi` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="cov-app">
      {/* Back out — so the screen is never a dead end on mobile */}
      <Link
        href="/today"
        style={{
          display: 'block',
          padding: '10px 16px 0',
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--vt-fg-3)',
          textDecoration: 'none',
        }}
      >
        ← Sessions
      </Link>

      {/* Vehicle strip with cached badge instead of timer */}
      <header className="vehicle-strip">
        <div>
          <div className="vehicle-name">{vehicleName}</div>
          {vinLine && <div className="vin">{vinLine}</div>}
        </div>
        <CachedInstantBadge />
      </header>

      <SymptomHero
        dtc={symptom.dtcDisplay}
        name={symptomLabel(symptom.slug)}
        gate={gateThreshold}
        priorFixCount={priorFixCount}
      />

      <div className="cov-plan-header">
        <span className="cov-plan-header__lead">Test plan</span>
        <span className="cov-plan-header__count">
          <strong>{tests.length}</strong> steps · By information value
        </span>
      </div>

      <div className="cov-list" style={{ flex: 1, overflowY: 'auto' }}>
        {tests.map((t, i) => (
          <LedgerRow key={i} test={t} />
        ))}
      </div>

      {/* Footer: honest status note + a real way to take the case off the
          queue. The step-by-step walkthrough lands in a later update. */}
      <footer
        style={{
          borderTop: '0.5px solid var(--vt-rule)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 9.5,
            letterSpacing: '0.08em',
            color: 'var(--vt-fg-3)',
          }}
        >
          Read the test plan above and work it in the bay. The tap-through
          walkthrough is coming in the next update.
        </span>
        <AbandonButton sessionId={sessionId} redirectTo="/today" />
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop layout — DesktopOverview from design package (no fake identity data)
// ---------------------------------------------------------------------------

function DesktopOverview({ sessionId, diagnostic, vehicleName, vin, mileage }: Props) {
  const { symptom, gateThreshold, priorFixCount, tests } = diagnostic
  const gatePct = (Math.max(0, Math.min(1, gateThreshold)) * 100).toFixed(0)

  const uniqueMethods = new Set(tests.map((t) => t.observationMethod)).size

  const vinLine = [vin ? `VIN · ${vin}` : null, mileage !== null ? `${mileage.toLocaleString()} mi` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="cov-desktop">
      {/* Left rail */}
      <aside className="cov-desktop__rail">
        <div className="cov-desktop__brand">
          <BrandSigil />
          Vyntechs
        </div>

        <div>
          <Link
            href="/today"
            className="cov-desktop__back"
            style={{ textDecoration: 'none' }}
          >
            ← Back to sessions
          </Link>
          <div className="cov-desktop__vehicle-name">{vehicleName}</div>
          {vinLine && <div className="cov-desktop__vin">{vinLine}</div>}
        </div>

        <div>
          <div
            style={{
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--vt-fg-3)',
              marginBottom: 10,
            }}
          >
            Cached diagnostic
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              color: 'var(--vt-fg-3)',
              letterSpacing: '0.06em',
              lineHeight: 1.7,
            }}
          >
            <div>
              <span style={{ color: 'var(--vt-fg-2)' }}>{tests.length}</span>{' '}
              {tests.length === 1 ? 'ordered test' : 'ordered tests'}
            </div>
            <div>
              <span style={{ color: 'var(--vt-fg-2)' }}>{uniqueMethods}</span>{' '}
              {uniqueMethods === 1 ? 'observation method' : 'observation methods'}
            </div>
            {priorFixCount > 0 && (
              <div>
                <span style={{ color: 'var(--vt-fg-2)' }}>{priorFixCount}</span>{' '}
                {priorFixCount === 1 ? 'corpus match' : 'corpus matches'}
              </div>
            )}
            <div>
              <span style={{ color: 'var(--vt-fg-2)' }}>{gatePct} %</span> commit gate
            </div>
          </div>
        </div>
      </aside>

      {/* Main panel */}
      <main className="cov-desktop__main">
        {/* Top bar */}
        <div className="cov-desktop__topbar">
          <div className="cov-desktop__topbar-meta">
            <span style={{ color: 'var(--vt-amber-500)' }}>● Cached — Instant</span>
          </div>
          <div className="cov-desktop__topbar-meta">
            <span>By information value</span>
          </div>
        </div>

        {/* Hero: symptom + gate card */}
        <div className="cov-desktop__hero">
          <div>
            <div className="cov-symptom__eyebrow">
              <span>Matched symptom</span>
              {symptom.dtcDisplay && (
                <span className="cov-symptom__dtc">{symptom.dtcDisplay}</span>
              )}
            </div>
            <h1 className="cov-desktop__symptom">{symptomLabel(symptom.slug)}</h1>
            {priorFixCount > 0 && (
              <div
                style={{
                  fontFamily: 'var(--vt-font-mono)',
                  fontSize: 10,
                  color: 'var(--vt-fg-3)',
                  marginTop: 6,
                  letterSpacing: '0.06em',
                }}
              >
                {priorFixCount} prior {priorFixCount === 1 ? 'fix' : 'fixes'} · cross-shop corpus
              </div>
            )}
          </div>

          <div className="cov-desktop__gate-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--vt-font-mono)',
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--vt-fg-3)',
                }}
              >
                Commit gate
              </span>
              <span
                style={{
                  fontFamily: 'var(--vt-font-mono)',
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--vt-amber-500)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                ≥ {gatePct} %
              </span>
            </div>
            <div className="cov-gate" style={{ padding: '4px 0 0' }}>
              <div className="cov-gate__track" style={{ flex: 1 }}>
                <div className="cov-gate__mark" style={{ left: `${gatePct}%` }} />
              </div>
            </div>
            <div
              style={{
                fontFamily: 'var(--vt-font-mono)',
                fontSize: 9.5,
                color: 'var(--vt-fg-3)',
                letterSpacing: '0.08em',
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              No single test commits.
              <br />
              Cumulative confidence must clear the gate.
            </div>
          </div>
        </div>

        {/* Plan table */}
        <div className="cov-desktop__plan">
          <div className="cov-desktop__plan-head">
            <span>#</span>
            <span>Test</span>
            <span>Condition</span>
            <span>Method</span>
            <span>Expect</span>
            <span style={{ textAlign: 'right' }}>Inv</span>
          </div>
          {tests.map((t, i) => (
            <div key={i} className="cov-desktop__plan-row">
              <div className="prio">{String(t.priority).padStart(2, '0')}</div>
              <div className="name">{t.description}</div>
              <div className="scenario">
                <ScenarioChip>{t.scenario}</ScenarioChip>
              </div>
              <div className="method">
                <MethodChip method={t.observationMethod} />
              </div>
              <div className="expected">{t.expectedReading ?? '—'}</div>
              <div className="inv">
                <InvasivenessDots value={t.invasiveness} />
              </div>
            </div>
          ))}
        </div>

        {/* Footer bar: honest status note + a real way off the queue. */}
        <div className="cov-desktop__cta-bar">
          <div className="cov-desktop__topbar-meta">
            <span>Test plan ready</span>
            <span className="sep" />
            <span style={{ color: 'var(--vt-fg-2)', fontFamily: 'var(--vt-font-serif)', fontSize: 14, textTransform: 'none', letterSpacing: 0 }}>
              Work the plan in the bay — the tap-through walkthrough is coming in the next update
            </span>
          </div>
          <AbandonButton sessionId={sessionId} redirectTo="/today" />
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public export — both layouts in DOM; CSS media query toggles at 1024px
// ---------------------------------------------------------------------------

export function CachedOverview(props: Props) {
  return (
    <>
      <MobileOverview {...props} />
      <DesktopOverview {...props} />
    </>
  )
}
