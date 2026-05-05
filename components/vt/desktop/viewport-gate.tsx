'use client'

import { useEffect, useState, type ReactNode } from 'react'

const DESKTOP_MIN_WIDTH = 1280

export function ViewportGate({ children }: { children: ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    const evaluate = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH)
    evaluate()
    window.addEventListener('resize', evaluate)
    return () => window.removeEventListener('resize', evaluate)
  }, [])

  if (isDesktop) return <>{children}</>

  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--vt-bone-50)',
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--vt-fg-3)',
            marginBottom: 12,
          }}
        >
          Counter · desktop view
        </span>
        <h1
          style={{
            fontFamily: 'var(--vt-font-serif)',
            fontSize: 28,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
            margin: 0,
            color: 'var(--vt-fg-1)',
            fontWeight: 400,
          }}
        >
          Use a desktop or laptop — this screen needs a wider window.
        </h1>
        <p
          style={{
            marginTop: 14,
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 14,
            color: 'var(--vt-fg-2)',
          }}
        >
          The Counter intake plan & quote view is built for the front-counter screen. The bay-tech
          phone view is a different product surface.
        </p>
      </div>
    </div>
  )
}
