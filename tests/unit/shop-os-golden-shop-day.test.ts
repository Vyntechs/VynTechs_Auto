import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { jobPartRequests, quoteEvents, ticketActivity, ticketPayments } from '@/lib/db/schema'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { projectLivingTicketCommands } from '@/lib/shop-os/living-ticket'
import { createPartRequest, resolvePartRequest } from '@/lib/shop-os/part-requests'
import { createDraftLine, createQuoteVersion, recordQuoteDecision } from '@/lib/shop-os/quotes'
import { closeTicket, getTicketRingOut, recordTicketPayment } from '@/lib/shop-os/ring-out'
import { getSimpleWorkWorkspace, mutateSimpleWork } from '@/lib/shop-os/simple-work'
import { mutateJobInterruption } from '@/lib/shop-os/interruption'
import { addTicketJob, getTicketDetail, listTodayTicketJobs, mutateTicketJobAssignment } from '@/lib/tickets'
import { createGoldenShopDay, GOLDEN_KEYS } from '@/tests/helpers/golden-shop-day'

function commandKinds(
  actor: Awaited<ReturnType<typeof createGoldenShopDay>>['actors']['owner'],
  ticket: Extract<Awaited<ReturnType<typeof getTicketDetail>>, { ok: true }>['ticket'],
  ringOut: { balanceCents: number; canClose: boolean } | null = null,
) {
  const projected = projectLivingTicketCommands({
    role: actor.role,
    profileId: actor.profileId,
    skillTier: actor.skillTier,
    ticketStatus: ticket.status,
    jobs: ticket.jobs,
    ringOut,
    diagnosticsEntitled: false,
  })
  return [projected.primary, ...projected.secondary]
    .filter((command): command is NonNullable<typeof command> => command !== null)
    .map((command) => command.kind)
}

