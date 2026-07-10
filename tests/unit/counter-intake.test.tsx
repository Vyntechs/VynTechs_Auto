import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
        json: async () => ({ ticket: { id: 'ticket-abc' } }),
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

  it('protects the counter form at 375px with a single-column responsive contract and 44px controls', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/counter-intake.module.css'),
      'utf8',
    )

    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)/)
    expect(css).toMatch(/:global\(\.vt-form__group\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(css).toMatch(/:global\(\.vt-form__row\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(css).toMatch(/:global\(\.vt-btn\)[\s\S]*min-block-size:\s*44px/)
    expect(css).toMatch(/:global\(\.vt-field__input\)[\s\S]*min-block-size:\s*44px/)
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

  it('decodes an explicit 17-character VIN and leaves every decoded field editable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' }),
    } as Response)
    render(<CounterIntake userEmail="test@example.com" />)

    const decode = screen.getByRole('button', { name: /decode vin/i })
    expect(decode).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^vin$/i), {
      target: { value: 'wba3a5c50ejf12345' },
    })
    expect(decode).toBeEnabled()
    fireEvent.click(decode)

    expect(decode).toBeDisabled()
    expect(decode).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/vin decoded/i))
    expect(decode).toHaveAttribute('aria-busy', 'false')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/intake/decode-vin',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ vin: 'WBA3A5C50EJF12345' }),
      }),
    )
    expect(screen.getByLabelText(/^year$/i)).toHaveValue(2014)
    expect(screen.getByLabelText(/^make$/i)).toHaveValue('BMW')
    expect(screen.getByLabelText(/^model$/i)).toHaveValue('335i')
    expect(screen.getByLabelText(/^engine$/i)).toHaveValue('N55')

    fireEvent.change(screen.getByLabelText(/^engine$/i), { target: { value: 'N55B30' } })
    expect(screen.getByLabelText(/^engine$/i)).toHaveValue('N55B30')
  })

  it.each([
    ['invalid', /vin was not recognized/i],
    ['unavailable', /vin lookup is unavailable/i],
  ] as const)('keeps manual vehicle fields usable when decode returns %s', async (error, copy) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error }),
    } as Response)
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^vin$/i), {
      target: { value: 'WBA3A5C50EJF12345' },
    })
    fireEvent.click(screen.getByRole('button', { name: /decode vin/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy))
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2014' } })
    expect(screen.getByLabelText(/^year$/i)).toHaveValue(2014)
  })

  it('does not claim VIN fields auto-fill before a successful decode', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.queryByText(/vin auto-fills/i)).not.toBeInTheDocument()
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

  it('submits with Command-Enter from the complaint without bypassing the form gate', async () => {
    render(<CounterIntake userEmail="test@example.com" />)
    const complaint = screen.getByLabelText(/what brought them in/i)

    fireEvent.keyDown(complaint, { key: 'Enter', metaKey: true })
    expect(globalThis.fetch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'F-150' } })
    fireEvent.change(complaint, { target: { value: 'No-start' } })
    fireEvent.keyDown(complaint, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
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

  it('POSTs the exact new-vehicle ticket body with structured authorization and requested service, then navigates to the ticket', async () => {
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
    fireEvent.change(screen.getByLabelText(/when did it start/i), {
      target: { value: 'Yesterday' },
    })
    fireEvent.change(screen.getByLabelText(/how often/i), { target: { value: 'Every time' } })
    fireEvent.change(screen.getByLabelText(/diagnostic authorization amount/i), {
      target: { value: '175.50' },
    })
    fireEvent.change(screen.getByLabelText(/authorization note/i), {
      target: { value: 'Call before exceeding this amount' },
    })
    fireEvent.change(screen.getByLabelText(/requested service description/i), {
      target: { value: 'Replace rear brake pads' },
    })
    fireEvent.change(screen.getByLabelText(/requested service kind/i), {
      target: { value: 'repair' },
    })

    fireEvent.submit(document.getElementById('counter-intake-form')!)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/tickets/counter',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
        }),
      )
    })

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(JSON.parse(init!.body as string)).toEqual({
      vehicleMode: 'new',
      customer: {
        name: 'Robert Sandoval',
        phone: '(303) 555-0142',
        email: null,
      },
      vehicle: {
        year: 2014,
        make: 'BMW',
        model: '335i',
        engine: null,
        vin: 'WBA3A5C50EJF12345',
        mileage: null,
        plate: null,
      },
      concern: 'Crank-no-start',
      whenStarted: 'Yesterday',
      howOften: 'Every time',
      diagnosticAuthorization: {
        amountDollars: '175.50',
        note: 'Call before exceeding this amount',
      },
      requestedService: { kind: 'repair', description: 'Replace rear brake pads' },
      assignedTechId: null,
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tickets/ticket-abc')
    })
  })

  it('sends numeric year and mileage while omitting an empty optional service', async () => {
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'No-start' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.vehicle.year).toBe(2020)
    expect(body.vehicle.mileage).toBe(123456)
    expect(body.requestedService).toBeUndefined()
    expect(body.concern).toBe('No-start')
    expect(body.jobs).toBeUndefined()
  })

  it('shows an error envelope and does not redirect without a ticket', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'not_found' }),
    } as Response)
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'No-start' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/selected customer or vehicle/i),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('requires an explicit Assign anyway action before retrying a below-tier assignment', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'tier_confirmation_required',
          warning: {
            code: 'below_required_tier',
            assignedTechId: 'b',
            assignedSkillTier: 2,
            requiredSkillTier: 3,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket: { id: 'ticket-confirmed' } }),
      } as Response)

    render(
      <CounterIntake
        userEmail="brandon@example.com"
        team={[
          {
            id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true,
            workload: { open: 0, today: 0 },
          },
          {
            id: 'b', name: 'Diana', skillTier: 2, isCurrentUser: false,
            workload: { open: 0, today: 0 },
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    fireEvent.click(screen.getByRole('option', { name: /diana/i }))
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'No-start' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/below.*a-tier/i))
    expect(screen.getByRole('alert').getAttribute('style')).toContain(
      'var(--vt-risk-medium)',
    )
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /assign anyway/i }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const retryBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[1][1]!.body as string)
    expect(retryBody.confirmBelowTier).toBe(true)
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/tickets/ticket-confirmed'))
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
