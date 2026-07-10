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
  },
  {
    userId: 'advisor-1',
    profileId: 'profile-2',
    fullName: 'Alex Advisor',
    role: 'advisor',
    skillTier: null,
    membershipStatus: 'active',
    deactivated: false,
  },
  {
    userId: 'parts-pending',
    profileId: 'profile-3',
    fullName: 'Pat Pending',
    role: 'parts',
    skillTier: 1,
    membershipStatus: 'pending',
    deactivated: false,
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
})
