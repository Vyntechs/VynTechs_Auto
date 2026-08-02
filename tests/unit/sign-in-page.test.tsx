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

  it('falls back to /today for a decoded backslash authority escape', async () => {
    setLocationSearch('?next=%2F%5Cevil.example')
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

/* Regression: before React hydrates, this is a plain HTML form. A press on the
   submit button used to perform a native GET, which put the typed password in
   the address bar, the browser's history, and the outgoing Referer. Reproduced
   against production on 2026-08-01. */
describe('SignInPage credential exposure before hydration', () => {
  it('never lets a native submit put fields in the query string', () => {
    const { container } = render(<SignInPage />)
    const form = container.querySelector('form')

    expect(form).not.toBeNull()
    // A form with no method GETs, serialising every named field into the URL.
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
  })

  it('keeps the submit button inert until the client is live', async () => {
    const { renderToString } = await import('react-dom/server')
    // Server render runs no effects, which is exactly the pre-hydration DOM.
    const html = renderToString(<SignInPage />)
    const submit = html.slice(html.indexOf('type="submit"'))

    expect(submit.slice(0, submit.indexOf('>'))).toContain('disabled')
  })

  it('enables the button once mounted so sign-in still works', async () => {
    render(<SignInPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled(),
    )

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'tech@shop.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'tech@shop.com',
        password: 'correct horse',
      }),
    )
  })
})
