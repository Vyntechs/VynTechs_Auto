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
          Built in the bay &middot; production live &middot; invite-only beta
        </div>
        <h1 className="vm-hero-title">
          The diagnostic that knows when <em>not</em> to commit.
        </h1>
        <p className="vm-hero-sub">
          A working tech built this in his own bay because no other AI would
          say <em>&ldquo;I don&rsquo;t know yet.&rdquo;</em> Three-rung
          retrieval — per-shop corpus, OEM/TSB/NHTSA web sweep, then a capped
          tech-assist — every claim cited, every cut, splice, or reflash
          gated behind a calibrated confidence floor. Hardened on real
          comebacks before it shipped.
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
            <div className="vm-hero-meta-lab">retrieval rungs &middot; every claim cited inline</div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">
              95<small>%</small>
            </div>
            <div className="vm-hero-meta-lab">default gate &middot; per-cell calibrated</div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">0</div>
            <div className="vm-hero-meta-lab">irreversible work below the gate</div>
          </div>
        </div>
      </div>
      <HeroTerminal />
    </section>
  )
}
