type PricingProps = { isSignedIn: boolean }

const INCLUSIONS = [
  ['Work orders', 'Counter and quick-ticket intake feed one durable repair record.'],
  ['Assignments and job flow', 'Give work a clear owner and keep its current state visible.'],
  ['Manual findings and text work notes', 'Record the bay truth without requiring an automated engine.'],
  ['Quotes and authorization', 'Build work lines and keep the customer decision with the job.'],
  ['Vehicle and customer facts', 'Keep the identity needed to run the repair order accurately.'],
] as const

export function Pricing({ isSignedIn }: PricingProps) {
  const href = isSignedIn ? '/today' : '/sign-up'
  const label = isSignedIn ? 'Go to app' : 'Subscribe — $100/month'
  return (
    <section className="vm-section" id="pricing" style={{ paddingTop: 0 }}>
      <div className="vm-section-head">
        <div className="vm-section-num"><b>§ 04</b>Pricing</div>
        <div><h2 className="vm-section-title">One plan. <em>Per technician.</em></h2><p className="vm-section-lede">One account, one tech, one month. No annual lock-in and no hidden shop tier.</p></div>
      </div>
      <div className="vm-pricing">
        <div className="vm-price-main">
          <div className="vm-price-eyebrow"><span className="vm-dot" />Technician account &middot; monthly</div>
          <h3 className="vm-price-name">Vyntechs <em>ShopOS</em></h3>
          <p className="vm-price-desc">A single technician seat for current ShopOS work: repair orders, assignments, job flow, quotes, status, manual findings, and text notes.</p>
          <div className="vm-price-tag"><div className="vm-price-num"><small>$</small>100</div><div className="vm-price-per"><b>per technician</b>per month &middot; billed monthly</div></div>
          <div className="vm-price-cta"><a href={href} className="vm-btn vm-btn--accent">{label}</a></div>
          <div className="vm-price-foot">USD &middot; billed monthly &middot; cancel anytime</div>
        </div>
        <div className="vm-price-side">
          <h4>What every seat includes</h4>
          {INCLUSIONS.map(([title, sub]) => (
            <div className="vm-incl" key={title}><span className="vm-incl-tick">✓</span><div className="vm-incl-text">{title}<small>{sub}</small></div></div>
          ))}
        </div>
      </div>
      <div className="vm-price-fine">
        <div className="vm-price-fine-cell"><div className="vm-price-fine-h">Billing</div><div className="vm-price-fine-b">Monthly, on the day you started. No annual lock-in.</div></div>
        <div className="vm-price-fine-cell"><div className="vm-price-fine-h">If you cancel</div><div className="vm-price-fine-b">Your shop records remain subject to the account and retention terms.</div></div>
        <div className="vm-price-fine-cell"><div className="vm-price-fine-h">Shop packages</div><div className="vm-price-fine-b">Not yet. Add one technician seat at a time.</div></div>
      </div>
    </section>
  )
}
