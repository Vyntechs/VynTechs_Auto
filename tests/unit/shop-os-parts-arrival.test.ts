import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers,
  jobLines,
  profiles,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  advancePartArrival,
  getPartsArrivalForTicket,
} from '@/lib/shop-os/parts-arrival'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS parts arrival handoff', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  const ticketId = uuid(20)
  const jobId = uuid(30)
  const versionId = uuid(40)
  const padsId = uuid(50)
  const rotorId = uuid(51)
  const techId = uuid(1)
  const partsId = uuid(2)
  const advisorId = uuid(3)
  const ownerId = uuid(4)
  const otherOwnerId = uuid(5)
  const inactiveOwnerId = uuid(6)

  function snapshot() {
    const part = (input: {
      id: string
      description: string
      priceCents: number
      partNumber: string
      brand: string
    }) => ({
      ...input,
      kind: 'part' as const,
      quantity: '1',
      taxable: true,
      coreChargeCents: null,
      fitment: null,
      laborHours: null,
      laborRateCents: null,
      source: 'manual' as const,
      vendorContext: null,
    })
    return {
      schemaVersion: 1,
      ticket: {
        id: ticketId,
        number: 101,
        customerId: uuid(10),
        vehicleId: uuid(11),
        laborRateCents: 12_500,
        taxRateBps: 825,
      },
      jobs: [{
        id: jobId,
        title: 'Front brake service',
        kind: 'repair',
        customerStory: null,
        storyMeta: null,
        lines: [
          part({ id: padsId, description: 'Front brake pads', priceCents: 10_000, partNumber: 'PAD-1', brand: 'ACME' }),
          part({ id: rotorId, description: 'Front brake rotor', priceCents: 20_000, partNumber: 'ROT-1', brand: 'ACME' }),
        ],
        attachments: [],
        totals: { subtotalCents: 30_000, taxableSubtotalCents: 30_000 },
      }],
      totals: {
        subtotalCents: 30_000,
        taxableSubtotalCents: 30_000,
        taxCents: 2_475,
        totalCents: 32_475,
      },
    }
  }

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 12_500, taxRateBps: 825 },
      { name: 'South', laborRateCents: 14_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    await db.insert(profiles).values([
      { id: techId, userId: uuid(101), shopId, role: 'tech', fullName: 'Taylor Tech' },
      { id: partsId, userId: uuid(102), shopId, role: 'parts', fullName: 'Pat Parts' },
      { id: advisorId, userId: uuid(103), shopId, role: 'advisor', fullName: 'Alex Advisor' },
      { id: ownerId, userId: uuid(104), shopId, role: 'owner', fullName: 'Owen Owner' },
      { id: otherOwnerId, userId: uuid(105), shopId: otherShop.id, role: 'owner', fullName: 'Other Owner' },
      { id: inactiveOwnerId, userId: uuid(106), shopId, role: 'owner', fullName: 'Inactive Owner', deactivatedAt: new Date() },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5550102026' })
    await db.insert(vehicles).values({ id: uuid(11), customerId: uuid(10), year: 2018, make: 'Ford', model: 'F-250' })
    await db.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 101,
      source: 'counter',
      customerId: uuid(10),
      vehicleId: uuid(11),
      concern: 'Front brake vibration',
      createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Front brake service',
      kind: 'repair',
      requiredSkillTier: 2,
      assignedTechId: techId,
      workStatus: 'blocked',
      approvalState: 'quote_ready',
    })
    await db.insert(jobLines).values([
      {
        id: padsId, shopId, jobId, kind: 'part', description: 'Front brake pads',
        sort: 10, quantity: 1, priceCents: 10_000, partNumber: 'PAD-1', brand: 'ACME',
      },
      {
        id: rotorId, shopId, jobId, kind: 'part', description: 'Front brake rotor',
        sort: 20, quantity: 1, priceCents: 20_000, partNumber: 'ROT-1', brand: 'ACME',
      },
    ])
    await db.insert(quoteVersions).values({
      id: versionId,
      shopId,
      ticketId,
      versionNumber: 1,
      snapshot: snapshot(),
      createdByProfileId: advisorId,
    })
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.id, jobId))
  })

  afterEach(async () => close())

  it('projects exact approved part truth for ordering roles and the assigned technician without internal sourcing data', async () => {
    for (const profileId of [partsId, advisorId, ownerId, techId]) {
      const result = await getPartsArrivalForTicket(db, { actor: { profileId }, ticketId })
      expect(result).toMatchObject({
        ok: true,
        jobs: [{
          jobId,
          approvedQuoteVersionId: versionId,
          title: 'Front brake service',
          receivedCount: 0,
          totalCount: 2,
          allHere: false,
          readOnly: profileId === techId,
          lines: [
            { id: padsId, state: 'needs_order', nextAction: profileId === techId ? null : 'mark_ordered' },
            { id: rotorId, state: 'needs_order', nextAction: profileId === techId ? null : 'mark_ordered' },
          ],
        }],
      })
      expect(JSON.stringify(result)).not.toMatch(/unitCost|coreCharge|vendor|externalOffer|fitment|shopId|priceCents/)
    }
  })

  it('advances one exact line through ordered and received while preserving original receipts on replay', async () => {
    const ordered = await advancePartArrival(db, {
      actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_ordered' },
    })
    expect(ordered).toMatchObject({
      ok: true, changed: true,
      job: {
        receivedCount: 0, totalCount: 2, allHere: false,
        lines: expect.arrayContaining([expect.objectContaining({ id: padsId, state: 'ordered' })]),
      },
    })
    const [orderedRow] = await db.select().from(jobLines).where(eq(jobLines.id, padsId))
    expect(orderedRow).toMatchObject({ partStatus: 'ordered', orderedByProfileId: partsId })
    expect(orderedRow.orderedAt).toBeInstanceOf(Date)

    const replay = await advancePartArrival(db, {
      actor: { profileId: ownerId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_ordered' },
    })
    expect(replay).toMatchObject({ ok: true, changed: false })
    const [replayedRow] = await db.select().from(jobLines).where(eq(jobLines.id, padsId))
    expect(replayedRow.orderedByProfileId).toBe(partsId)
    expect(replayedRow.orderedAt).toEqual(orderedRow.orderedAt)

    const received = await advancePartArrival(db, {
      actor: { profileId: advisorId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_received' },
    })
    expect(received).toMatchObject({
      ok: true, changed: true,
      job: {
        receivedCount: 1, totalCount: 2, allHere: false,
        lines: expect.arrayContaining([expect.objectContaining({ id: padsId, state: 'received' })]),
      },
    })
    const [receivedRow] = await db.select().from(jobLines).where(eq(jobLines.id, padsId))
    expect(receivedRow).toMatchObject({
      partStatus: 'received', orderedByProfileId: partsId, receivedByProfileId: advisorId,
    })
    expect(receivedRow.receivedAt).toBeInstanceOf(Date)
  })

  it('reports all parts here only after every approved part is received and never releases the hold', async () => {
    for (const lineId of [padsId, rotorId]) {
      await advancePartArrival(db, { actor: { profileId: partsId }, ticketId, jobId, lineId, body: { action: 'mark_ordered' } })
      await advancePartArrival(db, { actor: { profileId: partsId }, ticketId, jobId, lineId, body: { action: 'mark_received' } })
    }
    const result = await getPartsArrivalForTicket(db, { actor: { profileId: techId }, ticketId })
    expect(result).toMatchObject({ ok: true, jobs: [{ receivedCount: 2, totalCount: 2, allHere: true }] })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    expect(job).toMatchObject({ workStatus: 'blocked', approvalState: 'approved', approvedQuoteVersionId: versionId })
    expect(ticket.status).toBe('open')
  })

  it('serializes concurrent attempts so one receipt wins and the other receives a truthful replay', async () => {
    const [first, competing] = await Promise.all([
      advancePartArrival(db, {
        actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
        body: { action: 'mark_ordered' },
      }),
      advancePartArrival(db, {
        actor: { profileId: ownerId }, ticketId, jobId, lineId: padsId,
        body: { action: 'mark_ordered' },
      }),
    ])
    expect([first, competing]).toEqual(expect.arrayContaining([
      expect.objectContaining({ ok: true, changed: true }),
      expect.objectContaining({ ok: true, changed: false }),
    ]))
    const [line] = await db.select().from(jobLines).where(eq(jobLines.id, padsId))
    expect(line.partStatus).toBe('ordered')
    expect([partsId, ownerId]).toContain(line.orderedByProfileId)
  })

  it('fails closed for unauthorized identities, invalid ordering, stale approved truth, and closed work', async () => {
    for (const profileId of [techId, otherOwnerId, inactiveOwnerId]) {
      await expect(advancePartArrival(db, {
        actor: { profileId }, ticketId, jobId, lineId: padsId,
        body: { action: 'mark_ordered' },
      })).resolves.toEqual({ ok: false, error: 'not_found' })
    }
    await expect(advancePartArrival(db, {
      actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_received' },
    })).resolves.toEqual({ ok: false, error: 'conflict' })

    await db.update(jobLines).set({ priceCents: 99 }).where(eq(jobLines.id, padsId))
    await expect(advancePartArrival(db, {
      actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_ordered' },
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    await db.update(jobLines).set({ priceCents: 10_000 }).where(eq(jobLines.id, padsId))
    await db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, jobId))
    await expect(advancePartArrival(db, {
      actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_ordered' },
    })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects malformed input and unsupported returned lines without changing state', async () => {
    await expect(advancePartArrival(db, {
      actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_ordered', surprise: true },
    })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await db.update(jobLines).set({ partStatus: 'returned' }).where(eq(jobLines.id, padsId))
    await expect(advancePartArrival(db, {
      actor: { profileId: partsId }, ticketId, jobId, lineId: padsId,
      body: { action: 'mark_ordered' },
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    const [line] = await db.select().from(jobLines).where(eq(jobLines.id, padsId))
    expect(line.partStatus).toBe('returned')
  })
})
