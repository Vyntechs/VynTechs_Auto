import type { SessionEvent } from '@/lib/db/schema'

type Props = {
  events: SessionEvent[]
}

/**
 * Chat-thread renderer for repair-phase events. Filters session_events
 * to repair_observation + repair_guidance and renders them as alternating
 * bubbles (tech left-aligned, AI right-aligned) in chronological order.
 *
 * Returns null when there are no repair events (the parent renders the
 * empty state).
 */
export function RepairConversation({ events }: Props) {
  const repairEvents = events.filter(
    e => e.eventType === 'repair_observation' || e.eventType === 'repair_guidance',
  )

  if (repairEvents.length === 0) {
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {repairEvents.map(event => {
        const isTech = event.eventType === 'repair_observation'
        const text = isTech
          ? event.observationText ?? ''
          : (event.aiResponse as { repairGuidance?: { text: string } } | null)?.repairGuidance
              ?.text ?? ''
        const tangentials = isTech
          ? null
          : (event.aiResponse as { repairGuidance?: { tangentialConcerns?: string[] } } | null)
              ?.repairGuidance?.tangentialConcerns

        return (
          <div
            key={event.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isTech ? 'flex-start' : 'flex-end',
            }}
          >
            <span
              className="eyebrow"
              style={{
                fontSize: 10,
                color: 'var(--vt-fg-3)',
                marginBottom: 4,
              }}
            >
              {isTech ? 'You' : 'AI'} ·{' '}
              {new Date(event.createdAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <div
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 14,
                lineHeight: 1.55,
                padding: '10px 14px',
                borderRadius: 12,
                maxWidth: '85%',
                background: isTech ? 'var(--vt-bone-50)' : 'var(--vt-paper)',
                border: '0.5px solid var(--vt-rule)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {text}
            </div>
            {tangentials && tangentials.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--vt-paper)',
                  border: '0.5px dashed var(--vt-rule)',
                  maxWidth: '85%',
                  fontSize: 13,
                  color: 'var(--vt-fg-2)',
                }}
              >
                <span
                  className="eyebrow"
                  style={{ fontSize: 9, marginBottom: 4, display: 'block' }}
                >
                  Also worth checking
                </span>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {tangentials.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
