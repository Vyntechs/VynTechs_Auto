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
          ShopOS &middot; still in beta &middot; onboarding by invite
        </div>
        <h1 className="vm-hero-title">
          The repair order that keeps the whole shop moving.
        </h1>
        <p className="vm-hero-sub">
          One living repair order connects the counter, the bay, and the
          customer decision. Capture the concern once, assign the work, record
          manual findings or text work notes, build the quote, and move the job
          forward without rebuilding the story on every screen.
        </p>
        <div className="vm-hero-cta">
          <a href={ctaHref} className="vm-btn">{ctaLabel}</a>
          <a href="#how" className="vm-btn vm-btn--ghost">See the flow</a>
          <span className="vm-price">One tech &middot; one account &middot; cancel anytime</span>
        </div>
        <div className="vm-hero-meta">
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">1</div>
            <div className="vm-hero-meta-lab">repair order from intake to closeout</div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">3</div>
            <div className="vm-hero-meta-lab">roles sharing the same job truth</div>
          </div>
          <div className="vm-hero-meta-cell">
            <div className="vm-hero-meta-num">0</div>
            <div className="vm-hero-meta-lab">duplicate stories to retype</div>
          </div>
        </div>
      </div>
      <HeroTerminal />
    </section>
  )
}
