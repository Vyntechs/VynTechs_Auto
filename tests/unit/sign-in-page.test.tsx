import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSignInWithPassword = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockPush = vi.fn()

vi.mock('@/lib/supabase-client', () => ({
  getBrowserSupabase: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import SignInPage from '@/app/(auth)/sign-in/page'

function setLocationSearch(search: string) {
  window.history.replaceState({}, '', `/sign-in${search}`)
}

describe('SignInPage', () => {
  beforeEach(() => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    setLocationSearch('')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders email, password, and a sign-in submit button', () => {
    render(<SignInPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByText(/work orders, job flow, and quotes/i)).toBeInTheDocument()
    expect(screen.queryByText(/your sessions/i)).toBeNull()
  })

  it('renders a "Forgot password?" link pointing at /forgot-password', () => {
    render(<SignInPage />)
    const link = screen.getByRole('link', { name: /forgot password/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/forgot-password')
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

  it('routes to ?next= after successful sign-in when it is a safe relative path', async () => {
    setLocationSearch('?next=%2Fcurator%2Ffounder-notes')
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'brandon@vyntechs.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correct-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/curator/founder-notes'))
  })

  it('renders a "Continue with Google" button that calls signInWithOAuth with the callback next param', async () => {
    setLocationSearch('?next=%2Fcurator%2Ffounder-notes')
    render(<SignInPage />)
    const googleBtn = screen.getByRole('button', { name: /continue with google/i })
    expect(googleBtn).toBeInTheDocument()
    fireEvent.click(googleBtn)
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
    const call = mockSignInWithOAuth.mock.calls[0][0]
    expect(call.provider).toBe('google')
    expect(call.options.redirectTo).toContain('/auth/callback')
    expect(call.options.redirectTo).toContain(
      encodeURIComponent('/curator/founder-notes'),
    )
  })

  it('Google sign-in falls back to /today as the post-auth next when ?next= is missing', async () => {
    render(<SignInPage />)
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
    const call = mockSignInWithOAuth.mock.calls[0][0]
    expect(call.options.redirectTo).toContain(encodeURIComponent('/today'))
  })

  it('falls back to /today when ?next= is missing or unsafe', async () => {
    setLocationSearch('?next=https%3A%2F%2Fevil.example%2Fsteal')
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'brandon@vyntechs.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correct-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/today'))
  })
})
