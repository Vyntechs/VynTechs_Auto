import { describe, it, expect } from 'vitest'
import {
  isKnownPlatformSlug,
  isKnownSymptomSlug,
  listPlatformChoices,
  listSymptomChoices,
  platformDisplayName,
  symptomDisplayName,
} from '@/lib/curator/slug-catalog'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'

describe('slug-catalog', () => {
  it('lists at least the two known Ford PSD platforms', () => {
    const slugs = listPlatformChoices().map((c) => c.slug)
    expect(slugs).toContain('ford-super-duty-3rd-gen-60-psd')
    expect(slugs).toContain('ford-super-duty-4th-gen-67-psd')
  })

  it('every platform choice has a non-empty display string', () => {
    for (const c of listPlatformChoices()) {
      expect(c.slug.length).toBeGreaterThan(0)
      expect(c.display.trim().length).toBeGreaterThan(0)
    }
  })

  it('platformDisplayName / symptomDisplayName resolve known slugs and fall back to the slug', () => {
    expect(platformDisplayName('ford-super-duty-3rd-gen-60-psd').trim().length).toBeGreaterThan(0)
    expect(symptomDisplayName('cranks-no-start').trim().length).toBeGreaterThan(0)
    expect(platformDisplayName('made-up-platform')).toBe('made-up-platform')
  })

  it('lists the canonical symptom slugs', () => {
    const slugs = listSymptomChoices().map((c) => c.slug)
    expect(slugs).toContain('cranks-no-start')
  })

  it('isKnownPlatformSlug accepts catalog slugs and rejects others', () => {
    expect(isKnownPlatformSlug('ford-super-duty-3rd-gen-60-psd')).toBe(true)
    expect(isKnownPlatformSlug('made-up-platform')).toBe(false)
    expect(isKnownPlatformSlug('')).toBe(false)
  })

  it('isKnownSymptomSlug accepts catalog slugs and rejects others', () => {
    expect(isKnownSymptomSlug('cranks-no-start')).toBe(true)
    expect(isKnownSymptomSlug('made-up-symptom')).toBe(false)
  })

  // Anti-drift: every slug the platform resolver can emit MUST be in the catalog,
  // otherwise a flow authored from resolver output could fail the publish gate.
  it('catalog covers every slug the resolver can produce', () => {
    const resolverOutputs = [
      resolvePlatformSlug({ year: 2005, make: 'Ford', model: 'F-250', engine: '6.0L' }),
      resolvePlatformSlug({ year: 2019, make: 'Ford', model: 'F-350', engine: '6.7 PSD' }),
    ].filter((s): s is string => s !== null)
    for (const slug of resolverOutputs) {
      expect(isKnownPlatformSlug(slug)).toBe(true)
    }
  })
})
