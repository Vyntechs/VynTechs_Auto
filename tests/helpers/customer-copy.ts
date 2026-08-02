import type { CustomerCopyProjection } from '@/lib/shop-os/customer-copy'

export const customerCopyFixture: CustomerCopyProjection = {
  documentKind: 'invoice',
  readyToPrint: true,
  blockers: [],
  shop: {
    name: 'Honest Auto',
    phone: '(214) 555-0197',
    address: ['415 Industrial Way', 'Suite 2', 'Garland, TX 75040'],
  },
  ticketNumber: 1042,
  customer: { name: 'Ada Driver' },
  vehicle: {
    year: 2020,
    make: 'Ford',
    model: 'F-150',
    vin: '1FTFW1E50LFA00001',
    odometer: 91_240,
  },
  jobs: [{
    title: 'Front brake service',
    kind: 'repair',
    lines: [
      {
        kind: 'part', description: 'Brake pad set', quantity: '2', priceCents: 10_000,
        taxable: true, partNumber: 'PAD-42', brand: 'Northstar',
      },
      {
        kind: 'labor', description: 'Install front pads', hours: '1.25', priceCents: 18_750,
        taxable: false, laborRateCents: 15_000,
      },
    ],
  }],
  decisions: [
    { jobTitle: 'Front brake service', decision: 'approved', method: 'phone', recordedAt: '2026-08-01T13:00:00.000Z' },
    { jobTitle: 'Brake fluid service', decision: 'declined', method: null, recordedAt: '2026-08-01T13:05:00.000Z' },
  ],
  totals: {
    subtotalCents: 28_750,
    taxCents: 800,
    totalCents: 29_550,
    payments: [{ amountCents: 5_000, method: 'card', recordedAt: '2026-08-01T14:00:00.000Z' }],
    paidCents: 5_000,
    balanceCents: 24_550,
  },
  closedAt: null,
}