describe('Golden Shop Day release gate', () => {
  it('keeps a partial customer answer mounted until a deferred job gets its durable final decision', async () => {
    const golden = await createGoldenShopDay()
    try {
      const created = await createCounterTicket(golden.db, {
        actor: golden.actors.advisor,
        body: {
          vehicleMode: 'new', customer: golden.customer, vehicle: golden.vehicle,
          concern: 'Customer wants us to address braking and a separate maintenance item.',
          whenStarted: 'This week', howOften: 'Every drive',
          work: { mode: 'manual', kind: 'repair', description: 'Inspect and repair braking concern' },
          assignedTechId: golden.people.tech.id,
        },
      })
      expect(created).toMatchObject({ ok: true })
      if (!created.ok) throw new Error('counter intake failed')
      const firstJob = created.ticket.jobs[0]
      const added = await addTicketJob(golden.db, {
        actor: golden.actors.advisor,
        ticketId: created.ticket.id,
        body: {
          title: 'Replace cabin air filter', kind: 'maintenance', requiredSkillTier: 1,
          assignedTechId: null,
        },
      })
      expect(added).toMatchObject({ ok: true })
      if (!added.ok) throw new Error('second job failed')
      const secondJob = added.ticket.jobs.find((job) => job.id !== firstJob.id)
      if (!secondJob) throw new Error('second job missing')
      for (const [job, key, description] of [
        [firstJob, GOLDEN_KEYS.line, 'Brake repair labor'],
        [secondJob, GOLDEN_KEYS.secondLine, 'Cabin filter labor'],
      ] as const) {
        expect(await createDraftLine(golden.db, {
          actor: { profileId: golden.people.advisor.id }, ticketId: created.ticket.id, jobId: job.id, clientKey: key,
          body: { kind: 'labor', description, taxable: false, laborHours: '1' },
        })).toMatchObject({ ok: true, changed: true })
      }
      const version = await createQuoteVersion(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: created.ticket.id,
      })
      expect(version).toMatchObject({ ok: true, changed: true })
      if (!version.ok) throw new Error('quote version failed')

      expect(await recordQuoteDecision(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: created.ticket.id,
        body: {
          requestKey: GOLDEN_KEYS.approval, jobId: firstJob.id, quoteVersionId: version.version.id,
          decision: 'approved', approvedVia: 'phone',
        },
      })).toMatchObject({ ok: true, projection: { approvalState: 'approved' } })
      expect(await recordQuoteDecision(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: created.ticket.id,
        body: {
          requestKey: GOLDEN_KEYS.deferred, jobId: secondJob.id, quoteVersionId: version.version.id,
          decision: 'deferred', reason: 'Customer will decide after their next paycheck.',
        },
      })).toMatchObject({ ok: true, projection: { approvalState: 'deferred', approvedQuoteVersionId: null } })

      const partial = await getTicketDetail(golden.db, { actor: golden.actors.advisor, ticketId: created.ticket.id })
      expect(partial).toMatchObject({ ok: true, ticket: { jobs: expect.arrayContaining([
        expect.objectContaining({ id: firstJob.id, approvalState: 'approved' }),
        expect.objectContaining({ id: secondJob.id, approvalState: 'deferred' }),
      ]) } })
      if (!partial.ok) throw new Error('partial ticket unavailable')
      expect(commandKinds(golden.actors.advisor, partial.ticket)).toContain('quote')

      expect(await recordQuoteDecision(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: created.ticket.id,
        body: {
          requestKey: GOLDEN_KEYS.deferredApproval, jobId: secondJob.id, quoteVersionId: version.version.id,
          decision: 'approved', approvedVia: 'in_person',
        },
      })).toMatchObject({ ok: true, projection: { approvalState: 'approved', approvedQuoteVersionId: version.version.id } })
      const decisions = await golden.db.select().from(quoteEvents)
      expect(decisions.map((event) => event.kind)).toEqual(['approved', 'deferred', 'approved'])
    } finally {
      await golden.close()
    }
  })

  it.each([1, 2])('moves one synthetic repair order through every role without losing truth (run %s)', async () => {
    const golden = await createGoldenShopDay()
    try {
      const created = await createCounterTicket(golden.db, {
        actor: golden.actors.advisor,
        body: {
          vehicleMode: 'new',
          customer: golden.customer,
          vehicle: golden.vehicle,
          concern: 'Charging warning appears at idle.',
          whenStarted: 'This morning',
          howOften: 'Intermittent',
          work: { mode: 'manual', kind: 'repair', description: 'Inspect charging system concern' },
          assignedTechId: null,
        },
      })
      expect(created.ok).toBe(true)
      if (!created.ok) throw new Error('counter intake failed')
      const { id: ticketId } = created.ticket
      const [job] = created.ticket.jobs
      expect(created.ticket.ticketNumber).toBe(1)

      const [ownerIntake, advisorIntake, partsIntake] = await Promise.all([
        listTodayTicketJobs(golden.db, { actor: golden.actors.owner }),
        listTodayTicketJobs(golden.db, { actor: golden.actors.advisor }),
        listTodayTicketJobs(golden.db, { actor: golden.actors.parts }),
      ])
      expect(ownerIntake.openJobs.map((item) => item.id)).toEqual([job.id])
      expect(advisorIntake.openJobs.map((item) => item.id)).toEqual([job.id])
      expect(partsIntake.myJobs).toEqual([])

      const assigned = await mutateTicketJobAssignment(golden.db, {
        actor: golden.actors.advisor,
        ticketId,
        jobId: job.id,
        body: {
          action: 'reassign',
          requestKey: '00000000-0000-4000-8000-000000000401',
          assignedTechId: golden.people.tech.id,
        },
      })
      expect(assigned).toMatchObject({ ok: true })

      const [techQueue, ownerAssigned, advisorAssigned] = await Promise.all([
        listTodayTicketJobs(golden.db, { actor: golden.actors.tech }),
        listTodayTicketJobs(golden.db, { actor: golden.actors.owner }),
        listTodayTicketJobs(golden.db, { actor: golden.actors.advisor }),
      ])
      expect(techQueue.myJobs.map((item) => item.id)).toEqual([job.id])
      expect(ownerAssigned.teamJobs.map((item) => item.id)).toEqual([job.id])
      expect(advisorAssigned.teamJobs.map((item) => item.id)).toEqual([job.id])
      expect(techQueue.myJobs[0]?.approvalState).toBe('pending_quote')
      const assignedTicket = await getTicketDetail(golden.db, {
        actor: golden.actors.tech,
        ticketId,
      })
      expect(assignedTicket.ok).toBe(true)
      if (!assignedTicket.ok) throw new Error('assigned ticket unavailable')
      expect(commandKinds(golden.actors.tech, assignedTicket.ticket)).not.toContain('work')
      expect(await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.tech.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: { action: 'clock_on' },
      })).toEqual({ ok: false, error: 'not_authorized' })

      const line = await createDraftLine(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId,
        jobId: job.id,
        clientKey: GOLDEN_KEYS.line,
        body: {
          kind: 'labor',
          description: 'Replace alternator and verify charging system',
          taxable: false,
          laborHours: '1.5',
        },
      })
      expect(line).toMatchObject({ ok: true, changed: true })

      const version = await createQuoteVersion(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId,
      })
      expect(version).toMatchObject({ ok: true, changed: true })
      if (!version.ok) throw new Error('quote version failed')

      expect(await recordQuoteDecision(golden.db, {
        actor: { profileId: golden.people.parts.id },
        ticketId,
        body: {
          requestKey: GOLDEN_KEYS.approval,
          jobId: job.id,
          quoteVersionId: version.version.id,
          decision: 'approved',
          approvedVia: 'in_person',
        },
      })).toEqual({ ok: false, error: 'not_found' })

      const approved = await recordQuoteDecision(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId,
        body: {
          requestKey: GOLDEN_KEYS.approval,
          jobId: job.id,
          quoteVersionId: version.version.id,
          decision: 'approved',
          approvedVia: 'in_person',
        },
      })
      expect(approved).toMatchObject({
        ok: true,
        projection: { approvalState: 'approved', approvedQuoteVersionId: version.version.id },
      })

      const approvedTicket = await getTicketDetail(golden.db, {
        actor: golden.actors.tech,
        ticketId,
      })
      expect(approvedTicket.ok).toBe(true)
      if (!approvedTicket.ok) throw new Error('approved ticket unavailable')
      expect(commandKinds(golden.actors.tech, approvedTicket.ticket)).toContain('work')
      expect(commandKinds(golden.actors.parts, approvedTicket.ticket)).not.toContain('work')
      expect(await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.parts.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: { action: 'clock_on' },
      })).toEqual({ ok: false, error: 'not_found' })
      expect(await getTicketRingOut(golden.db, {
        actor: golden.actors.tech,
        ticketId,
      })).toEqual({ ok: false, error: 'forbidden' })
      expect(await closeTicket(golden.db, {
        actor: golden.actors.tech,
        ticketId,
      })).toEqual({ ok: false, error: 'forbidden' })
      expect(await closeTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId,
      })).toEqual({ ok: false, error: 'unfinished_work' })

      const started = await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.tech.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: { action: 'clock_on' },
      })
      expect(started).toMatchObject({ ok: true, changed: true, work: { status: 'in_progress' } })
      if (!started.ok) throw new Error('work start failed')

      const requested = await createPartRequest(golden.db, {
        actor: { profileId: golden.people.tech.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: {
          requestKey: GOLDEN_KEYS.part,
          description: 'Alternator',
          preference: 'OE-equivalent, available today',
          quantity: 1,
        },
      })
      expect(requested).toMatchObject({ ok: true, request: { status: 'requested' } })
      if (!requested.ok) throw new Error('part request failed')
      const requestReplay = await createPartRequest(golden.db, {
        actor: { profileId: golden.people.tech.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: {
          requestKey: GOLDEN_KEYS.part,
          description: 'Alternator',
          preference: 'OE-equivalent, available today',
          quantity: 1,
        },
      })
      expect(requestReplay).toMatchObject({ ok: true, request: { id: requested.request.id } })
      expect(await golden.db.select().from(jobPartRequests)
        .where(eq(jobPartRequests.ticketId, ticketId))).toHaveLength(1)

      const paused = await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.tech.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: { action: 'clock_off' },
      })
      expect(paused).toMatchObject({ ok: true, work: { status: 'in_progress', clockedOnSince: null } })

      const held = await mutateJobInterruption(golden.db, {
        actor: {
          profileId: golden.people.tech.id, shopId: golden.shop.id, role: 'tech',
          membershipStatus: 'active', deactivatedAt: null,
        },
        ticketId,
        jobId: job.id,
        body: {
          action: 'block', requestKey: GOLDEN_KEYS.hold, holdKind: 'parts',
          holdNote: 'Parts request is with the parts desk.',
        },
      })
      expect(held).toMatchObject({ ok: true, job: { workStatus: 'blocked', holdKind: 'parts' } })
      const handedOff = await mutateJobInterruption(golden.db, {
        actor: {
          profileId: golden.people.advisor.id, shopId: golden.shop.id, role: 'advisor',
          membershipStatus: 'active', deactivatedAt: null,
        },
        ticketId,
        jobId: job.id,
        body: { action: 'handoff', requestKey: GOLDEN_KEYS.handoff, assignedTechId: golden.people.relief.id },
      })
      expect(handedOff).toMatchObject({ ok: true, job: { assignedTechId: golden.people.relief.id, workStatus: 'blocked' } })
      const reliefHeldTicket = await getTicketDetail(golden.db, { actor: golden.actors.relief, ticketId })
      expect(reliefHeldTicket).toMatchObject({ ok: true, ticket: { jobs: [expect.objectContaining({ workStatus: 'blocked' })] } })
      if (!reliefHeldTicket.ok) throw new Error('relief ticket unavailable')
      expect(commandKinds(golden.actors.relief, reliefHeldTicket.ticket)[0]).toBe('resolve_hold')
      expect(commandKinds(golden.actors.tech, reliefHeldTicket.ticket)).not.toContain('resolve_hold')
      const resolved = await mutateJobInterruption(golden.db, {
        actor: {
          profileId: golden.people.relief.id, shopId: golden.shop.id, role: 'tech',
          membershipStatus: 'active', deactivatedAt: null,
        },
        ticketId,
        jobId: job.id,
        body: { action: 'resolve_hold', requestKey: GOLDEN_KEYS.resolveHold },
      })
      expect(resolved).toMatchObject({ ok: true, job: { workStatus: 'in_progress', assignedTechId: golden.people.relief.id } })
      const resumed = await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.relief.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: { action: 'clock_on' },
      })
      expect(resumed).toMatchObject({ ok: true, work: { status: 'in_progress', clockedOnSince: expect.any(String) } })
      expect(await golden.db.select().from(ticketActivity).where(eq(ticketActivity.ticketId, ticketId)))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'work_paused' }),
          expect.objectContaining({ kind: 'job_blocked' }),
          expect.objectContaining({ kind: 'job_handed_off' }),
          expect.objectContaining({ kind: 'job_hold_resolved' }),
          expect.objectContaining({ kind: 'work_resumed' }),
        ]))

      const partsQueue = await listTodayTicketJobs(golden.db, { actor: golden.actors.parts })
      expect((partsQueue as typeof partsQueue & { partsJobs?: typeof partsQueue.myJobs }).partsJobs)
        .toEqual([expect.objectContaining({ id: job.id })])
      const partsTicket = await getTicketDetail(golden.db, {
        actor: golden.actors.parts,
        ticketId,
      })
      expect(partsTicket).toMatchObject({ ok: true, ticket: { id: ticketId } })

      expect(await resolvePartRequest(golden.db, {
        actor: { profileId: golden.people.tech.id, shopId: golden.shop.id },
        ticketId,
        requestId: requested.request.id,
        body: { status: 'sourced' },
      })).toEqual({ ok: false, error: 'not_authorized' })
      expect(await resolvePartRequest(golden.db, {
        actor: { profileId: golden.people.parts.id, shopId: golden.shop.id },
        ticketId,
        requestId: requested.request.id,
        body: { status: 'sourced' },
      })).toMatchObject({ ok: true, request: { status: 'sourced' } })
      expect((await listTodayTicketJobs(golden.db, {
        actor: golden.actors.parts,
      })).partsJobs).toEqual([])

      const noted = await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.relief.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: {
          action: 'save_note',
          note: 'Alternator replaced; charging output verified at idle and under load.',
          expectedUpdatedAt: resumed.ok ? resumed.work.updatedAt : started.work.updatedAt,
        },
      })
      expect(noted).toMatchObject({ ok: true, changed: true })
      if (!noted.ok) throw new Error('work note failed')
      expect(await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.relief.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: {
          action: 'save_note',
          note: 'Delayed stale note that must not win.',
          expectedUpdatedAt: started.work.updatedAt,
        },
      })).toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(await getSimpleWorkWorkspace(golden.db, {
        actor: { profileId: golden.people.relief.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
      })).toMatchObject({
        ok: true,
        workspace: {
          workNotes: 'Alternator replaced; charging output verified at idle and under load.',
        },
      })
      expect(await mutateSimpleWork(golden.db, {
        actor: { profileId: golden.people.relief.id, shopId: golden.shop.id },
        ticketId,
        jobId: job.id,
        body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
      })).toMatchObject({ ok: true, changed: true, work: { status: 'done' } })

      const ringOut = await getTicketRingOut(golden.db, {
        actor: golden.actors.owner,
        ticketId,
      })
      expect(ringOut).toMatchObject({ ok: true, ringOut: { canClose: false } })
      if (!ringOut.ok) throw new Error('ring-out unavailable')
      expect(ringOut.ringOut.balanceCents).toBeGreaterThan(0)
      expect(await closeTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId,
      })).toEqual({ ok: false, error: 'balance_outstanding' })

      const paid = await recordTicketPayment(golden.db, {
        actor: golden.actors.owner,
        ticketId,
        body: {
          requestKey: GOLDEN_KEYS.payment,
          amountCents: ringOut.ringOut.balanceCents,
          method: 'card',
          note: 'Synthetic Golden Shop Day payment',
        },
      })
      expect(paid).toMatchObject({ ok: true, ringOut: { balanceCents: 0, canClose: true } })
      const paidReplay = await recordTicketPayment(golden.db, {
        actor: golden.actors.owner,
        ticketId,
        body: {
          requestKey: GOLDEN_KEYS.payment,
          amountCents: ringOut.ringOut.balanceCents,
          method: 'card',
          note: 'Synthetic Golden Shop Day payment',
        },
      })
      expect(paidReplay).toMatchObject({ ok: true, ringOut: { balanceCents: 0 } })
      expect(await golden.db.select().from(ticketPayments)
        .where(eq(ticketPayments.ticketId, ticketId))).toHaveLength(1)
      expect(await closeTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId,
      })).toMatchObject({ ok: true, ringOut: { status: 'closed', canClose: false } })

      for (const actor of Object.values(golden.actors)) {
        const terminalTicket = await getTicketDetail(golden.db, { actor, ticketId })
        expect(terminalTicket.ok).toBe(true)
        if (!terminalTicket.ok) throw new Error('terminal ticket unavailable')
        expect(terminalTicket.ticket.status).toBe('closed')
        expect(commandKinds(actor, terminalTicket.ticket)).toEqual([])
        const terminalQueue = await listTodayTicketJobs(golden.db, { actor })
        expect([
          ...terminalQueue.myJobs,
          ...terminalQueue.openJobs,
          ...terminalQueue.createdJobs,
          ...terminalQueue.teamJobs,
        ]).toEqual([])
      }
    } finally {
      await golden.close()
    }
  }, 60_000)
})
