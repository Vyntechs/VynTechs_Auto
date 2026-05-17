import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldGroup } from '@/components/knowledge/form-helpers'

describe('FieldGroup', () => {
  it('renders no badge and no source for attribution="none"', () => {
    render(
      <FieldGroup label="Title" attribution="none">
        <input />
      </FieldGroup>,
    )
    expect(screen.queryByText(/VERIFY/i)).toBeNull()
    expect(screen.queryByText(/from your paste/i)).toBeNull()
  })

  it('renders the source quote (no AI chip) when attribution="verified"', () => {
    render(
      <FieldGroup label="Title" attribution="verified" source="quoted text">
        <input />
      </FieldGroup>,
    )
    expect(screen.queryByText('AI')).toBeNull()
    expect(screen.getByText(/from your paste/i)).toBeInTheDocument()
    expect(screen.getByText('quoted text')).toBeInTheDocument()
  })

  it('renders the ⚠ VERIFY chip when attribution="unverified"', () => {
    render(
      <FieldGroup label="Title" attribution="unverified">
        <input />
      </FieldGroup>,
    )
    const chip = screen.getByLabelText('needs verification')
    expect(chip).toBeInTheDocument()
    expect(chip.textContent).toMatch(/VERIFY/i)
    expect(screen.queryByText(/from your paste/i)).toBeNull()
  })

  it('falls back to unverified rendering when attribution=verified but source is empty', () => {
    render(
      <FieldGroup label="Title" attribution="verified" source="">
        <input />
      </FieldGroup>,
    )
    expect(screen.queryByText(/from your paste/i)).toBeNull()
    expect(screen.getByLabelText('needs verification')).toBeInTheDocument()
  })
})
