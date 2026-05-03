import Link from 'next/link'

/* Auth shell — bone canvas, hairline header with the wordmark + a
   "back to home" affordance. Centered max-width column for the form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
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
        <Link
          href="/"
          className="eyebrow"
          style={{
            color: 'var(--vt-fg-2)',
            letterSpacing: '0.18em',
            textDecoration: 'none',
          }}
        >
          Vyntechs
        </Link>
        <Link
          href="/"
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vt-fg-3)',
            textDecoration: 'none',
          }}
        >
          ← Back
        </Link>
      </header>
      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '48px 20px 80px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 360 }}>{children}</div>
      </section>
    </main>
  )
}
