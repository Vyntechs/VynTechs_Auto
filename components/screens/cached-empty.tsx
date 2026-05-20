// Ports ScreenEmpty from the Claude Design package.
// Not wired into any route in PR1 — exists and compiles; PR4 will wire it.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  vehicleName: string
  complaint: string
  mileage: number | null
}

// ---------------------------------------------------------------------------
// Brand sigil — ladder of rungs (inline SVG, no import dep)
// ---------------------------------------------------------------------------

function Sigil({ size = 56 }: { size?: number }) {
  const h = size * 1.43
  return (
    <svg
      className="cov-sigil"
      width={size}
      height={h}
      viewBox="0 0 56 80"
      aria-hidden="true"
    >
      {/* two side rails */}
      <line x1="10" y1="6" x2="10" y2="74" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      <line x1="46" y1="6" x2="46" y2="74" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      {/* top two rungs — amber (gathered knowledge) */}
      <line x1="10" y1="18" x2="46" y2="18" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="35" x2="46" y2="35" stroke="var(--vt-amber-500)" strokeWidth="2" strokeLinecap="round" />
      {/* bottom two rungs — hairline dashed (unknown territory) */}
      <line x1="10" y1="52" x2="46" y2="52" stroke="var(--vt-bone-400)" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round" />
      <line x1="10" y1="69" x2="46" y2="69" stroke="var(--vt-bone-400)" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// CachedEmpty — "first time we've seen this combo"
// ---------------------------------------------------------------------------

export function CachedEmpty({ vehicleName, complaint, mileage }: Props) {
  return (
    <div className="cov-empty">
      <div className="cov-empty__body">
        <span className="cov-empty__eyebrow">Not in the library</span>

        <Sigil size={48} />

        <h1 className="cov-empty__headline">First time we&apos;ve seen this one.</h1>

        <p className="cov-empty__sub">
          No matching diagnostic is cached for this vehicle and complaint. A
          custom plan can be built from the cross-shop corpus — 30–60 seconds —
          and every identical complaint after this loads instantly.
        </p>

        <div className="cov-empty__ctx">
          <div className="cov-empty__ctx-row">
            <span>Vehicle</span>
            <b>{vehicleName}</b>
          </div>
          <div className="cov-empty__ctx-row">
            <span>Complaint</span>
            <b>{complaint}</b>
          </div>
          {mileage !== null && (
            <div className="cov-empty__ctx-row">
              <span>Mileage</span>
              <b>{mileage.toLocaleString()} mi</b>
            </div>
          )}
        </div>

        <div>
          <span
            className="cov-empty__eyebrow"
            style={{ marginBottom: 8, display: 'flex' }}
          >
            What happens next
          </span>
          <div className="cov-empty__steps">
            <div className="cov-empty__step">
              <span className="cov-empty__step-num">01</span>
              <span className="cov-empty__step-body">
                Similar fixes are ranked from the cross-shop corpus.
                <span className="cov-empty__step-meta">~10 s · corpus retrieval</span>
              </span>
            </div>
            <div className="cov-empty__step">
              <span className="cov-empty__step-num">02</span>
              <span className="cov-empty__step-body">
                An ordered test plan with confidence gates is assembled.
                <span className="cov-empty__step-meta">~30 s · tree generation</span>
              </span>
            </div>
            <div className="cov-empty__step">
              <span className="cov-empty__step-num">03</span>
              <span className="cov-empty__step-body">
                The plan joins the library — instant for the next tech.
                <span className="cov-empty__step-meta">corpus gain · +1</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="cov-empty__cta-wrap">
        {/* CTA is inert in PR1 — this screen is not wired into any route yet */}
        <button className="cov-cta__btn" disabled>
          <span>Build a diagnostic plan</span>
        </button>
      </div>
    </div>
  )
}
