import { describe, expect, it } from 'vitest'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'

describe('resolvePlatformSlug — 2003-2007 F-250 6.0L PSD', () => {
  const PSD_60 = 'ford-super-duty-3rd-gen-60-psd'

  // Clean inputs that should resolve
  it.each([
    { year: 2003, make: 'Ford', model: 'F-250', engine: '6.0L Power Stroke Diesel' },
    { year: 2004, make: 'Ford', model: 'F-250', engine: '6.0L PSD' },
    { year: 2005, make: 'Ford', model: 'F-350', engine: '6.0L Power Stroke' },
    { year: 2006, make: 'ford', model: 'F250', engine: '6.0 powerstroke' },
    { year: 2007, make: 'FORD', model: 'f-250', engine: '6.0' },
    // messy real-world input per "Validate with real inputs" memory
    { year: 2006, make: 'Ford', model: 'F250 Super Duty', engine: '6.0 PSD' },
  ])('resolves $year $make $model $engine → 3rd-gen 6.0 PSD', (input) => {
    expect(resolvePlatformSlug(input)).toBe(PSD_60)
  })

  // Boundary: year range is 2003-2007 inclusive
  it.each([2003, 2004, 2005, 2006, 2007])(
    'resolves year %i within 2003-2007 range',
    (year) => {
      expect(
        resolvePlatformSlug({ year, make: 'Ford', model: 'F-250', engine: '6.0L PSD' }),
      ).toBe(PSD_60)
    },
  )

  // Cases that must NOT resolve to the 6.0 slug
  it('does not resolve 2018 F-250 6.7L — different platform', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke' }),
    ).not.toBe(PSD_60)
  })

  it('does not resolve 2002 F-250 — pre-6.0 era (7.3L)', () => {
    expect(
      resolvePlatformSlug({ year: 2002, make: 'Ford', model: 'F-250', engine: '7.3L' }),
    ).not.toBe(PSD_60)
  })

  it('does not resolve 2008 F-250 — post-6.0 era (6.4L)', () => {
    expect(
      resolvePlatformSlug({ year: 2008, make: 'Ford', model: 'F-250', engine: '6.4L Power Stroke' }),
    ).not.toBe(PSD_60)
  })

  it('does not resolve 2010 F-150 6.0 — F-150 is not a Super Duty', () => {
    expect(
      resolvePlatformSlug({ year: 2010, make: 'Ford', model: 'F-150', engine: '6.0' }),
    ).not.toBe(PSD_60)
  })

  it('does not resolve 2005 Chevrolet Silverado 6.0 — wrong make', () => {
    expect(
      resolvePlatformSlug({ year: 2005, make: 'Chevrolet', model: 'Silverado', engine: '6.0' }),
    ).not.toBe(PSD_60)
  })

  // 6.7L sanity guard — ensure 6.7L branch is unaffected
  it('6.7L branch still resolves 2018 F-250 6.7L PSD (regression guard)', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke' }),
    ).toBe('ford-super-duty-4th-gen-67-psd')
  })
})

