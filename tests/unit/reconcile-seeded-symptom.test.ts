import { describe, it, expect } from 'vitest'
import { pickSeededSymptom, tolerantFirstDtc } from '@/lib/diagnostics/reconcile-seeded-symptom'

// The live-seeded reachable set on ford-super-duty-4th-gen-67-psd (verified in DB
// ynmtszuybeenjbigxdyl: 3 symptoms, system='fuel', 25 non-retired components each).
const REACHABLE = [
  'p0087-fuel-rail-pressure-too-low',
  'p0088-fuel-rail-pressure-too-high',
  'no-start-cranks-normally-fuel-system-suspect',
]

const P0087 = 'p0087-fuel-rail-pressure-too-low'
const P0088 = 'p0088-fuel-rail-pressure-too-high'
const NOSTART = 'no-start-cranks-normally-fuel-system-suspect'

describe('tolerantFirstDtc — separator-tolerant first-code scan', () => {
  it('extracts a plain code', () => {
    expect(tolerantFirstDtc('low rail pressure p0087 in the pcm')).toBe('p0087')
  })
  it('is case-insensitive and normalizes to lowercase', () => {
    expect(tolerantFirstDtc('sets a P0087')).toBe('p0087')
  })
  it('tolerates a space inside the code (P 0087)', () => {
    expect(tolerantFirstDtc('code P 0087 set')).toBe('p0087')
  })
  it('tolerates a hyphen inside the code (P-0087)', () => {
    expect(tolerantFirstDtc('sets a P-0087')).toBe('p0087')
  })
  it('returns the FIRST code when several are present', () => {
    expect(tolerantFirstDtc('p0299 underboost, also p0088 once')).toBe('p0299')
  })
  it('does NOT match a code glued to surrounding letters', () => {
    expect(tolerantFirstDtc('replaced thep0087sensor')).toBeNull()
  })
  it('returns null when no code present', () => {
    expect(tolerantFirstDtc('cranks but will not start')).toBeNull()
  })
})

describe('pickSeededSymptom — reachability-gated reconciliation', () => {
  // ---- Step 1: exact chip pass-through -----------------------------------
  it('returns a chip-selected slug that is already seeded (exact match)', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: P0087, complaintText: '' })).toBe(P0087)
  })

  // ---- Step 2: first DTC, prefix-matched to the descriptive seeded slug ---
  it("BRANDON'S EXACT CASE: crank-no-start prose carrying P0087 → the P0087 rail-pressure graph (entered code wins)", () => {
    expect(
      pickSeededSymptom(REACHABLE, {
        candidateSlug: 'p0087', // what resolveSymptomSlug emits today (bare code)
        complaintText:
          'customer states, crank no start this morning. using a hand help pocket scanner the customer noted p0087 low rail pressure in the pcm.',
      }),
    ).toBe(P0087)
  })
  it('maps a bare P0088 complaint to the descriptive seeded slug', () => {
    expect(
      pickSeededSymptom(REACHABLE, { candidateSlug: 'p0088', complaintText: 'P0088 rail pressure too high, runs rough' }),
    ).toBe(P0088)
  })
  it('maps a separator-split code (P 0087) that the resolver missed', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText: 'code P 0087 set' })).toBe(P0087)
  })
  it('normalizes uppercase codes', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: 'p0087', complaintText: 'P0087 active' })).toBe(P0087)
  })

  // ---- Step 3a: crank/no-start prose → seeded no-start slug ---------------
  it('maps a no-DTC crank/no-start complaint to the seeded no-start slug', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: 'cranks-no-start', complaintText: 'cranks but wont start' })).toBe(
      NOSTART,
    )
  })
  it.each([
    'cranks normally, will not start',
    'turns over but won’t start',
    'cranks fine just wont start',
    'cranks, no fire',
    'engine cranks but does not start',
  ])('covers crank prose the resolver patterns miss: "%s"', (complaintText) => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText })).toBe(NOSTART)
  })

  // ---- Step 3b: fuel-rail-pressure prose (must say "rail") ----------------
  it('maps "fuel rail pressure too low" prose (no DTC, no crank) to P0087', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText: 'fuel rail pressure too low under load' })).toBe(
      P0087,
    )
  })
  it('maps "rail pressure high" prose to P0088', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText: 'rail pressure reads high at idle' })).toBe(P0088)
  })

  // ---- MISROUTE / MUST-FALL-TO-AI GUARDS ---------------------------------
  it('does NOT promote a secondary seeded code over an unseeded FIRST code (no multi-scan)', () => {
    // First code p0299 is not seeded; p0088 appears later. Must NOT route to p0088.
    expect(
      pickSeededSymptom(REACHABLE, {
        candidateSlug: 'p0299',
        complaintText: 'low boost, p0299 underboost. also p0088 showed up once',
      }),
    ).toBeNull()
  })
  it('falls to AI for an unseeded DTC (P2002)', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: 'p2002', complaintText: 'P2002 dpf efficiency below threshold' })).toBeNull()
  })
  it('falls to AI for the DEF/emissions symptom (not seeded as a topology row)', () => {
    expect(
      pickSeededSymptom(REACHABLE, {
        candidateSlug: 'reduced-power-limp-mode-emissions-suspect',
        complaintText: 'limp mode, DEF light on',
      }),
    ).toBeNull()
  })
  it('falls to AI for a bare check-engine complaint', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText: 'check engine light came on' })).toBeNull()
  })
  it('falls to AI for vague "low fuel pressure" with no "rail" and no code', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText: 'seems like low fuel pressure' })).toBeNull()
  })
  it('falls to AI when a code is glued into a word', () => {
    expect(pickSeededSymptom(REACHABLE, { candidateSlug: null, complaintText: 'replaced thep0087sensor last week' })).toBeNull()
  })
  it('falls to AI when nothing is reachable on the platform (e.g. unseeded 3rd-gen)', () => {
    expect(pickSeededSymptom([], { candidateSlug: 'p0087', complaintText: '2014 truck, p0087 low rail pressure' })).toBeNull()
  })
})
