import { AppHeader, Module, Pill } from '@/components/vt'
import type { WhatsNewEntry } from '@/lib/db/schema'

export function WhatsNew({
  entries,
  lastSeenAt,
}: {
  entries: WhatsNewEntry[]
  lastSeenAt: Date | null
}) {
  return (
    <div className="app">
      <AppHeader title="What's new" back={{ href: '/today', label: 'Today' }} />
      <div
        style={{
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flex: 1,
          overflow: 'auto',
        }}
      >
        {entries.length === 0 ? (
          <Module num="01" label="Updates">
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 15,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
              }}
            >
              Nothing here yet. Each deploy will land a plain-English changelog entry here.
            </p>
          </Module>
        ) : (
          entries.map((entry, i) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              num={String(i + 1).padStart(2, '0')}
              isNew={isUnseen(entry, lastSeenAt)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function isUnseen(entry: WhatsNewEntry, lastSeenAt: Date | null): boolean {
  if (lastSeenAt == null) return true
  return entry.publishedAt.getTime() > lastSeenAt.getTime()
}

function EntryCard({
  entry,
  num,
  isNew,
}: {
  entry: WhatsNewEntry
  num: string
  isNew: boolean
}) {
  return (
    <Module num={num} label={formatDate(entry.publishedAt)}>
      <article>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--vt-font-serif)',
              fontWeight: 500,
              fontSize: 18,
              color: 'var(--vt-fg)',
              lineHeight: 1.3,
            }}
          >
            {entry.title}
          </h3>
          {isNew && <Pill kind="new">New</Pill>}
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--vt-font-serif)',
            fontSize: 15,
            color: 'var(--vt-fg-2)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}
        >
          {entry.body}
        </p>
      </article>
    </Module>
  )
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
