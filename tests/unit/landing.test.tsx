import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomePage from '@/app/page'

describe('HomePage', () => {
  it('renders the Vyntechs brand heading', () => {
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vyntechs')
  })

  it('renders the tagline describing the product', () => {
    render(<HomePage />)
    expect(screen.getByText('AI master tech for the bay.')).toBeInTheDocument()
  })

  it('uses a main landmark for the primary content', () => {
    render(<HomePage />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('exposes a Sign up link pointing at /sign-up', () => {
    render(<HomePage />)
    const link = screen.getByRole('link', { name: /sign up/i })
    expect(link).toHaveAttribute('href', '/sign-up')
  })

  it('exposes a Sign in link pointing at /sign-in', () => {
    render(<HomePage />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute('href', '/sign-in')
  })
})
