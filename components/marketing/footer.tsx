import Image from 'next/image'

type FooterProps = { isSignedIn: boolean }

export function Footer({ isSignedIn }: FooterProps) {
  return (
    <footer className="vm-foot">
      <div className="vm-foot-inner">
        <div>
          <a href="/" className="vm-brand" aria-label="Vyntechs home">
            <Image
              src="/brand/lockup.png"
              alt="Vyntechs"
              width={56}
              height={56}
              className="vm-brand-sigil"
            />
          </a>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 15,
              lineHeight: 1.5,
              color: 'var(--vt-bone-700)',
              maxWidth: 360,
              margin: '16px 0 0',
            }}
          >
            A diagnostic co-pilot for working technicians. Built in one bay, by
            a working tech, and shared because it works.
          </p>
        </div>
        <div>
          <h5>Product</h5>
          <ul>
            <li>
              <a href="/#how">How it works</a>
            </li>
            <li>
              <a href="/#product">Surfaces</a>
            </li>
            <li>
              <a href="/#pricing">Pricing</a>
            </li>
            <li>
              <a href="/#compare">Compare</a>
            </li>
            <li>
              <a href="/#faq">FAQ</a>
            </li>
          </ul>
        </div>
        <div>
          <h5>Account</h5>
          <ul>
            {isSignedIn ? (
              <li>
                <a href="/today">Go to app</a>
              </li>
            ) : (
              <>
                <li>
                  <a href="/sign-in">Sign in</a>
                </li>
                <li>
                  <a href="/sign-up">Subscribe</a>
                </li>
              </>
            )}
            <li>
              <a href="/whats-new">What&rsquo;s new</a>
            </li>
          </ul>
        </div>
        <div>
          <h5>About</h5>
          <ul>
            <li>
              <a href="/#why">Why it exists</a>
            </li>
            <li>One working tech</li>
            <li>One bay</li>
          </ul>
        </div>
        <div>
          <h5>Legal</h5>
          <ul>
            <li>
              <a href="/privacy">Privacy</a>
            </li>
          </ul>
        </div>
      </div>
      <div className="vm-foot-bot">
        <span>© 2026 Vyntechs &middot; vyntechs.dev</span>
        <a href="/privacy" className="vm-foot-legal">Privacy</a>
        <span className="vm-foot-mark">Built in the bay, not the boardroom.</span>
        <span>Beta &middot; invite-only</span>
      </div>
    </footer>
  )
}
