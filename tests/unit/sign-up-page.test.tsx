import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSignUp = vi.fn()

vi.mock('@/lib/supabase-client', () => ({
  getBrowserSupabase: () => ({
    auth: { signUp: mockSignUp },
  }),
}))

import SignUpPage from '@/app/(auth)/sign-up/page'

describe('SignUpPage', () => {
  beforeEach(() => {
    mockSignUp.mockResolvedValue({ data: {}, error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders email, password, and a create-account submit button', () => {
    render(<SignUpPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
  })

  it('calls supabase.auth.signUp with the entered email and password on submit', async () => {
    render(<SignUpPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mike@joesgarage.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter22hunter22' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled())
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'mike@joesgarage.com',
      password: 'hunter22hunter22',
    })
  })

  it('shows an email-confirmation message on successful sign-up', async () => {
    render(<SignUpPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mike@joesgarage.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter22hunter22' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText(/check your email to confirm/i),
    ).toBeInTheDocument()
  })

  it('shows the auth error message and no confirmation when sign-up fails', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: null,
      error: { message: 'User already registered' },
    })

    render(<SignUpPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mike@joesgarage.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter22hunter22' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/user already registered/i)).toBeInTheDocument()
    expect(screen.queryByText(/check your email to confirm/i)).not.toBeInTheDocument()
  })
})
