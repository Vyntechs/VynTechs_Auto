import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamSection } from '@/components/vt/team-section'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

const members = [
  {
    userId: 'owner-1',
    profileId: 'profile-1',
    fullName: 'Olivia Owner',
    role: 'owner',
    skillTier: 3,
    membershipStatus: 'active',
    deactivated: false,
    jobTimerEnabled: false,
  },
  {
    userId: 'advisor-1',
    profileId: 'profile-2',
    fullName: 'Alex Advisor',
    role: 'advisor',
    skillTier: null,
    membershipStatus: 'active',
    deactivated: false,
    jobTimerEnabled: false,
  },
  {
    userId: 'parts-pending',
    profileId: 'profile-3',
    fullName: 'Pat Pending',
    role: 'parts',
    skillTier: 1,
    membershipStatus: 'pending',
    deactivated: false,
    jobTimerEnabled: false,
  },
]

describe('TeamSection Shop OS roles', () => {
  beforeEach(() => {
    refresh.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('shows the four shop roles and nullable wrenching tiers for each member', () => {
    render(<TeamSection members={members} currentUserId="owner-1" />)

    const role = screen.getByLabelText('Role for Alex Advisor')
    expect(role).toHaveValue('advisor')
    expect(role).toHaveTextContent('Tech')
    expect(role).toHaveTextContent('Advisor')
    expect(role).toHaveTextContent('Parts')
    expect(role).toHaveTextContent('Owner')

    const tier = screen.getByLabelText('Skill tier for Alex Advisor')
    expect(tier).toHaveValue('')
    expect(tier).toHaveTextContent('Does not wrench')
    expect(tier).toHaveTextContent('A-tech')
    expect(tier).toHaveTextContent('B-tech')
    expect(tier).toHaveTextContent('C-tech')
  })

  it('sends the selected role and tier together', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    render(<TeamSection members={members} currentUserId="owner-1" />)

    await user.selectOptions(screen.getByLabelText('Role for Alex Advisor'), 'parts')
    await user.selectOptions(screen.getByLabelText('Skill tier for Alex Advisor'), '2')
    await user.click(screen.getByRole('button', { name: 'Save Alex Advisor' }))

    expect(fetch).toHaveBeenCalledWith(
      '/api/team/role',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          userId: 'advisor-1',
          role: 'parts',
          skillTier: 2,
        }),
      }),
    )
  })

  it('lets an owner choose role and tier before sending an invite', () => {
    render(<TeamSection members={members} currentUserId="owner-1" />)
    expect(screen.getByLabelText('Invite role')).toHaveValue('tech')
    expect(screen.getByLabelText('Invite skill tier')).toHaveValue('')
  })

  it('labels an unaccepted invitation as pending rather than active', () => {
    render(<TeamSection members={members} currentUserId="owner-1" />)
    expect(screen.getByText('Invite pending')).toBeInTheDocument()
  })

  it('offers per-person timing only for active teammates who wrench', () => {
    render(<TeamSection members={members} currentUserId="owner-1" />)

    expect(
      screen.getByRole('checkbox', { name: "Track time on Olivia Owner's jobs" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: "Track time on Alex Advisor's jobs" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: "Track time on Pat Pending's jobs" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/all technicians/i)).not.toBeInTheDocument()
  })

  it('saves an eligible teammate timer preference only after a deliberate action', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          preference: { profileId: 'profile-1', enabled: true },
        }),
        { status: 200 },
      ),
    )
    render(<TeamSection members={members} currentUserId="owner-1" />)

    await user.click(
      screen.getByRole('checkbox', { name: "Track time on Olivia Owner's jobs" }),
    )
    expect(fetch).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'Save time tracking for Olivia Owner' }),
    )

    expect(fetch).toHaveBeenCalledWith(
      '/api/team/job-timer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ profileId: 'profile-1', enabled: true }),
      }),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('makes the owner save role and tier changes before changing time tracking', async () => {
    const user = userEvent.setup()
    render(<TeamSection members={members} currentUserId="owner-1" />)

    await user.selectOptions(screen.getByLabelText('Skill tier for Olivia Owner'), '2')

    expect(
      screen.getByRole('checkbox', { name: "Track time on Olivia Owner's jobs" }),
    ).toBeDisabled()
    expect(
      screen.getByText('Save role and skill tier before changing time tracking.'),
    ).toBeInTheDocument()
  })

  it('reconciles an uncertain teammate save against the exact persisted value', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            preference: { profileId: 'profile-1', enabled: false },
          }),
          { status: 200 },
        ),
      )
    render(<TeamSection members={members} currentUserId="owner-1" />)

    await user.click(
      screen.getByRole('checkbox', { name: "Track time on Olivia Owner's jobs" }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Save time tracking for Olivia Owner' }),
    )

    await screen.findByText('The change did not land. Current setting restored.')
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/team/job-timer?profileId=profile-1',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(
      screen.getByRole('checkbox', { name: "Track time on Olivia Owner's jobs" }),
    ).not.toBeChecked()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })
})
