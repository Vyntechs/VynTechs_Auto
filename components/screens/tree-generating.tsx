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
    ? `Building tree from ${matches} corpus matches.`
    : 'Building diagnostic tree.'

  return (
    <div
      className="app"
      style={{ justifyContent: 'center', alignItems: 'stretch' }}
    >
      <div
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <span
          className="eyebrow"
          style={{ color: 'var(--vt-amber-500)', marginBottom: 16 }}
          aria-live="polite"
        >
          ● Generating
        </span>
        <p
          style={{
            fontFamily: 'var(--vt-font-serif)',
            fontSize: 26,
            lineHeight: 1.2,
            color: 'var(--vt-fg)',
            margin: '0 0 14px',
            fontStyle: 'italic',
          }}
        >
          {headline}
        </p>
        {(vehicle || elapsed) && (
          <div
            style={{
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 11,
              color: 'var(--vt-fg-3)',
              marginBottom: 24,
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
        <HairlineProgress />
      </div>
    </div>
  )
}
