type PricingProps = { isSignedIn: boolean }

const INCLUSIONS = [
  {
    title: 'Unlimited diagnostic sessions',
    sub: 'No per-session caps, no per-VIN caps. Every active session, every observation, every commit-or-decline.',
  },
  {
    title: 'Three-rung retrieval',
    sub: 'Your shop corpus + the open web for that exact car + tech-assist when evidence is thin. Every claim cited inline.',
  },
  {
    title: 'Confidence-gated commit',
    sub: 'Default 95% threshold. Below-gate destructive actions are refused — not warned, not greyed out, gone.',
  },
  {
    title: 'Today queue',
    sub: 'Your morning bay schedule — in-progress sessions, closed today, follow-ups due. Built for the shop floor.',
  },
  {
    title: 'Per-vehicle history',
    sub: 'Every prior session for a VIN shows up automatically the next time it comes through your bay.',
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
            We don&rsquo;t sell shop tiers. We don&rsquo;t sell platinum
            bay-fleet packs. We sell one thing: an account, for one technician,
            for one month. Scale it by hiring; cancel it when you don&rsquo;t.
          </p>
        </div>
      </div>

      <div className="vm-pricing">
        <div className="vm-price-main">
          <div className="vm-price-eyebrow">
            <span className="vm-dot" />
            Technician account &middot; monthly
          </div>
          <h3 className="vm-price-name">
            Vyntechs <em>Bay</em>
          </h3>
          <p className="vm-price-desc">
            A single technician seat. Full retrieval, full confidence gating,
            full session history. Cancel anytime; your sessions stay yours.
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
            USD &middot; billed monthly &middot; cancel anytime
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
            Your sessions and shop corpus stay yours. You can come back anytime.
          </div>
        </div>
        <div className="vm-price-fine-cell">
          <div className="vm-price-fine-h">Shop packages</div>
          <div className="vm-price-fine-b">
            <em>Not yet.</em> If you need 30+ seats, we&rsquo;ll talk. Otherwise
            add one tech, pay $100, scale as you hire.
          </div>
        </div>
      </div>
    </section>
  )
}