describe('resolvePlatformSlug', () => {
  const PSD_67 = 'ford-super-duty-4th-gen-67-psd'

  it('resolves 2018 Ford F-250 6.7L PSD to the 4th-gen Super Duty platform', () => {
    expect(
      resolvePlatformSlug({
        year: 2018,
        make: 'Ford',
        model: 'F-250',
        engine: '6.7L Power Stroke Diesel',
      }),
    ).toBe(PSD_67)
  })

  it.each([2017, 2018, 2019, 2020, 2021, 2022])(
    'resolves year %i F-250 6.7L PSD',
    (year) => {
      expect(
        resolvePlatformSlug({ year, make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke Diesel' }),
      ).toBe(PSD_67)
    },
  )

  it.each(['F-250', 'F-350', 'F-450', 'F-550'])(
    'resolves model %s on the 6.7L PSD',
    (model) => {
      expect(
        resolvePlatformSlug({ year: 2018, make: 'Ford', model, engine: '6.7L Power Stroke Diesel' }),
      ).toBe(PSD_67)
    },
  )

  it('handles common engine-string variants', () => {
    const inputs = ['6.7L PSD', '6.7L Power Stroke', '6.7 Power Stroke Diesel', '6.7L Powerstroke', '6.7l power stroke diesel']
    for (const engine of inputs) {
      expect(
        resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-250', engine }),
      ).toBe(PSD_67)
    }
  })

  it('is case-insensitive on make', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBe(PSD_67)
  })

  it('is case-insensitive on model', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'f-250', engine: '6.7L PSD' }),
    ).toBe(PSD_67)
  })

  it('resolves 2014 F-250 6.7L to the 3rd-gen (2011-2016) platform, not 4th-gen', () => {
    const slug = resolvePlatformSlug({ year: 2014, make: 'Ford', model: 'F-250', engine: '6.7L PSD' })
    expect(slug).toBe('ford-super-duty-3rd-gen-67-psd')
    expect(slug).not.toBe(PSD_67)
  })

  it('normalizes messy model "F250 Super Duty" for a 2018 6.7L PSD (parity fix)', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F250 Super Duty', engine: '6.7L PSD' }),
    ).toBe(PSD_67)
  })

  it('returns null for 2023 F-250 (after 4th gen)', () => {
    expect(
      resolvePlatformSlug({ year: 2023, make: 'Ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBeNull()
  })

  it('returns null for 2018 F-150 (wrong model — no 6.7L PSD)', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-150', engine: '6.7L PSD' }),
    ).toBeNull()
  })

  it('returns null for 2018 F-350 6.2L gas (wrong engine)', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-350', engine: '6.2L V8 Gas' }),
    ).toBeNull()
  })

  it('returns null when engine is missing', () => {
    expect(
      resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-250', engine: '' }),
    ).toBeNull()
  })
})

describe('resolvePlatformSlug — 2011-2016 F-250/350 6.7L PSD (first-shop beachhead)', () => {
  const PSD_67_3RD = 'ford-super-duty-3rd-gen-67-psd'
  const PSD_67_4TH = 'ford-super-duty-4th-gen-67-psd'

  // Whole 2011-2016 window resolves to the 3rd-gen 6.7 platform.
  it.each([2011, 2012, 2013, 2014, 2015, 2016])(
    'resolves year %i F-250 6.7L PSD → 3rd-gen 6.7',
    (year) => {
      expect(
        resolvePlatformSlug({ year, make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke Diesel' }),
      ).toBe(PSD_67_3RD)
    },
  )

  it.each(['F-250', 'F-350', 'F-450', 'F-550'])(
    'resolves model %s on the 2014 6.7L PSD',
    (model) => {
      expect(
        resolvePlatformSlug({ year: 2014, make: 'Ford', model, engine: '6.7L Power Stroke' }),
      ).toBe(PSD_67_3RD)
    },
  )

  // Messy real-world model input now resolves on the 6.7 branch (parity with the 6.0 branch).
  it.each(['F250', 'f250', 'F-250 Super Duty', 'f-250 superduty', 'F250 Super Duty'])(
    'normalizes messy model "%s" for a 2014 6.7L PSD',
    (model) => {
      expect(
        resolvePlatformSlug({ year: 2014, make: 'Ford', model, engine: '6.7L PSD' }),
      ).toBe(PSD_67_3RD)
    },
  )

  // Boundaries: 2010 is before the 6.7 era; 2017 belongs to the 4th gen.
  it('returns null for 2010 F-250 6.7L (before the 6.7 era)', () => {
    expect(
      resolvePlatformSlug({ year: 2010, make: 'Ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBeNull()
  })

  it('resolves 2017 to the 4th-gen platform, not the 3rd-gen (upper boundary)', () => {
    expect(
      resolvePlatformSlug({ year: 2017, make: 'Ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBe(PSD_67_4TH)
  })

  // Engine / make guards still apply within the new window.
  it('returns null for 2014 F-250 6.4L (wrong engine)', () => {
    expect(
      resolvePlatformSlug({ year: 2014, make: 'Ford', model: 'F-250', engine: '6.4L Power Stroke' }),
    ).toBeNull()
  })

  it('returns null for 2014 Ram 2500 6.7L Cummins (wrong make)', () => {
    expect(
      resolvePlatformSlug({ year: 2014, make: 'Ram', model: '2500', engine: '6.7L Cummins' }),
    ).toBeNull()
  })
})
