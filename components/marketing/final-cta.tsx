type FinalCTAProps = { isSignedIn: boolean }

export function FinalCTA({ isSignedIn }: FinalCTAProps) {
  const href = isSignedIn ? '/today' : '/sign-up'
  const label = isSignedIn ? 'Go to app' : 'Subscribe — $100/month'
  return (
    <section className="vm-section" style={{ paddingTop: 0 }}>
      <div className="vm-cta">
        <div><h2 className="vm-cta-h">Keep the work moving.</h2><p className="vm-cta-p">$100 per technician, per month. Start with one living repair order and let every handoff update the same truth.</p></div>
        <div className="vm-cta-actions"><a href={href} className="vm-btn vm-btn--accent">{label} →</a><div className="vm-cta-fine">One tech &middot; one account &middot; cancel anytime</div></div>
      </div>
    </section>
  )
}
