import { describe, it, expect } from 'vitest'
import manifest from '@/app/manifest'

describe('PWA manifest', () => {
  it('has the expected name and short_name', () => {
    const m = manifest()
    expect(m.name).toBe('Vyntechs')
    expect(m.short_name).toBe('Vyntechs')
  })

  it('declares standalone display and starts at /today', () => {
    const m = manifest()
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/today')
  })

  it('uses Workshop Instrument graphite for theme + background', () => {
    const m = manifest()
    expect(m.theme_color).toBe('#0d0d10')
    expect(m.background_color).toBe('#0d0d10')
  })

  it('declares PNG icons at 192 and 512', () => {
    const m = manifest()
    const sizes = (m.icons ?? []).map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    for (const icon of m.icons ?? []) {
      expect(icon.type).toBe('image/png')
      expect(icon.src.startsWith('/icons/')).toBe(true)
    }
  })
})
