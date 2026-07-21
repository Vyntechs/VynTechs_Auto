import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LocalizedTimestamp } from '@/components/vt/localized-timestamp'

describe('LocalizedTimestamp', () => {
  it('server-renders a stable UTC fallback before the browser localizes the text', () => {
    const html = renderToString(
      <LocalizedTimestamp value="2026-07-11T11:29:00.000Z" kind="time" />,
    )

    expect(html).toContain('dateTime="2026-07-11T11:29:00.000Z"')
    expect(html).toContain('11:29 AM')
  })
})
