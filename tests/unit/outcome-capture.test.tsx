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

describe('OutcomeCapture (wired)', () => {
  it('disables submit when no sessionId is provided (design-preview mode)', () => {
    render(<OutcomeCapture {...baseProps} />)
    fillSpecificRootCause()
    expect(screen.getByRole('button', { name: /submit & close/i })).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))

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
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))

    await waitFor(() =>
      expect(screen.getByText(/Pin\/connector ID, please/i)).toBeInTheDocument(),
    )
    expect(hrefSetter).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))

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

    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))

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
    // toggle "test drive" off
    fireEvent.click(screen.getByRole('switch', { name: /test drive/i }))
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.verification.testDrive).toBe(false)
    expect(body.verification.codesCleared).toBe(true)
  })
})
