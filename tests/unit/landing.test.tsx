import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StickyCTA } from '@/components/marketing/sticky-cta'
import { FAQ } from '@/components/marketing/faq'

describe('StickyCTA — auth-aware', () => {
  it('renders Subscribe CTA pointing at /sign-up when anonymous', () => {
    render(<StickyCTA isSignedIn={false} />)
    const cta = screen.getByRole('link', { name: /subscribe/i })
    expect(cta).toHaveAttribute('href', '/sign-up')
    expect(cta).toHaveTextContent(/\$100\/MO/i)
  })

  it('renders Go to app CTA pointing at /today when signed in', () => {
    render(<StickyCTA isSignedIn={true} />)
    const cta = screen.getByRole('link', { name: /go to app/i })
    expect(cta).toHaveAttribute('href', '/today')
    expect(screen.queryByText(/\$100\/MO/i)).not.toBeInTheDocument()
  })
})

describe('FAQ — single-open accordion', () => {
  it('starts with all rows collapsed', () => {
    render(<FAQ />)
    const questions = screen.getAllByRole('button', { expanded: false })
    expect(questions.length).toBeGreaterThanOrEqual(6)
  })

  it('opens a row on click and closes others', () => {
    render(<FAQ />)
    const [first, second] = screen.getAllByRole('button')
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggles closed when clicking the open row', () => {
    render(<FAQ />)
    const [first] = screen.getAllByRole('button')
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'false')
  })
})
