import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSignInWithPassword = vi.fn()
const mockPush = vi.fn()

vi.mock('@/lib/supabase-client', () => ({
  getBrowserSupabase: () => ({
    auth: { signInWithPassword: mockSignInWithPassword },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import SignInPage from '@/app/(auth)/sign-in/page'

describe('SignInPage', () => {
  beforeEach(() => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders email, password, and a sign-in submit button', () => {
    render(<SignInPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('calls supabase.auth.signInWithPassword with the entered email and password on submit', async () => {
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mike@joesgarage.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter22hunter22' },
    })

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockSignInWithPassword).toHaveBeenCalled())
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'mike@joesgarage.com',
      password: 'hunter22hunter22',
    })
  })

  it('displays the auth error message and does not navigate when sign-in fails', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    })

    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mike@joesgarage.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' },
    })

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
