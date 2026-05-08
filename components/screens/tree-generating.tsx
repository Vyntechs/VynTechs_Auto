import Link from 'next/link'
import { HairlineProgress } from '@/components/vt'

type Props = {
  vehicle?: string
  matches?: number
  modelVersion?: string
  elapsed?: string
}

export function TreeGenerating({
  vehicle,
  matches,
  modelVersion = 'claude-sonnet-4-6',
  elapsed,
}: Props) {
  const headline = matches
    ? `Putting together your steps from ${matches} past case${matches === 1 ? '' : 's'}.`
    : 'Putting together your steps.'

  return (
    <div
      className="app"
      style={{ justifyContent: 'center', alignItems: 'stretch' }}
    >
      <div
        style={{
          padding: '14px 16px 0',
        }}
      >
        <Link
          href="/today"
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 11,
            color: 'var(--vt-fg-2)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          ← My Jobs
        </Link>
      </div>
      <div
        style={{
          padding: '40px 24px',
          textAlign: 'center',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <span
          className="eyebrow"
          style={{ color: 'var(--vt-signal-500)', marginBottom: 18 }}
          aria-live="polite"
        >
          ● Generating
        </span>
        <p
          style={{
            fontFamily: 'var(--vt-font-serif)',
            fontSize: 30,
            lineHeight: 1.15,
            color: 'var(--vt-fg)',
            margin: '0 0 16px',
            fontStyle: 'italic',
            letterSpacing: '-0.02em',
          }}
        >
          {headline}
        </p>
        {(vehicle || elapsed) && (
          <div
            style={{
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              color: 'var(--vt-fg-3)',
              marginBottom: 28,
              letterSpacing: '0.06em',
              lineHeight: 1.7,
            }}
          >
            {vehicle && (
              <>
                {vehicle}
                <br />
              </>
            )}
            {modelVersion}
            {elapsed && ` · ${elapsed}`}
          </div>
        )}
        <div style={{ margin: '0 auto', width: '70%' }}>
          <HairlineProgress />
        </div>
      </div>
    </div>
  )
}
