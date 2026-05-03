import Link from 'next/link'

/* Public landing — Workshop Instrument aesthetic, no marketing
   over-claim. The serif gravity line is the entire pitch. */
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--vt-bg)',
      }}
    >
      <header
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          borderBottom: '0.5px solid var(--vt-rule)',
        }}
      >
        <span
          className="eyebrow"
          style={{ color: 'var(--vt-fg-2)', letterSpacing: '0.18em' }}
        >
          Vyntechs
        </span>
        <span
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vt-fg-3)',
          }}
        >
          DFW · est. 2026
        </span>
      </header>

      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--vt-font-serif)',
            fontWeight: 400,
            fontSize: 'clamp(40px, 8vw, 72px)',
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            margin: 0,
            maxWidth: '14ch',
            color: 'var(--vt-fg)',
          }}
        >
          AI master tech for the bay.
        </h1>
        <p
          style={{
            fontFamily: 'var(--vt-font-serif)',
            fontStyle: 'italic',
            fontSize: 'clamp(16px, 2.4vw, 22px)',
            lineHeight: 1.5,
            margin: '20px 0 0',
            maxWidth: '36ch',
            color: 'var(--vt-fg-2)',
            textWrap: 'pretty',
          }}
        >
          Decision trees with calibrated confidence. Built for techs who have to be right.
        </p>
        <div
          style={{
            marginTop: 36,
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <Link href="/sign-in" className="btn btn-primary">
            Sign in
          </Link>
          <Link href="/sign-up" className="btn btn-secondary">
            Create account
          </Link>
        </div>
      </section>

      <footer
        style={{
          padding: '20px 24px',
          borderTop: '0.5px solid var(--vt-rule)',
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vt-fg-3)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span>Workshop instrument · single accent · no decoration</span>
        <span>Vyntechs · independent shops · DFW</span>
      </footer>
    </main>
  )
}
