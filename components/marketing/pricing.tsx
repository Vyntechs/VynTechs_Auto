type PricingProps = {
  isSignedIn: boolean
}

export function Pricing({ isSignedIn }: PricingProps) {
  const href = isSignedIn ? '/today' : '/sign-up'
  const label = isSignedIn ? 'Go to app' : 'Subscribe'
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__pricing">
          <div className="mk__pricing__card">
            <div className="mk__pricing__eyebrow">Subscription</div>
            <div className="mk__pricing__price">$100</div>
            <div className="mk__pricing__period">per month, one tech</div>
            <p className="mk__pricing__terms">Cancel anytime. No contract.</p>
            <p className="mk__pricing__comp">
              Less than AllData ($209). Less than Identifix ($180).
            </p>
            <a className="mk__pricing__btn" href={href}>
              {label}
              {!isSignedIn && (
                <span className="mk__pricing__btn__price">$100/MO</span>
              )}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
