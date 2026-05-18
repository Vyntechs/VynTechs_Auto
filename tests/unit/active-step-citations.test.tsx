import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

const { replaceSpy } = vi.hoisted(() => ({ replaceSpy: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceSpy }),
  usePathname: () => '/sessions/sess-1',
  useSearchParams: () => new URLSearchParams(''),
}))

beforeEach(() => {
  replaceSpy.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

import { ActiveStepCitations } from '@/components/screens/active-step-citations'

function makeItem(overrides: Partial<KnowledgeListRow>): KnowledgeListRow {
  return {
    id: 'k_1',
    shopId: 's_1',
    type: 'note',
    title: 'A shop note',
    body: 'A short body of the note.',
    structuredData: null,
    dtcList: [],
    dtcSubCodes: null,
    systemCodes: [],
    symptoms: [],
    relatedItemIds: null,
    createdByUserId: 'u_1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    retired: false,
    retiredAt: null,
    retiredByUserId: null,
    fireCount: 0,
    vehicleScopes: [],
    ...overrides,
  }
}

describe('<ActiveStepCitations />', () => {
  it('renders nothing for an empty items array', () => {
    const { container } = render(<ActiveStepCitations items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders all items when count is at or below defaultVisible + 1', () => {
    const items = [
      makeItem({ id: 'k_1', title: 'Item 1' }),
      makeItem({ id: 'k_2', title: 'Item 2' }),
      makeItem({ id: 'k_3', title: 'Item 3' }),
      makeItem({ id: 'k_4', title: 'Item 4' }),
    ]
    render(<ActiveStepCitations items={items} defaultVisible={3} />)
    // 4 = defaultVisible+1, no "see more" — collapsing 1 is silly.
    expect(screen.getByText('Item 1')).toBeTruthy()
    expect(screen.getByText('Item 4')).toBeTruthy()
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })

  it('renders top N + "see more" link when count > defaultVisible + 1', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `k_${i}`, title: `Item ${i}` }),
    )
    render(<ActiveStepCitations items={items} defaultVisible={3} />)
    expect(screen.getByText('Item 0')).toBeTruthy()
    expect(screen.getByText('Item 1')).toBeTruthy()
    expect(screen.getByText('Item 2')).toBeTruthy()
    expect(screen.queryByText('Item 3')).toBeNull()
    expect(screen.queryByText('Item 4')).toBeNull()
    expect(screen.getByText('Show 2 more')).toBeTruthy()
  })

  it('expands the stack when "see more" is tapped', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `k_${i}`, title: `Item ${i}` }),
    )
    render(<ActiveStepCitations items={items} defaultVisible={3} />)
    fireEvent.click(screen.getByText('Show 2 more'))
    expect(screen.getByText('Item 3')).toBeTruthy()
    expect(screen.getByText('Item 4')).toBeTruthy()
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })

  it('opens the drawer via URL ?detail= when a row is clicked', () => {
    const items = [makeItem({ id: 'k_pinout_x', title: 'PCM C175 pinout', type: 'pinout' })]
    render(<ActiveStepCitations items={items} />)
    fireEvent.click(screen.getByLabelText('Open citation: PCM C175 pinout'))
    expect(replaceSpy).toHaveBeenCalledOnce()
    expect(replaceSpy).toHaveBeenCalledWith('/sessions/sess-1?detail=k_pinout_x', {
      scroll: false,
    })
  })

  it('shows the retired tag on a retired-but-cited item', () => {
    const items = [
      makeItem({ id: 'k_r', title: 'Retired bulletin', retired: true }),
    ]
    render(<ActiveStepCitations items={items} />)
    expect(screen.getByText('Retired')).toBeTruthy()
  })

  it('renders the type label in the meta row', () => {
    const items = [makeItem({ id: 'k_1', title: 'P0299', type: 'cause_fix' })]
    render(<ActiveStepCitations items={items} />)
    expect(screen.getByText('Cause + fix')).toBeTruthy()
  })

  it('renders the data peek for pinout items inline', () => {
    const items = [
      makeItem({
        id: 'k_pinout',
        type: 'pinout',
        title: 'PCM C175 pinout',
        structuredData: {
          connector_ref: 'PCM C175',
          pins: [
            {
              pin_number: '31',
              signal_name: 'Boost pressure',
              wire_color: 'GN/WT',
            },
          ],
        },
      }),
    ]
    const { container } = render(<ActiveStepCitations items={items} />)
    // Data peek is rendered in the same span as the row body.
    expect(container.textContent).toContain('31')
    expect(container.textContent).toContain('Boost pressure')
    expect(container.textContent).toContain('GN/WT')
  })

  it('renders the items in the order received (citation order)', () => {
    const items = [
      makeItem({ id: 'a', title: 'First cited' }),
      makeItem({ id: 'b', title: 'Second cited' }),
      makeItem({ id: 'c', title: 'Third cited' }),
    ]
    render(<ActiveStepCitations items={items} />)
    const titles = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(titles[0]).toContain('First cited')
    expect(titles[1]).toContain('Second cited')
    expect(titles[2]).toContain('Third cited')
  })

  it('shows the "N referenced" count in the eyebrow', () => {
    const items = [
      makeItem({ id: 'a', title: 'a' }),
      makeItem({ id: 'b', title: 'b' }),
    ]
    render(<ActiveStepCitations items={items} />)
    expect(screen.getByText('2 referenced')).toBeTruthy()
  })
})
