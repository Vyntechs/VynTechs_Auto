type FinalCTAProps = { isSignedIn: boolean }

export function FinalCTA({ isSignedIn }: FinalCTAProps) {
  const href = isSignedIn ? '/today' : '/sign-up'
  const label = isSignedIn ? 'Go to app' : 'Subscribe — $100/month'
  return (
    <section className="vm-section" style={{ paddingTop: 0 }}>
      <div className="vm-cta">
        <div>
          <h2 className="vm-cta-h">
            Stop guessing.
          </h2>
          <p className="vm-cta-p">
            $100 per technician, per month. One account, one path in, no
            salesperson on the other side. Bring one stubborn vehicle. If it
            doesn&rsquo;t change how you work, cancel — your sessions
            stay yours, always.
          </p>
        </div>
        <div className="vm-cta-actions">
          <a href={href} className="vm-btn vm-btn--accent">
            {label}
            <svg
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M3 6 L9 6 M6 3 L9 6 L6 9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <div className="vm-cta-fine">
            One tech &middot; one account &middot; cancel anytime
          </div>
        </div>
      </div>
    </section>
  )
}
