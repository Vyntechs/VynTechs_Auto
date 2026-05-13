type FinalCTAProps = {
  isSignedIn: boolean
}

export function FinalCTA({ isSignedIn }: FinalCTAProps) {
  const href = isSignedIn ? '/today' : '/sign-up'
  const label = isSignedIn ? 'Go to app' : 'Subscribe'
  return (
    <section className="mk__section mk__final">
      <div className="mk-container">
        <div className="mk__final">
          <h2 className="mk__final__h">
            Built for techs who have to be right.
          </h2>
          <a className="mk__pricing__btn" href={href}>
            {label}
            {!isSignedIn && (
              <span className="mk__pricing__btn__price">$100/MO</span>
            )}
          </a>
          <div className="mk__final__terms">Single seat · cancel anytime</div>
          <p className="mk__final__legal">
            Vyntechs · vyntechs.dev · A diagnostic co-pilot built by working
            techs.
          </p>
        </div>
      </div>
    </section>
  )
}
