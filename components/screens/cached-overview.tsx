import Link from 'next/link'
import {
  ScenarioChip,
  MethodChip,
  InvasivenessDots,
  SymptomHero,
  CachedInstantBadge,
  CtaBar,
  ConfidenceGate,
} from '@/components/vt'
import type { CachedDiagnostic, CachedDiagnosticTest } from '@/lib/diagnostics/cached-lookup'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
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
            <b>expect</b>
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
// Shared CTA props — PR1 ships disabled; walkthrough arrives in PR2.
// ---------------------------------------------------------------------------

const CTA_PROPS = {
  label: 'Start diagnosis',
  disabled: true,
  leadLeft: 'Test plan ready',
  leadRight: 'Interactive walkthrough — coming in the next update',
} as const

// ---------------------------------------------------------------------------
// Mobile layout — V1 Ledger (ScreenLedger from design package)
// ---------------------------------------------------------------------------

function MobileOverview({ diagnostic, vehicleName, vin, mileage }: Props) {
  const { symptom, gateThreshold, priorFixCount, tests } = diagnostic

  const vinLine = [vin ? `VIN · ${vin}` : null, mileage !== null ? `${mileage.toLocaleString()} mi` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="cov-app">
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
        name={symptom.description}
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
        {tests.map((t) => (
          <LedgerRow key={t.priority} test={t} />
        ))}
      </div>

      <CtaBar {...CTA_PROPS} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop layout — DesktopOverview from design package (no fake identity data)
// ---------------------------------------------------------------------------

function DesktopOverview({ diagnostic, vehicleName, vin, mileage }: Props) {
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
              <span style={{ color: 'var(--vt-fg-2)' }}>{tests.length}</span> ordered tests
            </div>
            <div>
              <span style={{ color: 'var(--vt-fg-2)' }}>{uniqueMethods}</span> observation methods
            </div>
            {priorFixCount > 0 && (
              <div>
                <span style={{ color: 'var(--vt-fg-2)' }}>{priorFixCount}</span> corpus matches
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
            <h1 className="cov-desktop__symptom">{symptom.description}</h1>
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
                {priorFixCount} prior fixes · cross-shop corpus
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
          {tests.map((t) => (
            <div key={t.priority} className="cov-desktop__plan-row">
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

        {/* CTA bar */}
        <div className="cov-desktop__cta-bar">
          <div className="cov-desktop__topbar-meta">
            <span>Test plan ready</span>
            <span className="sep" />
            <span style={{ color: 'var(--vt-fg-2)', fontFamily: 'var(--vt-font-serif)', fontSize: 14, textTransform: 'none', letterSpacing: 0 }}>
              Interactive walkthrough — coming in the next update
            </span>
          </div>
          <CtaBar {...CTA_PROPS} />
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
