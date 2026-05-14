import Image from 'next/image'

type StickyCTAProps = {
  isSignedIn: boolean
}

export function StickyCTA({ isSignedIn }: StickyCTAProps) {
  return (
    <>
      <a className="mk__brand-mark" href="/" aria-label="Vyntechs home">
        <Image
          src="/brand/lockup.png"
          alt="Vyntechs"
          width={80}
          height={67}
          priority
        />
      </a>
      <div className="mk__sticky">
        <a className="mk__sticky__brand" href="/">
          Vyntechs <small>AI master tech</small>
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
    </>
  )
}
