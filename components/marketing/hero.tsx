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
          Built in one bay &middot; still in beta
        </div>
        <h1 className="vm-hero-title">
          The diagnostic that knows when <em>not</em> to commit.
        </h1>
        <p className="vm-hero-sub">
          A working technician built this for his own bay because nothing else
          would say <em>&ldquo;I don&rsquo;t know yet.&rdquo;</em> It surfaces
          the next step, cites every claim, and refuses destructive work below a
          confidence gate. Sharing it now because it works.
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
            <div className="vm-hero-meta-num">3</div>
            <div className="vm-hero-meta-lab">retrieval rungs, all cited</div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">
              95<small>%</small>
            </div>
            <div className="vm-hero-meta-lab">default commit gate</div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">0</div>
            <div className="vm-hero-meta-lab">guesses below the gate</div>
          </div>
        </div>
      </div>
      <HeroTerminal />
    </section>
  )
}
