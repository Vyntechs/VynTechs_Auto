type StickyCTAProps = {
  isSignedIn: boolean
}

export function StickyCTA({ isSignedIn }: StickyCTAProps) {
  return (
    <div className="mk__sticky">
      <a className="mk__sticky__brand" href="/">
        Vyntechs <small>Diagnostic Co-Pilot</small>
      </a>
      {isSignedIn ? (
        <a className="mk__sticky__cta mk__sticky__cta--app" href="/today">
          Go to app
        </a>
      ) : (
        <>
          <a className="mk__sticky__login" href="/sign-in">
            Sign in
          </a>
          <a className="mk__sticky__cta" href="/sign-up">
            Subscribe
            <span className="mk__sticky__cta__price">$100/MO</span>
          </a>
        </>
      )}
    </div>
  )
}
