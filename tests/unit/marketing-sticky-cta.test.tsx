import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { StickyCTA } from '@/components/marketing/sticky-cta'

describe('StickyCTA', () => {
  it('shows a "Sign in" link to /sign-in when the visitor is signed out so existing customers can get in without going through the create-account funnel', () => {
    render(<StickyCTA isSignedIn={false} />)
    const signIn = screen.getByRole('link', { name: /sign in/i })
    expect(signIn).toHaveAttribute('href', '/sign-in')
  })

  it('keeps the Subscribe CTA pointed at /sign-up when signed out', () => {
    render(<StickyCTA isSignedIn={false} />)
    const subscribe = screen.getByRole('link', { name: /subscribe/i })
    expect(subscribe).toHaveAttribute('href', '/sign-up')
  })

  it('replaces both with a single "Go to app" link when the visitor is already signed in', () => {
    render(<StickyCTA isSignedIn={true} />)
    expect(screen.getByRole('link', { name: /go to app/i })).toHaveAttribute(
      'href',
      '/today',
    )
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /subscribe/i })).not.toBeInTheDocument()
  })
})
