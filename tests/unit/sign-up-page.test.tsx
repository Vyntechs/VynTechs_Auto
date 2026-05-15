import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSignUp = vi.fn()
const mockSignInWithOAuth = vi.fn()
const { hrefSetter } = vi.hoisted(() => ({ hrefSetter: vi.fn() }))

vi.mock('@/lib/supabase-client', () => ({
  getBrowserSupabase: () => ({
    auth: {
      signUp: mockSignUp,
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}))

import { SignUpForm } from '@/app/(auth)/sign-up/sign-up-form'

// happy-dom otherwise actually navigates when code sets window.location.href,
// which a) cross-origins the document for the next test and b) breaks the
// canceled-banner test that reads window.location.search. Stub the whole
// location object so href assignments land on a spy and search is controllable.
function stubLocation(search = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get origin() {
        return 'http://localhost:3000'
      },
      get href() {
        return `http://localhost:3000/sign-up${search}`
      },
      set href(v: string) {
        hrefSetter(v)
      },
      get search() {
        return search
      },
    },
  })
}

describe('SignUpForm', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_abc' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    stubLocation('')
  })

  afterEach(() => {
    vi.clearAllMocks()
    fetchSpy.mockRestore()
    hrefSetter.mockReset()
  })

  function fillSignUpForm(name = 'Mike Joe', email = 'mike@joesgarage.com', password = 'hunter22hunter22') {
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: name },
    })
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: email },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: password },
    })
  }

  it('renders Google button, name field, email field, password field, and submit', () => {
    render(<SignUpForm />)
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create account/i }),
    ).toBeInTheDocument()
  })

  it('email submit calls supabase.auth.signUp with entered creds and full_name metadata', async () => {
    render(<SignUpForm />)
    fillSignUpForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled())
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'mike@joesgarage.com',
      password: 'hunter22hunter22',
      options: { data: { full_name: 'Mike Joe' } },
    })
  })

  it('blocks submission and shows an error when the name field is empty', async () => {
    render(<SignUpForm />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mike@joesgarage.com' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter22hunter22' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText(/please enter your name/i),
    ).toBeInTheDocument()
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace from the name before submitting', async () => {
    render(<SignUpForm />)
    fillSignUpForm('  Mike Joe  ')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled())
    const call = mockSignUp.mock.calls[0]?.[0]
    expect(call.options.data.full_name).toBe('Mike Joe')
  })

  it('after successful sign-up, POSTs /api/stripe/checkout and uses the returned URL', async () => {
    render(<SignUpForm />)
    fillSignUpForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/stripe/checkout',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows the auth error message when sign-up fails and skips checkout', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: null,
      error: { message: 'User already registered' },
    })

    render(<SignUpForm />)
    fillSignUpForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText(/user already registered/i),
    ).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows an error when the checkout fetch returns a non-OK response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'price not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(<SignUpForm />)
    fillSignUpForm()
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText(/price not configured/i),
    ).toBeInTheDocument()
  })

  it('clicking Continue with Google calls signInWithOAuth with the correct redirectTo', async () => {
    render(<SignUpForm />)
    fireEvent.click(
      screen.getByRole('button', { name: /continue with google/i }),
    )

    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled())
    const callArgs = mockSignInWithOAuth.mock.calls[0]?.[0]
    expect(callArgs.provider).toBe('google')
    expect(callArgs.options.redirectTo).toContain(
      '/auth/callback?next=/api/stripe/checkout-redirect',
    )
  })

  it('shows the canceled-checkout banner when ?canceled=true is present', () => {
    stubLocation('?canceled=true')
    render(<SignUpForm />)
    expect(
      screen.getByText(/didn.{0,3}t complete checkout/i),
    ).toBeInTheDocument()
  })

  it('does not show the canceled banner on a clean visit', () => {
    render(<SignUpForm />)
    expect(
      screen.queryByText(/didn.{0,3}t complete checkout/i),
    ).not.toBeInTheDocument()
  })
})
