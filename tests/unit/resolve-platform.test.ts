import { describe, expect, it } from 'vitest'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'

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

  it('resolves the bare "6.7" engine a tech actually types (no "power stroke" wording)', () => {
    for (const engine of ['6.7', '6.7L', '6.7l', ' 6.7 ', '6.7 diesel']) {
      expect(
        resolvePlatformSlug({ year: 2018, make: 'Ford', model: 'F-350', engine }),
      ).toBe(PSD_67)
    }
  })

  it('resolves the model with or without a hyphen or space', () => {
    for (const model of ['F-350', 'F350', 'f350', 'f 350', 'F-250']) {
      expect(
        resolvePlatformSlug({ year: 2018, make: 'Ford', model, engine: '6.7' }),
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

  it('returns null for 2014 F-250 (before 4th gen)', () => {
    expect(
      resolvePlatformSlug({ year: 2014, make: 'Ford', model: 'F-250', engine: '6.7L PSD' }),
    ).toBeNull()
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
