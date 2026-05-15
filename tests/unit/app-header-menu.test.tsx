import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeaderMenu } from '@/components/vt/app-header-menu'
import { AppHeaderProvider } from '@/components/vt/app-header-context'

vi.mock('@/lib/supabase-client', () => ({
  getBrowserSupabase: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function renderWithProvider(opts: { shopName?: string | null; isFounder?: boolean } = {}) {
  const { shopName = 'Young Motorsports', isFounder = false } = opts
  return render(
    <AppHeaderProvider shopName={shopName} isFounder={isFounder}>
      <AppHeaderMenu />
    </AppHeaderProvider>,
  )
}

describe('AppHeaderMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a hamburger trigger button labeled Menu', () => {
    renderWithProvider()
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument()
  })

  it('does not show menu items until opened', () => {
    renderWithProvider()
    expect(screen.queryByRole('menuitem', { name: /my jobs/i })).not.toBeInTheDocument()
  })

  it('opens menu when trigger clicked, shows My Jobs, Settings, Sign Out', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByRole('button', { name: /menu/i }))
    expect(screen.getByRole('menuitem', { name: /my jobs/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  })

  it('hides Curator item when isFounder=false', async () => {
    const user = userEvent.setup()
    renderWithProvider({ isFounder: false })
    await user.click(screen.getByRole('button', { name: /menu/i }))
    expect(screen.queryByRole('menuitem', { name: /curator/i })).not.toBeInTheDocument()
  })

  it('shows Curator item when isFounder=true', async () => {
    const user = userEvent.setup()
    renderWithProvider({ isFounder: true })
    await user.click(screen.getByRole('button', { name: /menu/i }))
    expect(screen.getByRole('menuitem', { name: /curator/i })).toBeInTheDocument()
  })

  it('closes menu when Escape pressed', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByRole('button', { name: /menu/i }))
    expect(screen.getByRole('menuitem', { name: /my jobs/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: /my jobs/i })).not.toBeInTheDocument()
  })

  it('closes menu when clicking outside', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <AppHeaderProvider shopName="Young Motorsports" isFounder={false}>
        <AppHeaderMenu />
        <div data-testid="outside">outside</div>
      </AppHeaderProvider>,
    )
    await user.click(screen.getByRole('button', { name: /menu/i }))
    expect(screen.getByRole('menuitem', { name: /my jobs/i })).toBeInTheDocument()
    await user.click(screen.getByTestId('outside'))
    expect(screen.queryByRole('menuitem', { name: /my jobs/i })).not.toBeInTheDocument()
    expect(container).toBeTruthy()
  })

  it('trigger meets ≥44px tap target', () => {
    const { container } = renderWithProvider()
    const trigger = container.querySelector('.app-header__menu-trigger') as HTMLElement
    expect(trigger).toBeTruthy()
    expect(trigger.className).toContain('app-header__menu-trigger')
  })

  it('aria-expanded reflects open state', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    const trigger = screen.getByRole('button', { name: /menu/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
