import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { CounterIntake } from '@/components/screens/counter-intake'

describe('CounterIntake', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessionId: 'session-abc' }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders the screen title', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.getByRole('heading', { name: /who's at the counter/i })).toBeInTheDocument()
  })

  it('renders the customer, vehicle, and complaint fields', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/vin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/year/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/make/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what brought them in/i)).toBeInTheDocument()
  })

  it('auto-uppercases VIN as the writer types', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    const vin = screen.getByLabelText(/vin/i) as HTMLInputElement
    fireEvent.change(vin, { target: { value: 'wba3a5c50ejf12345' } })
    expect(vin.value).toBe('WBA3A5C50EJF12345')
  })

  // 2026-05-29 trust sweep: the "Scan with camera" button never scanned — it
  // flipped a boolean that was then sent as vinScanned, letting the form claim
  // a camera VIN scan that never happened. The "Auto-saved" footer likewise
  // claimed persistence the form does not have. Both fakes removed.
  // docs/strategy/2026-05-29-customer-interaction-doctrine.md (§2.5)
  it('does not render a fake "Scan with camera" button (no real camera scan exists)', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(
      screen.queryByRole('button', { name: /scan with camera/i }),
    ).not.toBeInTheDocument()
  })

  it('does not claim the form is auto-saved (no draft persistence exists)', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.queryByText(/auto-saved/i)).not.toBeInTheDocument()
  })

  it('disables submit when required fields are empty', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    // The screen has two submit buttons (header + form footer); both must be disabled.
    const submits = screen.getAllByRole('button', { name: /create repair order/i })
    expect(submits.length).toBeGreaterThan(0)
    submits.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('enables submit once name, phone, year, make, model, and complaint are filled (VIN optional)', () => {
    // Real PR-27 preview bug: previously required VIN at the UI gate even
    // though /api/intake/submit doesn't. Counter staff with no VIN in hand
    // were locked out with no hint why.
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Brittney Nichols' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '1235542121' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2007' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Chevrolet' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'Tahoe' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Crank-no-start' },
    })
    // NOTE: VIN intentionally left blank.
    const submits = screen.getAllByRole('button', { name: /create repair order/i })
    submits.forEach((btn) => expect(btn).toBeEnabled())
  })

  it('shows the logged-in user email in the top bar (not the old "Diana" placeholder)', () => {
    render(<CounterIntake userEmail="brandon@vyntechs.com" />)
    expect(screen.getByText('brandon@vyntechs.com')).toBeInTheDocument()
    expect(screen.queryByText('Diana')).not.toBeInTheDocument()
  })

  it('soft-fails to "—" in the top bar when no userEmail is supplied (no crash, no build break)', () => {
    render(<CounterIntake />)
    // Two dashes render: one in the avatar circle, one in the name span.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('Diana')).not.toBeInTheDocument()
  })

  it('POSTs the form values to /api/intake/submit and navigates on success', async () => {
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Robert Sandoval' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '(303) 555-0142' } })
    fireEvent.change(screen.getByLabelText(/vin/i), { target: { value: 'WBA3A5C50EJF12345' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2014' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'BMW' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: '335i' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Crank-no-start' },
    })

    // Click either Send-to-Techs button (both submit the same form).
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/intake/submit',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
          body: expect.stringContaining('Robert Sandoval'),
        }),
      )
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/sessions/session-abc')
    })
  })

  describe('tech selector wiring', () => {
    function team(
      ...members: Array<{
        id: string
        name: string
        skillTier: 1 | 2 | 3
        isCurrentUser?: boolean
      }>
    ) {
      return members.map((m) => ({
        id: m.id,
        name: m.name,
        skillTier: m.skillTier,
        isCurrentUser: m.isCurrentUser ?? false,
        workload: { open: 0, today: 0 },
      }))
    }

    function fillRequired() {
      fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
      fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
      fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2020' } })
      fireEvent.change(screen.getByLabelText(/make/i), { target: { value: 'X' } })
      fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'Y' } })
      fireEvent.change(screen.getByLabelText(/what brought them in/i), {
        target: { value: 'noise' },
      })
    }

    it('defaults a one-member roster to Open and lets the writer assign then clear the sole profile', () => {
      render(
        <CounterIntake
          userEmail="brandon@example.com"
          team={team({ id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true })}
          workloadFailed={false}
        />,
      )
      const trigger = screen.getByRole('combobox', { name: /assigned to/i })
      expect(trigger).toHaveTextContent(/open queue/i)

      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('option', { name: /brandon/i }))
      expect(trigger).toHaveTextContent(/brandon/i)

      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('option', { name: /clear.*open queue/i }))
      expect(trigger).toHaveTextContent(/open queue/i)
    })

    it('renders compact A/B/C skill labels for the wrenching roster', () => {
      render(
        <CounterIntake
          userEmail="brandon@example.com"
          team={team(
            { id: 'a', name: 'Alice', skillTier: 3, isCurrentUser: true },
            { id: 'b', name: 'Bob', skillTier: 2 },
            { id: 'c', name: 'Charlie', skillTier: 1 },
          )}
          workloadFailed={false}
        />,
      )

      fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
      expect(screen.getByRole('option', { name: /alice/i })).toHaveTextContent('A')
      expect(screen.getByRole('option', { name: /bob/i })).toHaveTextContent('B')
      expect(screen.getByRole('option', { name: /charlie/i })).toHaveTextContent('C')
    })

    it('sends assignedTechId: null in the submit body when nothing is picked', async () => {
      render(
        <CounterIntake
          userEmail="brandon@example.com"
          team={team(
            { id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true },
            { id: 'b', name: 'Diana', skillTier: 2 },
          )}
          workloadFailed={false}
        />,
      )
      fillRequired()
      fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalled()
      })
      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
      const body = JSON.parse(init!.body as string) as { assignedTechId?: string | null }
      expect(body.assignedTechId).toBeNull()
    })

    it('sends the picked assignedTechId in the submit body', async () => {
      render(
        <CounterIntake
          userEmail="brandon@example.com"
          team={team(
            { id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true },
            { id: 'b', name: 'Diana', skillTier: 2 },
          )}
          workloadFailed={false}
        />,
      )
      fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
      fireEvent.click(screen.getByRole('option', { name: /diana/i }))
      fillRequired()
      fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalled()
      })
      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
      const body = JSON.parse(init!.body as string) as { assignedTechId?: string | null }
      expect(body.assignedTechId).toBe('b')
    })

    it('omits the pill entirely when team is empty (existing-tests safety)', () => {
      render(<CounterIntake userEmail="brandon@example.com" />)
      expect(screen.queryByRole('group', { name: /assigned to/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /assigned to/i })).not.toBeInTheDocument()
    })
  })
})
