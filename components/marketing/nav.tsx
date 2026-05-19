import Image from 'next/image'

type NavProps = { isSignedIn: boolean }

export function Nav({ isSignedIn }: NavProps) {
  const ctaHref = isSignedIn ? '/today' : '/sign-up'
  const ctaLabel = isSignedIn ? 'Go to app' : 'Subscribe — $100/tech/mo'
  return (
    <nav className="vm-nav">
      <div className="vm-nav-inner">
        <a href="#top" className="vm-brand" aria-label="Vyntechs home">
          <Image
            src="/brand/lockup.png"
            alt="Vyntechs"
            width={44}
            height={44}
            className="vm-brand-sigil"
            priority
          />
          <span className="vm-brand-bar" />
          <span className="vm-brand-tag">Diagnostic Co-pilot</span>
        </a>
        <div className="vm-nav-links">
          <a href="#how">How it works</a>
          <a href="#product">Surfaces</a>
          <a href="#pricing">Pricing</a>
          <a href="#compare">Compare</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="vm-nav-cta">
          {!isSignedIn && (
            <a href="/sign-in" className="vm-btn vm-btn--ghost">
              Sign in
            </a>
          )}
          <a href={ctaHref} className="vm-btn">
            {ctaLabel}
          </a>
        </div>
      </div>
    </nav>
  )
}
