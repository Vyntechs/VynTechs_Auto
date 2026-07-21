import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { profiles, shops, ticketActivity, ticketJobs, tickets } from '@/lib/db/schema'
import {
  mutateJobInterruption,
  mutateTicketLifecycle,
  type InterruptionActor,
} from '@/lib/shop-os/interruption'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('ShopOS job interruption', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  const techId = uuid(1)
  const advisorId = uuid(2)
  const reliefTechId = uuid(3)
  const ticketId = uuid(20)
  const jobId = uuid(30)
  let tech: InterruptionActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'Interruption Shop' }).returning()
    shopId = shop.id
    await db.insert(profiles).values([
      { id: techId, userId: uuid(101), shopId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
      { id: advisorId, userId: uuid(102), shopId, fullName: 'Alex Advisor', role: 'advisor', skillTier: 3 },
      { id: reliefTechId, userId: uuid(103), shopId, fullName: 'Riley Relief', role: 'tech', skillTier: 2 },
    ])
    await db.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'tech_quick',
      concern: 'Brake squeal',
      createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Replace front brake pads',
      kind: 'repair',
      requiredSkillTier: 2,
      assignedTechId: techId,
      approvalState: 'approved',
      workStatus: 'in_progress',
      workStartedAt: new Date('2026-07-21T15:00:00.000Z'),
      clockedOnSince: new Date('2026-07-21T15:10:00.000Z'),
      activeSeconds: 20,
    })
    tech = {
      profileId: techId,
      shopId,
      role: 'tech',
      membershipStatus: 'active',
      deactivatedAt: null,
    }
  })

  afterEach(async () => close())

  it('lets the assigned technician put in-progress work on a parts hold and bank time', async () => {
    await db.update(ticketJobs)
      .set({ clockedOnSince: sql`clock_timestamp() - interval '90 seconds'` })
      .where(eq(ticketJobs.id, jobId))

    const result = await mutateJobInterruption(db, {
      actor: tech,
      ticketId,
      jobId,
      body: {
        action: 'block',
        requestKey: uuid(40),
        holdKind: 'parts',
        holdNote: 'Awaiting the front pad set before continuing.',
      },
    })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const events = await db.select().from(ticketActivity)

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      job: {
        workStatus: 'blocked',
        holdKind: 'parts',
        holdNote: 'Awaiting the front pad set before continuing.',
        holdResumeStatus: 'in_progress',
        clockedOnSince: null,
      },
    })
    expect(job).toMatchObject({
      workStatus: 'blocked',
      holdKind: 'parts',
      holdNote: 'Awaiting the front pad set before continuing.',
      holdResumeStatus: 'in_progress',
      heldByProfileId: techId,
      clockedOnSince: null,
    })
    expect(job.activeSeconds).toBeGreaterThanOrEqual(109)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'job_blocked',
      ticketId,
      jobId,
      actorProfileId: techId,
      requestKey: uuid(40),
      payload: {
        from: 'in_progress',
        to: 'blocked',
        holdKind: 'parts',
        holdNote: 'Awaiting the front pad set before continuing.',
        resumeStatus: 'in_progress',
      },
    })
  })

  it('restores the saved work state when the assigned technician resolves a hold', async () => {
    await db.update(ticketJobs).set({
      workStatus: 'blocked',
      holdKind: 'parts',
      holdNote: 'Pads arrived.',
      holdResumeStatus: 'in_progress',
      heldAt: new Date('2026-07-21T16:00:00.000Z'),
      heldByProfileId: techId,
      clockedOnSince: null,
      activeSeconds: 120,
    }).where(eq(ticketJobs.id, jobId))

    const result = await mutateJobInterruption(db, {
      actor: tech,
      ticketId,
      jobId,
      body: { action: 'resolve_hold', requestKey: uuid(41) },
    })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const events = await db.select().from(ticketActivity)

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      job: {
        workStatus: 'in_progress',
        holdKind: null,
        holdNote: null,
        holdResumeStatus: null,
        clockedOnSince: null,
        activeSeconds: 120,
      },
    })
    expect(job).toMatchObject({
      workStatus: 'in_progress',
      holdKind: null,
      holdNote: null,
      holdResumeStatus: null,
      heldAt: null,
      heldByProfileId: null,
      clockedOnSince: null,
      activeSeconds: 120,
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'job_hold_resolved',
      ticketId,
      jobId,
      actorProfileId: techId,
      requestKey: uuid(41),
      payload: { from: 'blocked', to: 'in_progress', holdKind: 'parts' },
    })
  })

  it('lets an advisor hand off active work without discarding progress', async () => {
    await db.update(ticketJobs)
      .set({ clockedOnSince: sql`clock_timestamp() - interval '90 seconds'` })
      .where(eq(ticketJobs.id, jobId))
    const advisor: InterruptionActor = {
      profileId: advisorId,
      shopId,
      role: 'advisor',
      membershipStatus: 'active',
      deactivatedAt: null,
    }

    const result = await mutateJobInterruption(db, {
      actor: advisor,
      ticketId,
      jobId,
      body: { action: 'handoff', requestKey: uuid(42), assignedTechId: reliefTechId },
    })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const events = await db.select().from(ticketActivity)

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      job: {
        workStatus: 'in_progress',
        assignedTechId: reliefTechId,
        clockedOnSince: null,
      },
    })
    expect(job).toMatchObject({
      assignedTechId: reliefTechId,
      workStatus: 'in_progress',
      clockedOnSince: null,
      claimedAt: null,
    })
    expect(job.activeSeconds).toBeGreaterThanOrEqual(109)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'job_handed_off',
      ticketId,
      jobId,
      actorProfileId: advisorId,
      requestKey: uuid(42),
      payload: {
        fromAssignedTechId: techId,
        toAssignedTechId: reliefTechId,
        workStatus: 'in_progress',
      },
    })
  })

  it('lets an advisor cancel an unpaid repair order while preserving interrupted-work recovery truth', async () => {
    await db.update(ticketJobs)
      .set({ clockedOnSince: sql`clock_timestamp() - interval '90 seconds'` })
      .where(eq(ticketJobs.id, jobId))
    const advisor: InterruptionActor = {
      profileId: advisorId,
      shopId,
      role: 'advisor',
      membershipStatus: 'active',
      deactivatedAt: null,
    }

    const result = await mutateTicketLifecycle(db, {
      actor: advisor,
      ticketId,
      body: {
        action: 'cancel',
        requestKey: uuid(43),
        reason: 'Customer rescheduled before the repair could continue.',
      },
    })
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const events = await db.select().from(ticketActivity)

    expect(result).toMatchObject({ ok: true, changed: true, ticket: { status: 'canceled' } })
    expect(ticket).toMatchObject({
      status: 'canceled',
      canceledByProfileId: advisorId,
      canceledReason: 'Customer rescheduled before the repair could continue.',
    })
    expect(job).toMatchObject({ workStatus: 'canceled', clockedOnSince: null })
    expect(job.activeSeconds).toBeGreaterThanOrEqual(109)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'ticket_canceled',
      ticketId,
      actorProfileId: advisorId,
      requestKey: uuid(43),
      payload: {
        reason: 'Customer rescheduled before the repair could continue.',
        interruptedJobs: [expect.objectContaining({
          id: jobId,
          workStatus: 'in_progress',
          assignedTechId: techId,
        })],
      },
    })
  })

  it('restores the canceled interrupted job when an advisor reopens the repair order', async () => {
    const advisor: InterruptionActor = {
      profileId: advisorId,
      shopId,
      role: 'advisor',
      membershipStatus: 'active',
      deactivatedAt: null,
    }
    const canceled = await mutateTicketLifecycle(db, {
      actor: advisor,
      ticketId,
      body: { action: 'cancel', requestKey: uuid(44), reason: 'Customer rescheduled.' },
    })
    expect(canceled).toMatchObject({ ok: true, ticket: { status: 'canceled' } })

    const reopened = await mutateTicketLifecycle(db, {
      actor: advisor,
      ticketId,
      body: { action: 'reopen', requestKey: uuid(45) },
    })
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const events = await db.select().from(ticketActivity)

    expect(reopened).toMatchObject({ ok: true, changed: true, ticket: { status: 'open' } })
    expect(ticket).toMatchObject({
      status: 'open',
      canceledAt: null,
      canceledByProfileId: null,
      canceledReason: null,
    })
    expect(job).toMatchObject({
      workStatus: 'in_progress',
      assignedTechId: techId,
      clockedOnSince: null,
      activeSeconds: expect.any(Number),
    })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      kind: 'ticket_reopened',
      ticketId,
      actorProfileId: advisorId,
      requestKey: uuid(45),
      payload: { restoredJobIds: [jobId] },
    })
  })
})
