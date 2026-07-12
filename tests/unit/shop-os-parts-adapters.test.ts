import { describe, expect, it, vi } from 'vitest'
import { ManualPartsAdapter, parseManualOfferSnapshot } from '@/lib/shop-os/parts-adapters'

const PROFILE_ID = '00000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-07-12T04:10:00.000Z')

const capture = () => ({
  description: '  Front pad set  ',
  partNumber: ' PAD-1 ',
  brand: ' ACME ',
  quantity: '2.500',
  unitCostCents: 7_000,
  coreChargeCents: 500,
  availability: 'in_stock' as const,
  fitment: ' Front axle ',
  fulfillment: { method: 'pickup' as const, locationLabel: ' Main counter ' },
  externalOfferId: ' estimate-42 ',
  verifyingProfileId: PROFILE_ID,
})

describe('manual parts adapter', () => {
  it('parses only canonical bounded persisted snapshots', () => {
    const snapshot = {
      schemaVersion: 1, kind: 'manual_offer', vendorAccountId: PROFILE_ID,
      vendorDisplayName: 'Main supplier', externalOfferId: null, currency: 'USD',
      quantity: '2.5', unitCostCents: 7_000, coreChargeCents: 500,
      availability: 'in_stock', fitment: 'Front axle',
      fulfillment: { method: 'pickup', locationLabel: 'Main counter' },
      fetchedAt: NOW.toISOString(), verifiedByProfileId: PROFILE_ID,
      requestFingerprint: 'a'.repeat(64),
    }
    expect(parseManualOfferSnapshot(snapshot)).toEqual(snapshot)
    expect(parseManualOfferSnapshot({ ...snapshot, quantity: '2.500' })).toBeNull()
    expect(parseManualOfferSnapshot({ ...snapshot, credential: 'secret' })).toBeNull()
    expect(parseManualOfferSnapshot({ ...snapshot, vendorDisplayName: 'x'.repeat(5_000) })).toBeNull()
    const { externalOfferId: _external, ...missingExternal } = snapshot
    expect(parseManualOfferSnapshot(missingExternal)).toBeNull()
    const { fitment: _fitment, ...missingFitment } = snapshot
    expect(parseManualOfferSnapshot(missingFitment)).toBeNull()
    const { locationLabel: _omitted, ...missingLocation } = snapshot.fulfillment
    expect(parseManualOfferSnapshot({ ...snapshot, fulfillment: missingLocation })).toBeNull()
  })

  it('returns manual-entry-required without network or order methods', async () => {
    const adapter = new ManualPartsAdapter({ now: () => NOW })

    await expect(adapter.searchParts({ query: 'front brake pads', quantity: '2' }))
      .resolves.toEqual({ kind: 'manual_entry_required' })
    expect('placeOrder' in adapter).toBe(false)
    expect('submitOrder' in adapter).toBe(false)
  })

  it('normalizes a human-verified offer and owns verification time', async () => {
    const now = vi.fn(() => NOW)
    const adapter = new ManualPartsAdapter({ now })

    await expect(adapter.refreshOffer(capture())).resolves.toEqual({
      kind: 'available',
      offer: {
        description: 'Front pad set',
        partNumber: 'PAD-1',
        brand: 'ACME',
        quantity: '2.5',
        unitCostCents: 7_000,
        coreChargeCents: 500,
        availability: 'in_stock',
        fitment: 'Front axle',
        fulfillment: { method: 'pickup', locationLabel: 'Main counter' },
        externalOfferId: 'estimate-42',
        currency: 'USD',
        fetchedAt: NOW.toISOString(),
        verifiedByProfileId: PROFILE_ID,
      },
    })
    expect(now).toHaveBeenCalledOnce()
  })

  it('returns typed unavailable truth without constructing an offer', async () => {
    const adapter = new ManualPartsAdapter({ now: () => NOW })

    await expect(adapter.refreshOffer({ ...capture(), availability: 'unavailable' }))
      .resolves.toEqual({ kind: 'unavailable' })
  })

  it.each([
    { ...capture(), token: 'secret' },
    { ...capture(), secretRef: 'env:PARTS_KEY' },
    { ...capture(), rawPayload: { cost: 1 } },
    { ...capture(), quantity: '0' },
    { ...capture(), quantity: '1.0001' },
    { ...capture(), unitCostCents: -1 },
    { ...capture(), verifyingProfileId: 'not-a-uuid' },
    { ...capture(), fulfillment: { method: 'pickup', locationLabel: 'x', cookie: 'secret' } },
  ])('rejects unknown, credential-like, and invalid refresh input %#', async (input) => {
    const adapter = new ManualPartsAdapter({ now: () => NOW })
    await expect(adapter.refreshOffer(input as never)).rejects.toThrow('invalid_manual_offer')
  })

  it.each([
    { query: '', quantity: '1' },
    { query: 'pads', quantity: '0' },
    { query: 'pads', quantity: '1', authorization: 'Bearer secret' },
  ])('rejects invalid and unknown search input %#', async (input) => {
    const adapter = new ManualPartsAdapter({ now: () => NOW })
    await expect(adapter.searchParts(input)).rejects.toThrow('invalid_parts_search')
  })
})
