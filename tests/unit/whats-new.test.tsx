import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WhatsNew } from '@/components/screens/whats-new'
import type { WhatsNewEntry } from '@/lib/db/schema'

function mkEntry(over: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: over.id ?? `entry-${Math.random()}`,
    title: 'Example title',
    body: 'Example body paragraph.',
    publishedAt: new Date('2026-05-01T12:00:00Z'),
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...over,
  } as WhatsNewEntry
}

describe('WhatsNew', () => {
  it('renders each entry with its title, body, and published date', () => {
    const entries = [
      mkEntry({
        id: 'a',
        title: 'Vehicle history view',
        body: 'You can now click into any vehicle from intake and see every past diagnosis on it.',
        publishedAt: new Date('2026-05-10T12:00:00Z'),
      }),
    ]

    render(<WhatsNew entries={entries} lastSeenAt={null} />)

    expect(screen.getByText('Vehicle history view')).toBeTruthy()
    expect(
      screen.getByText(/click into any vehicle from intake/i),
    ).toBeTruthy()
    // Published date should be visible (any reasonable date format)
    expect(screen.getByText(/May/)).toBeTruthy()
  })

  it('renders entries in the order received (component does not re-sort)', () => {
    const entries = [
      mkEntry({ id: 'newest', title: 'Newest', publishedAt: new Date('2026-05-10T12:00:00Z') }),
      mkEntry({ id: 'middle', title: 'Middle', publishedAt: new Date('2026-05-05T12:00:00Z') }),
      mkEntry({ id: 'oldest', title: 'Oldest', publishedAt: new Date('2026-05-01T12:00:00Z') }),
    ]

    render(<WhatsNew entries={entries} lastSeenAt={null} />)

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest'])
  })

  it('marks all entries as new when lastSeenAt is null', () => {
    const entries = [
      mkEntry({ id: 'a', title: 'Entry A' }),
      mkEntry({ id: 'b', title: 'Entry B' }),
    ]

    render(<WhatsNew entries={entries} lastSeenAt={null} />)

    const pills = screen.getAllByText(/^new$/i)
    expect(pills.length).toBe(2)
  })

  it('marks only entries published after lastSeenAt as new', () => {
    const middle = new Date('2026-05-05T12:00:00Z')
    const entries = [
      mkEntry({ id: 'newest', title: 'Newest', publishedAt: new Date('2026-05-10T12:00:00Z') }),
      mkEntry({ id: 'at-cutoff', title: 'AtCutoff', publishedAt: middle }),
      mkEntry({ id: 'oldest', title: 'Oldest', publishedAt: new Date('2026-05-01T12:00:00Z') }),
    ]

    render(<WhatsNew entries={entries} lastSeenAt={middle} />)

    // Strictly newer than `middle` → only "Newest" is new.
    const newestCard = screen.getByText('Newest').closest('article')!
    const atCutoffCard = screen.getByText('AtCutoff').closest('article')!
    const oldestCard = screen.getByText('Oldest').closest('article')!

    expect(within(newestCard).queryByText(/^new$/i)).toBeTruthy()
    expect(within(atCutoffCard).queryByText(/^new$/i)).toBeNull()
    expect(within(oldestCard).queryByText(/^new$/i)).toBeNull()
  })

  it('renders an empty-state message when there are no entries', () => {
    render(<WhatsNew entries={[]} lastSeenAt={null} />)
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy()
  })
})
