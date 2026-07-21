'use client'

import { useEffect, useState } from 'react'

type TimestampKind = 'date' | 'dateTime' | 'time'

const FORMAT_OPTIONS: Record<TimestampKind, Intl.DateTimeFormatOptions> = {
  date: { month: 'short', day: 'numeric', year: 'numeric' },
  dateTime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  time: { hour: 'numeric', minute: '2-digit' },
}

function formatTimestamp(value: Date | string, kind: TimestampKind, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    ...FORMAT_OPTIONS[kind],
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
}

/**
 * Server rendering has no reliable knowledge of the shop user's time zone.
 * Start from the same UTC text on server and client, then localize only this
 * small text node after hydration. The repair order remains mounted throughout.
 */
export function LocalizedTimestamp({
  value,
  kind,
  className,
}: {
  value: Date | string
  kind: TimestampKind
  className?: string
}): React.JSX.Element {
  const stable = formatTimestamp(value, kind, 'UTC')
  const [text, setText] = useState(stable)

  useEffect(() => {
    setText(formatTimestamp(value, kind))
  }, [kind, value])

  const dateTime = value instanceof Date ? value.toISOString() : value
  return <time className={className} dateTime={dateTime}>{text}</time>
}
