import { HeroTerminal } from './hero-terminal'

type HeroProps = { isSignedIn: boolean }

export function Hero({ isSignedIn }: HeroProps) {
  const ctaHref = isSignedIn ? '/today' : '/sign-up'
  const ctaLabel = isSignedIn ? 'Go to app' : 'Subscribe — $100/month'
  return (
    <section className="vm-hero" id="top">
      <div className="vm-hero-lead">
        <div className="vm-hero-eyebrow vm-eyebrow">
          <span className="vm-dot" />
          Still in beta &middot; onboarding by invite
        </div>
        <h1 className="vm-hero-title">
          Knows how the system works. Won&rsquo;t guess when it
          doesn&rsquo;t.
        </h1>
        <p className="vm-hero-sub">
          Built by a working tech who got tired of guessing. It works from how
          your vehicle&rsquo;s system actually works, not a copied manual, so it
          reasons about your truck and not some other one. When it isn&rsquo;t
          sure, it says so, tells you what to check, and won&rsquo;t green-light
          tearing into something it can&rsquo;t stand behind.
        </p>
        <div className="vm-hero-cta">
          <a href={ctaHref} className="vm-btn">
            {ctaLabel}
          </a>
          <a href="#how" className="vm-btn vm-btn--ghost">
            See how it works
          </a>
          <span className="vm-price">
            One tech &middot; one account &middot; cancel anytime
          </span>
        </div>
        <div className="vm-hero-meta">
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">
              95<small>%</small>
            </div>
            <div className="vm-hero-meta-lab">
              confidence line before it&rsquo;ll OK risky work
            </div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">3</div>
            <div className="vm-hero-meta-lab">
              questions max before it defers, not guesses
            </div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">0</div>
            <div className="vm-hero-meta-lab">specs it&rsquo;ll make up</div>
          </div>
        </div>
      </div>
      <HeroTerminal />
    </section>
  )
}
