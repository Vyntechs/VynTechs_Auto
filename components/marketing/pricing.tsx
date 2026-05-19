type PricingProps = { isSignedIn: boolean }

const INCLUSIONS = [
  {
    title: 'Unlimited diagnostic sessions',
    sub: 'No per-session caps, no per-VIN caps. Every intake, every observation, every gated commit-or-decline runs through the same retrieval and calibration stack.',
  },
  {
    title: 'Three-rung retrieval, six-source web',
    sub: 'Per-shop corpus on Voyage 1024-d vectors, plus OEM / NHTSA / manufacturer-recall / forum / YouTube / Reddit web sweep, plus a 1+2-capped tech-assist when evidence is thin. Every claim cited inline.',
  },
  {
    title: 'Calibrated confidence gate',
    sub: 'Default 95% floor, refit weekly per (risk × vehicle-family × symptom) cell via Beta-Binomial. Below-gate cuts, splices, and reflashes are refused — not warned, not greyed out, gone.',
  },
  {
    title: 'Vision extraction off the bay floor',
    sub: 'Photograph a wiring diagram, scan-screen, build-code label, or component tag. The vision extractor pulls DTCs, pinouts, wire colors, and build codes straight into the session.',
  },
  {
    title: 'Today queue · shop-floor surface',
    sub: 'Open sessions, closed today, comeback follow-ups due. Daily comeback prompts feed back into per-cell calibration.',
  },
  {
    title: 'Per-VIN history, automatic',
    sub: 'Every prior session for that VIN surfaces on the next intake — DTC history, prior commits, comebacks, the works. The corpus compounds per shop with every closed case.',
  },
]

export function Pricing({ isSignedIn }: PricingProps) {
  const href = isSignedIn ? '/today' : '/sign-up'
  const label = isSignedIn ? 'Go to app' : 'Subscribe — $100/month'

  return (
    <section className="vm-section" id="pricing" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num">
          <b>§ 04</b>Pricing
        </div>
        <div>
          <h2 className="vm-section-title">
            One plan. <em>Per technician.</em> No bundles, no seat-haggling.
          </h2>
          <p className="vm-section-lede">
            No shop tiers. No bay-fleet packs. No annual lock. One
            account, one tech, one month, Stripe-billed end-to-end. Scale
            it by hiring; cancel it when you don&rsquo;t.
          </p>
        </div>
      </div>

      <div className="vm-pricing">
        <div className="vm-price-main">
          <div className="vm-price-eyebrow">
            <span className="vm-dot" />
            Technician seat &middot; monthly &middot; Stripe
          </div>
          <h3 className="vm-price-name">
            Vyntechs <em>Bay</em>
          </h3>
          <p className="vm-price-desc">
            A single technician seat. Full three-rung retrieval, full
            calibrated risk-class gating, full per-VIN history, full
            vision capture. Cancel anytime; your corpus stays yours.
          </p>

          <div className="vm-price-tag">
            <div className="vm-price-num">
              <small>$</small>100
            </div>
            <div className="vm-price-per">
              <b>per technician</b>
              per month &middot; billed monthly
            </div>
          </div>

          <div className="vm-price-cta">
            <a href={href} className="vm-btn vm-btn--accent">
              {label}
            </a>
          </div>
          <div className="vm-price-foot">
            USD &middot; Stripe &middot; monthly billing &middot; cancel via portal
          </div>
        </div>

        <div className="vm-price-side">
          <h4>What every seat includes</h4>

          {INCLUSIONS.map((inc) => (
            <div className="vm-incl" key={inc.title}>
              <span className="vm-incl-tick">
                <svg viewBox="0 0 14 14" fill="none" strokeWidth="2">
                  <path
                    d="M3 7.5 L6 10.2 L11 4.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="vm-incl-text">
                {inc.title}
                <small>{inc.sub}</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="vm-price-fine">
        <div className="vm-price-fine-cell">
          <div className="vm-price-fine-h">Billing</div>
          <div className="vm-price-fine-b">
            Monthly, on the day you started. No annual lock-in.
          </div>
        </div>
        <div className="vm-price-fine-cell">
          <div className="vm-price-fine-h">If you cancel</div>
          <div className="vm-price-fine-b">
            Sessions and per-shop corpus belong to the shop. Daily DB
            backups; US-hosted on Supabase; encrypted at rest. Come back
            anytime.
          </div>
        </div>
        <div className="vm-price-fine-cell">
          <div className="vm-price-fine-h">Multi-seat &amp; partnership</div>
          <div className="vm-price-fine-b">
            For 30+ seats, MSO rollups, or integration conversations,
            reach out directly. Otherwise add one tech, pay $100, scale
            as you hire.
          </div>
        </div>
      </div>
    </section>
  )
}
