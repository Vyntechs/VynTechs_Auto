import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSection } from '@/components/vt/account-section'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/lib/supabase-client', () => ({
  getBrowserSupabase: vi.fn(),
}))

const profileId = '11111111-1111-4111-8111-111111111111'

function renderAccount(overrides: Partial<React.ComponentProps<typeof AccountSection>> = {}) {
  return render(
    <AccountSection
      initialFullName="Taylor Tech"
      email="taylor@example.com"
      profileId={profileId}
      canTrackJobTime
      initialJobTimerEnabled={false}
      {...overrides}
    />,
  )
}

describe('AccountSection personal job timer preference', () => {
  beforeEach(() => {
    refresh.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('keeps personal time tracking default-off and saves only after a deliberate action', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ preference: { profileId, enabled: true } }),
        { status: 200 },
      ),
    )
    renderAccount()

    const checkbox = screen.getByRole('checkbox', {
      name: 'Track time on my jobs',
    })
    expect(checkbox).not.toBeChecked()
    expect(
      screen.getByText('Personal job-time reference. Not payroll or performance tracking.'),
    ).toBeInTheDocument()

    await user.click(checkbox)
    expect(fetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save time tracking' }))

    expect(fetch).toHaveBeenCalledWith(
      '/api/account/job-timer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      }),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('does not show the technician-only preference to someone who does not wrench', () => {
    renderAccount({ canTrackJobTime: false })

    expect(
      screen.queryByRole('checkbox', { name: 'Track time on my jobs' }),
    ).not.toBeInTheDocument()
  })

  it('reloads exact server truth after an uncertain save instead of reporting a false success', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ preference: { profileId, enabled: false } }),
          { status: 200 },
        ),
      )
    renderAccount()

    await user.click(screen.getByRole('checkbox', { name: 'Track time on my jobs' }))
    await user.click(screen.getByRole('button', { name: 'Save time tracking' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/account/job-timer',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(screen.getByRole('checkbox', { name: 'Track time on my jobs' })).not.toBeChecked()
    expect(screen.getByText('The change did not land. Current setting restored.')).toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it.each([
    {
      scenario: 'a lost response',
      firstResult: () => Promise.reject(new TypeError('network interrupted')),
    },
    {
      scenario: 'an invalid success envelope',
      firstResult: () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    },
  ])('confirms exact server truth after $scenario', async ({ firstResult }) => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockImplementationOnce(firstResult)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ preference: { profileId, enabled: true } }),
          { status: 200 },
        ),
      )
    renderAccount()

    await user.click(screen.getByRole('checkbox', { name: 'Track time on my jobs' }))
    await user.click(screen.getByRole('button', { name: 'Save time tracking' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/account/job-timer',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })
})
