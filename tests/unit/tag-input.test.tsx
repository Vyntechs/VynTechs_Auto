import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagInput } from '@/components/knowledge/form-helpers'

describe('TagInput', () => {
  it('renders values as chips (unchanged baseline behavior)', () => {
    render(<TagInput values={['P0420', 'P0430']} setValues={() => {}} />)
    expect(screen.getByText('P0420')).toBeTruthy()
    expect(screen.getByText('P0430')).toBeTruthy()
  })

  it('without normalize: Enter adds the raw value', () => {
    const setValues = vi.fn()
    render(<TagInput values={[]} setValues={setValues} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'anything' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setValues).toHaveBeenCalledWith(['anything'])
  })

  it('with normalize that returns a value: Enter adds the canonical value', () => {
    const setValues = vi.fn()
    const normalize = vi.fn((raw: string) =>
      raw === 'p0420' ? { value: 'P0420', suffix: null } : null,
    )
    render(<TagInput values={[]} setValues={setValues} normalize={normalize} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'p0420' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setValues).toHaveBeenCalledWith(['P0420'])
  })

  it('with normalize that returns null: hard-rejects, no chip added, shows error', () => {
    const setValues = vi.fn()
    const normalize = vi.fn(() => null)
    render(<TagInput values={[]} setValues={setValues} normalize={normalize} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'garbage' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setValues).not.toHaveBeenCalled()
    expect(input.className).toMatch(/error/i)
    expect(screen.getByText(/not a valid/i)).toBeTruthy()
  })

  it('clears the error when the user resumes typing', () => {
    const setValues = vi.fn()
    const normalize = vi.fn(() => null)
    render(<TagInput values={[]} setValues={setValues} normalize={normalize} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'garbage' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.className).toMatch(/error/i)
    fireEvent.change(input, { target: { value: 'garbage2' } })
    expect(input.className).not.toMatch(/error/i)
  })

  it('displaySuffix renders the suffix next to the chip value', () => {
    render(
      <TagInput
        values={['P0420']}
        setValues={() => {}}
        displaySuffix={(v) => (v === 'P0420' ? '00' : null)}
      />,
    )
    expect(screen.getByText('P0420')).toBeTruthy()
    expect(screen.getByText(/·00/)).toBeTruthy()
  })
})
