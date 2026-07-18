import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { hrefSetter } = vi.hoisted(() => ({ hrefSetter: vi.fn() }))

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() {
        return 'http://localhost/'
      },
      set href(v: string) {
        hrefSetter(v)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  hrefSetter.mockReset()
})

import { OutcomeCapture } from '@/components/screens/outcome-capture'

const baseProps = {
  vehicleName: '2018 Ford F-150 — 3.5L EcoBoost',
  vehicleMeta: 'closing case · session 0:58:12',
  timer: '0:58',
  diagMin: 24,
  repairMin: 30,
}

function fillSpecificRootCause() {
  fireEvent.change(screen.getByLabelText(/root cause/i), {
    target: {
      value:
        'Wastegate vacuum line cracked ~2in from actuator-can end on driver-side turbo',
    },
  })
}

// Verification no longer defaults to "resolved"; a close now requires the tech
// to pick a result, so wired-submit tests must choose one first.
function chooseResolved(opt: 'yes' | 'partial' | 'no' = 'yes') {
  fireEvent.click(
    screen.getByRole('switch', { name: new RegExp(`resolved: ${opt}`, 'i') }),
  )
}

describe('OutcomeCapture (wired)', () => {
  it('disables submit when no sessionId is provided (design-preview mode)', () => {
    render(<OutcomeCapture {...baseProps} />)
    fillSpecificRootCause()
    expect(screen.getByRole('button', { name: /send & close/i })).toBeDisabled()
  })

  // 2026-05-29 trust sweep: the footer carried a permanently-disabled "Save
  // draft" button (no onClick, no draft persistence) — a dead control that
  // tells the tech the rest of the app might be fake too. Removed.
  // docs/strategy/2026-05-29-customer-interaction-doctrine.md (§2.5)
  it('does not render a dead "Save draft" button', () => {
    render(<OutcomeCapture {...baseProps} />)
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
  })

  it('POSTs the structured payload to /api/sessions/[id]/close on submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line, silicone 4mm' },
    })
    fireEvent.change(screen.getByLabelText(/oem/i), {
      target: { value: 'BL3Z-9C915-A' },
    })
    fireEvent.click(screen.getByRole('switch', { name: /codes cleared/i }))
    fireEvent.click(screen.getByRole('switch', { name: /test drive/i }))
    chooseResolved('yes')
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/sessions/sess-abc/close')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.actionType).toBe('part_replacement')
    expect(body.partInfo.name).toBe('Vacuum line, silicone 4mm')
    expect(body.partInfo.oemNumber).toBe('BL3Z-9C915-A')
    expect(body.diagMinutes).toBe(24)
    expect(body.repairMinutes).toBe(30)
    expect(body.verification.codesCleared).toBe(true)
    expect(body.verification.testDrive).toBe(true)
    expect(body.verification.symptomsResolved).toBe('yes')

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/sessions'))
  })

  it('shows server feedback inline when the API returns 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'specificity_required',
          feedback: 'Where exactly was the crack? Pin/connector ID, please.',
        }),
        text: async () => '',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })
    chooseResolved('yes')
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))

    await waitFor(() =>
      expect(screen.getByText(/Pin\/connector ID, please/i)).toBeInTheDocument(),
    )
    expect(hrefSetter).not.toHaveBeenCalled()
  })

  it('turns a revoked approval race into technician-facing guidance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'repair_not_authorized' }),
        text: async () => '{"error":"repair_not_authorized"}',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })
    chooseResolved('yes')
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Repair approval changed. Return to the diagnosis and refresh before continuing.',
    )
  })

  it('omits partInfo from payload when actionType is not part_replacement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/action type/i), {
      target: { value: 'no_fix' },
    })
    chooseResolved('yes')
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.actionType).toBe('no_fix')
    expect(body.partInfo).toBeUndefined()
  })

  it('after a 422, the button label changes to indicate override and second submit sends override', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'specificity_required',
          feedback: 'Add the bolt location to Root cause.',
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })

    chooseResolved('yes')
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))
    await waitFor(() =>
      expect(screen.getByText(/Add the bolt location/i)).toBeInTheDocument(),
    )

    const overrideBtn = await screen.findByRole('button', { name: /override/i })
    expect(overrideBtn).toBeInTheDocument()

    fireEvent.click(overrideBtn)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondCallBody.override).toBeDefined()
    expect(secondCallBody.override.lastFeedback).toMatch(/bolt location/i)
    expect(secondCallBody.override.at).toMatch(/\d{4}-\d{2}-\d{2}T/)

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/sessions'))
  })

  it('does NOT include override on the very first submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })
    chooseResolved('yes')
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body.override).toBeUndefined()
  })

  // 2026-05-08 nav audit: back arrow used to always go to /today (My Jobs).
  // Now it points at the diagnosis the tech was just on, so "back" means
  // "back to where I came from" instead of "all the way home."
  it('back link points to the diagnosis page when sessionId is provided (was: /today)', () => {
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    const back = screen.getByRole('link', { name: /diagnosis/i })
    expect(back).toHaveAttribute('href', '/sessions/sess-abc')
  })

  it('back link falls back to /today (My Jobs) when no sessionId is in scope (design/preview mode)', () => {
    render(<OutcomeCapture {...baseProps} />)
    const back = screen.getByRole('link', { name: /my jobs/i })
    expect(back).toHaveAttribute('href', '/today')
  })

  it('reflects toggling a verification chip in the submitted payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })
    chooseResolved('yes')
    // verification starts unchecked; toggle "test drive" on
    fireEvent.click(screen.getByRole('switch', { name: /test drive/i }))
    fireEvent.click(screen.getByRole('button', { name: /send & close/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.verification.testDrive).toBe(true)
    expect(body.verification.codesCleared).toBe(false)
  })

  it('does not pre-assert verification — every chip starts off', () => {
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    expect(screen.getByRole('switch', { name: /codes cleared/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('switch', { name: /test drive/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    for (const opt of ['yes', 'partial', 'no']) {
      expect(
        screen.getByRole('switch', { name: new RegExp(`resolved: ${opt}`, 'i') }),
      ).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('keeps submit disabled until the tech states whether symptoms resolved', () => {
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })
    expect(screen.getByRole('button', { name: /send & close/i })).toBeDisabled()
    chooseResolved('partial')
    expect(screen.getByRole('button', { name: /send & close/i })).toBeEnabled()
  })
})
