import Image from 'next/image'
import { SignOutButton } from '@/components/vt/sign-out-button'

export const metadata = {
  title: 'Account deactivated — Vyntechs',
}

export default function DeactivatedPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--vt-bg)',
        color: 'var(--vt-fg)',
      }}
    >
      <header
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '0.5px solid var(--vt-rule)',
        }}
      >
        <Image
          src="/icon.png"
          alt="Vyntechs"
          width={28}
          height={28}
          priority
        />
        <SignOutButton />
      </header>
      <section
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 28,
              fontWeight: 500,
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            Your account has been deactivated.
          </h1>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 16,
              lineHeight: 1.5,
              color: 'var(--vt-fg-3)',
              margin: 0,
            }}
          >
            Contact your shop admin if you think this is a mistake.
          </p>
        </div>
      </section>
    </main>
  )
}
