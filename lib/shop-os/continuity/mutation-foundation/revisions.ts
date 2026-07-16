import 'server-only'

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppDb } from '../../../db/queries'
import {
  customers,
  jobLines,
  sessions,
  ticketJobs,
  tickets,
  vehicles,
} from '../../../db/schema'
import { assertLiveLockedMutationScopeV1 } from './attempt-capability'
import { serializeRevisionDecimal } from './canonical'
import { ShopOsMutationNotFound } from './contracts'
import type {
  LockedTicketGraphV1,
  RevisionDecimal,
} from './contracts'
import { ShopOsMutationConflict } from './conflicts'
import {
  buildContinuitySignatureV1,
  equalContinuitySignatureV1,
} from './continuity-signature'
import type { LockedMutationScopeV1 } from './lock-order'

const POSTGRES_INTEGER_MAX = 2_147_483_647

type SequenceReservationState = Map<string, Map<string, number>>

const sequenceReservations = new WeakMap<
  LockedMutationScopeV1,
  SequenceReservationState
>()

function revisionConflict(): never {
  throw new ShopOsMutationConflict()
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactUniqueIds(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  const keys = Object.keys(actual)
  if (
    keys.length !== actual.length ||
    keys.some((key, index) => key !== String(index))
  ) return false
  const unique = new Set(actual)
  if (unique.size !== actual.length) return false
  const expectedSet = new Set(expected)
  return expectedSet.size === expected.length &&
    actual.every((id) => typeof id === 'string' && expectedSet.has(id))
}

function freezeFinalizedResult(
  ticketsResult: FinalizedMutationRevisionsV1['tickets'],
  jobsResult: FinalizedMutationRevisionsV1['jobs'],
): FinalizedMutationRevisionsV1 {
  return Object.freeze({
    tickets: Object.freeze(ticketsResult.map((ticket) => Object.freeze(ticket))),
    jobs: Object.freeze(jobsResult.map((job) => Object.freeze(job))),
  })
}

export type TicketRevisionDeltaV1 = Readonly<{
  ticketId: string
  createdTicket: boolean
  createdJobIds: readonly string[]
  existingChangedJobIds: readonly string[]
  actorVisibleTicketFieldsChanged: boolean
}>

export type CreatedMutationRowsV1 = Readonly<{
  sessionIds: readonly string[]
  customerIds: readonly string[]
  vehicleIds: readonly string[]
}>

export type FinalizedMutationRevisionsV1 = Readonly<{
  tickets: readonly Readonly<{
    id: string
    projectionRevision: RevisionDecimal
    continuityRevision: RevisionDecimal
    continuityChanged: boolean
  }>[]
  jobs: readonly Readonly<{
    id: string
    revision: RevisionDecimal
  }>[]
}>

export function reserveJobSequencesForInsertionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  ticketId: string,
  orderedJobIds: readonly string[],
): readonly Readonly<{ jobId: string; sequenceNumber: number }>[] {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (!scope.request.includeAllJobsForTickets || !Array.isArray(orderedJobIds)) {
    return revisionConflict()
  }

  const graph = scope.tickets.find(({ ticket }) => ticket.id === ticketId)
  const registeredNewTicket = scope.insertionIntents.tickets.includes(ticketId)
  if (
    (graph === undefined && !registeredNewTicket) ||
    (graph !== undefined && registeredNewTicket)
  ) return revisionConflict()

  const existingJobs = graph?.jobs ?? []
  const nullSequenceCount = existingJobs.filter((job) =>
    job.sequenceNumber === null).length
  const populatedSequences = existingJobs.flatMap((job) => {
    const sequence = job.sequenceNumber
    if (sequence === null) return []
    if (!Number.isSafeInteger(sequence) || sequence < 1) return revisionConflict()
    return [sequence]
  }).sort((left, right) => left - right)
  for (let index = 0; index < populatedSequences.length; index += 1) {
    if (populatedSequences[index] !== nullSequenceCount + index + 1) {
      return revisionConflict()
    }
  }

  const scopeState = sequenceReservations.get(scope) ?? new Map()
  const ticketState = scopeState.get(ticketId) ?? new Map()
  const requestedIds = new Set<string>()
  for (const jobId of orderedJobIds) {
    const intent = scope.insertionIntents.jobs.find(({ id }) => id === jobId)
    if (
      typeof jobId !== 'string' || requestedIds.has(jobId) ||
      ticketState.has(jobId) || !intent || intent.ticketId !== ticketId
    ) return revisionConflict()
    requestedIds.add(jobId)
  }

  const priorSequences = [...ticketState.values()].sort((left, right) => left - right)
  for (let index = 0; index < priorSequences.length; index += 1) {
    if (priorSequences[index] !== existingJobs.length + index + 1) {
      return revisionConflict()
    }
  }
  const maxExistingSequence = populatedSequences.at(-1) ?? 0
  const maxReservedSequence = priorSequences.at(-1) ?? 0
  const firstSequence = Math.max(
    existingJobs.length + priorSequences.length,
    maxExistingSequence,
    maxReservedSequence,
  ) + 1
  const lastSequence = firstSequence + orderedJobIds.length - 1
  if (
    !Number.isSafeInteger(firstSequence) ||
    (orderedJobIds.length > 0 && lastSequence > POSTGRES_INTEGER_MAX)
  ) return revisionConflict()

  const reservations = Object.freeze(orderedJobIds.map((jobId, index) =>
    Object.freeze({ jobId, sequenceNumber: firstSequence + index })))
  if (reservations.length > 0) {
    if (!sequenceReservations.has(scope)) sequenceReservations.set(scope, scopeState)
    if (!scopeState.has(ticketId)) scopeState.set(ticketId, ticketState)
    for (const reservation of reservations) {
      ticketState.set(reservation.jobId, reservation.sequenceNumber)
    }
  }
  return reservations
}

export async function finalizeMutationRevisionsV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  createdRows: CreatedMutationRowsV1,
  deltas: readonly TicketRevisionDeltaV1[],
  seams?: Readonly<{
    afterDomainReload?: () => Promise<void>
    afterRevisionWrite?: () => Promise<void>
  }>,
): Promise<FinalizedMutationRevisionsV1> {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (
    typeof createdRows !== 'object' || createdRows === null ||
    !exactUniqueIds(
      createdRows.sessionIds,
      scope.insertionIntents.sessions.map(({ id }) => id),
    ) ||
    !exactUniqueIds(
      createdRows.customerIds,
      scope.insertionIntents.customers.map(({ id }) => id),
    ) ||
    !exactUniqueIds(
      createdRows.vehicleIds,
      scope.insertionIntents.vehicles.map(({ id }) => id),
    ) ||
    !Array.isArray(deltas)
  ) return revisionConflict()

  const ticketIds = new Set<string>()
  const createdTicketIds: string[] = []
  const createdJobIds: string[] = []
  for (const delta of deltas) {
    if (
      typeof delta !== 'object' || delta === null ||
      typeof delta.ticketId !== 'string' || ticketIds.has(delta.ticketId) ||
      typeof delta.createdTicket !== 'boolean' ||
      typeof delta.actorVisibleTicketFieldsChanged !== 'boolean' ||
      !Array.isArray(delta.createdJobIds) ||
      !Array.isArray(delta.existingChangedJobIds)
    ) return revisionConflict()
    ticketIds.add(delta.ticketId)
    const deltaJobIds = [...delta.createdJobIds, ...delta.existingChangedJobIds]
    if (
      new Set(deltaJobIds).size !== deltaJobIds.length ||
      deltaJobIds.some((id) => typeof id !== 'string')
    ) return revisionConflict()
    if (delta.createdTicket) createdTicketIds.push(delta.ticketId)
    createdJobIds.push(...delta.createdJobIds)
  }
  if (
    !exactUniqueIds(createdTicketIds, scope.insertionIntents.tickets) ||
    !exactUniqueIds(
      createdJobIds,
      scope.insertionIntents.jobs.map(({ id }) => id),
    )
  ) return revisionConflict()

  if (
    deltas.length === 0 && createdRows.sessionIds.length === 0 &&
    createdRows.customerIds.length === 0 && createdRows.vehicleIds.length === 0
  ) return freezeFinalizedResult([], [])
  if (
    deltas.length > 0 && (
      !scope.request.includeAllJobsForTickets ||
      !scope.request.includeAllLinesForJobs
    )
  ) return revisionConflict()

  const orderedDeltas = [...deltas].sort((left, right) =>
    compareIds(left.ticketId, right.ticketId))
  const graphByTicketId = new Map(scope.tickets.map((graph) =>
    [graph.ticket.id, graph] as const))
  const jobIntentById = new Map(scope.insertionIntents.jobs.map((intent) =>
    [intent.id, intent] as const))
  for (const delta of orderedDeltas) {
    const graph = graphByTicketId.get(delta.ticketId)
    if (delta.createdTicket) {
      if (
        graph || scope.beforeSignatures.has(delta.ticketId) ||
        !scope.insertionIntents.tickets.includes(delta.ticketId) ||
        delta.existingChangedJobIds.length > 0
      ) return revisionConflict()
    } else if (!graph || !scope.beforeSignatures.has(delta.ticketId)) {
      return revisionConflict()
    }
    const existingJobIds = new Set(graph?.jobs.map(({ id }) => id) ?? [])
    if (delta.existingChangedJobIds.some((id: string) => !existingJobIds.has(id))) {
      return revisionConflict()
    }
    if (delta.createdJobIds.some((id: string) =>
      jobIntentById.get(id)?.ticketId !== delta.ticketId)) return revisionConflict()
  }

  const orderedTicketIds = orderedDeltas.map(({ ticketId }) => ticketId)
  const createdSessions = createdRows.sessionIds.length === 0
    ? []
    : await tx.select().from(sessions).where(and(
      eq(sessions.shopId, scope.request.shopId),
      inArray(sessions.id, createdRows.sessionIds),
    )).orderBy(sessions.id)
  if (createdSessions.length !== createdRows.sessionIds.length) {
    throw new ShopOsMutationNotFound()
  }
  const sessionIntentById = new Map(scope.insertionIntents.sessions.map((intent) =>
    [intent.id, intent] as const))
  const authorizedProfileIds = new Set(scope.profiles.map(({ id }) => id))
  for (const session of createdSessions) {
    const intent = sessionIntentById.get(session.id)
    if (
      !intent || intent.shopId !== scope.request.shopId ||
      session.techId !== intent.techId || !authorizedProfileIds.has(session.techId)
    ) return revisionConflict()
  }

  const reloadedTickets = orderedTicketIds.length === 0
    ? []
    : await tx.select().from(tickets).where(and(
      eq(tickets.shopId, scope.request.shopId),
      inArray(tickets.id, orderedTicketIds),
    )).orderBy(tickets.id)
  if (reloadedTickets.length !== orderedTicketIds.length) {
    throw new ShopOsMutationNotFound()
  }
  const reloadedJobs = orderedTicketIds.length === 0
    ? []
    : await tx.select().from(ticketJobs).where(and(
      eq(ticketJobs.shopId, scope.request.shopId),
      inArray(ticketJobs.ticketId, orderedTicketIds),
    )).orderBy(ticketJobs.id)
  const expectedJobIds = new Set(orderedDeltas.flatMap((delta) => [
    ...(graphByTicketId.get(delta.ticketId)?.jobs.map(({ id }) => id) ?? []),
    ...delta.createdJobIds,
  ]))
  if (
    reloadedJobs.length !== expectedJobIds.size ||
    reloadedJobs.some(({ id }) => !expectedJobIds.has(id))
  ) return revisionConflict()
  const reloadedLines = reloadedJobs.length === 0
    ? []
    : await tx.select().from(jobLines).where(and(
      eq(jobLines.shopId, scope.request.shopId),
      inArray(jobLines.jobId, reloadedJobs.map(({ id }) => id)),
    )).orderBy(jobLines.id)

  const customerIds = [...new Set([
    ...createdRows.customerIds,
    ...reloadedTickets.flatMap(({ customerId }) =>
      customerId === null ? [] : [customerId]),
  ])].sort(compareIds)
  const vehicleIds = [...new Set([
    ...createdRows.vehicleIds,
    ...reloadedTickets.flatMap(({ vehicleId }) =>
      vehicleId === null ? [] : [vehicleId]),
  ])].sort(compareIds)
  const reloadedCustomers = customerIds.length === 0
    ? []
    : await tx.select().from(customers).where(and(
      eq(customers.shopId, scope.request.shopId),
      inArray(customers.id, customerIds),
    )).orderBy(customers.id)
  const reloadedVehicleRows = vehicleIds.length === 0
    ? []
    : await tx.select({ row: vehicles }).from(vehicles).innerJoin(
      customers,
      eq(customers.id, vehicles.customerId),
    ).where(and(
      eq(customers.shopId, scope.request.shopId),
      inArray(vehicles.id, vehicleIds),
    )).orderBy(vehicles.id)
  const reloadedVehicles = reloadedVehicleRows.map(({ row }) => row)
  if (
    reloadedCustomers.length !== customerIds.length ||
    reloadedVehicles.length !== vehicleIds.length
  ) throw new ShopOsMutationNotFound()
  const customerIntentById = new Map(scope.insertionIntents.customers.map((intent) =>
    [intent.id, intent] as const))
  const vehicleIntentById = new Map(scope.insertionIntents.vehicles.map((intent) =>
    [intent.id, intent] as const))
  for (const customerId of createdRows.customerIds) {
    const row = reloadedCustomers.find(({ id }) => id === customerId)
    const intent = customerIntentById.get(customerId)
    if (!row || !intent || intent.shopId !== scope.request.shopId) {
      return revisionConflict()
    }
  }
  for (const vehicleId of createdRows.vehicleIds) {
    const row = reloadedVehicles.find(({ id }) => id === vehicleId)
    const intent = vehicleIntentById.get(vehicleId)
    if (!row || !intent || row.customerId !== intent.customerId) {
      return revisionConflict()
    }
  }
  const authorizedCustomerIds = new Set([
    ...scope.customers.map(({ id }) => id),
    ...createdRows.customerIds,
  ])
  const authorizedVehicleIds = new Set([
    ...scope.vehicles.map(({ id }) => id),
    ...createdRows.vehicleIds,
  ])
  const authorizedSessionIds = new Set([
    ...scope.sessions.map(({ id }) => id),
    ...createdRows.sessionIds,
  ])
  for (const session of createdSessions) {
    if (
      session.vehicleId !== null && !authorizedVehicleIds.has(session.vehicleId)
    ) return revisionConflict()
  }

  const afterGraphByTicketId = new Map<string, LockedTicketGraphV1>()
  const deltaByTicketId = new Map(orderedDeltas.map((delta) =>
    [delta.ticketId, delta] as const))
  const authorizedTicketIds = new Set([
    ...scope.tickets.map(({ ticket }) => ticket.id),
    ...createdTicketIds,
  ])
  for (const ticket of reloadedTickets) {
    const delta = deltaByTicketId.get(ticket.id)
    const beforeGraph = graphByTicketId.get(ticket.id)
    if (!delta || Boolean(beforeGraph) === delta.createdTicket) {
      return revisionConflict()
    }
    if (
      (ticket.customerId === null) !== (ticket.vehicleId === null) ||
      (ticket.customerId === null && ticket.source !== 'tech_quick') ||
      (ticket.customerId !== null && !authorizedCustomerIds.has(ticket.customerId)) ||
      (ticket.vehicleId !== null && !authorizedVehicleIds.has(ticket.vehicleId)) ||
      !authorizedProfileIds.has(ticket.createdByProfileId) ||
      [
        ticket.canceledByProfileId,
        ticket.deliveredByProfileId,
        ticket.closedByProfileId,
      ].some((id) => id !== null && !authorizedProfileIds.has(id)) ||
      (ticket.separateFromTicketId !== null &&
        !authorizedTicketIds.has(ticket.separateFromTicketId))
    ) return revisionConflict()
    if (
      delta.createdTicket &&
      (ticket.projectionRevision !== 1n || ticket.continuityRevision !== 1n)
    ) return revisionConflict()
    const ticketRows = reloadedJobs.filter((job) => job.ticketId === ticket.id)
    const expectedTicketJobIds = new Set([
      ...(beforeGraph?.jobs.map(({ id }) => id) ?? []),
      ...delta.createdJobIds,
    ])
    if (
      ticketRows.length !== expectedTicketJobIds.size ||
      ticketRows.some(({ id }) => !expectedTicketJobIds.has(id))
    ) return revisionConflict()
    const ticketReservationState = sequenceReservations.get(scope)?.get(ticket.id)
    for (const job of ticketRows) {
      const isCreated = delta.createdJobIds.includes(job.id)
      if (isCreated && (
        job.revision !== 1n ||
        ticketReservationState?.get(job.id) !== job.sequenceNumber
      )) return revisionConflict()
      if (
        (job.assignedTechId !== null && !authorizedProfileIds.has(job.assignedTechId)) ||
        (job.createdByProfileId !== null && !authorizedProfileIds.has(job.createdByProfileId)) ||
        (job.statementConfirmedByProfileId !== null &&
          !authorizedProfileIds.has(job.statementConfirmedByProfileId)) ||
        (job.sessionId !== null && !authorizedSessionIds.has(job.sessionId)) ||
        (job.createdFromJobId !== null && !expectedTicketJobIds.has(job.createdFromJobId))
      ) return revisionConflict()
    }
    const graph = {
      ticket,
      jobs: ticketRows,
      lines: reloadedLines.filter((line) =>
        reloadedJobs.some((job) => job.ticketId === ticket.id && job.id === line.jobId)),
      versions: beforeGraph?.versions ?? [],
      events: beforeGraph?.events ?? [],
    }
    afterGraphByTicketId.set(ticket.id, graph)
  }

  const revisionPlans = orderedDeltas.map((delta) => {
    const beforeGraph = graphByTicketId.get(delta.ticketId)
    const afterGraph = afterGraphByTicketId.get(delta.ticketId)
    const beforeSignature = scope.beforeSignatures.get(delta.ticketId)
    if (
      !afterGraph ||
      (!delta.createdTicket && (!beforeGraph || !beforeSignature)) ||
      (delta.createdTicket && (beforeGraph || beforeSignature))
    ) return revisionConflict()
    const customer = afterGraph.ticket.customerId === null
      ? null
      : reloadedCustomers.find(({ id }) => id === afterGraph.ticket.customerId) ?? null
    const vehicle = afterGraph.ticket.vehicleId === null
      ? null
      : reloadedVehicles.find(({ id }) => id === afterGraph.ticket.vehicleId) ?? null
    if (
      (afterGraph.ticket.customerId !== null && customer === null) ||
      (afterGraph.ticket.vehicleId !== null && (
        vehicle === null || customer === null || vehicle.customerId !== customer.id
      ))
    ) return revisionConflict()
    const afterSignature = buildContinuitySignatureV1({
      graph: afterGraph,
      customerBelongsToShop: customer?.shopId === scope.request.shopId,
      vehicleBelongsToCustomer:
        vehicle !== null && customer !== null && vehicle.customerId === customer.id,
    })
    return {
      delta,
      beforeGraph,
      afterGraph,
      continuityChanged: delta.createdTicket
        ? true
        : !equalContinuitySignatureV1(beforeSignature!, afterSignature),
      projectionChanged:
        delta.createdJobIds.length > 0 ||
        delta.existingChangedJobIds.length > 0 ||
        delta.actorVisibleTicketFieldsChanged,
    }
  })

  await seams?.afterDomainReload?.()
  assertLiveLockedMutationScopeV1(tx, scope)

  const ticketsResult: FinalizedMutationRevisionsV1['tickets'][number][] = []
  const jobsResult: FinalizedMutationRevisionsV1['jobs'][number][] = []
  for (const plan of revisionPlans) {
    if (plan.delta.createdTicket) {
      ticketsResult.push({
        id: plan.delta.ticketId,
        projectionRevision: serializeRevisionDecimal(plan.afterGraph.ticket.projectionRevision),
        continuityRevision: serializeRevisionDecimal(plan.afterGraph.ticket.continuityRevision),
        continuityChanged: true,
      })
      continue
    }

    const beforeGraph = plan.beforeGraph
    if (!beforeGraph) return revisionConflict()
    const oldProjection = beforeGraph.ticket.projectionRevision
    const oldContinuity = beforeGraph.ticket.continuityRevision
    let projectionRevision = oldProjection
    let continuityRevision = oldContinuity
    if (plan.projectionChanged || plan.continuityChanged) {
      const [updated] = await tx.update(tickets).set({
        projectionRevision: plan.projectionChanged
          ? sql`${tickets.projectionRevision} + 1`
          : oldProjection,
        continuityRevision: plan.continuityChanged
          ? sql`${tickets.continuityRevision} + 1`
          : oldContinuity,
      }).where(and(
        eq(tickets.shopId, scope.request.shopId),
        eq(tickets.id, plan.delta.ticketId),
        eq(tickets.projectionRevision, oldProjection),
        eq(tickets.continuityRevision, oldContinuity),
      )).returning()
      if (!updated) return revisionConflict()
      projectionRevision = updated.projectionRevision
      continuityRevision = updated.continuityRevision
    }
    ticketsResult.push({
      id: plan.delta.ticketId,
      projectionRevision: serializeRevisionDecimal(projectionRevision),
      continuityRevision: serializeRevisionDecimal(continuityRevision),
      continuityChanged: plan.continuityChanged,
    })
  }

  for (const plan of revisionPlans) {
    const createdIdSet = new Set(plan.delta.createdJobIds)
    const orderedCreatedJobs = plan.afterGraph.jobs
      .filter(({ id }) => createdIdSet.has(id))
      .sort((left, right) =>
        (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) ||
        compareIds(left.id, right.id))
    for (const job of orderedCreatedJobs) {
      jobsResult.push({
        id: job.id,
        revision: serializeRevisionDecimal(job.revision),
      })
    }

    if (plan.delta.createdTicket) continue
    const beforeGraph = plan.beforeGraph
    if (!beforeGraph) return revisionConflict()
    const beforeJobById = new Map(beforeGraph.jobs.map((job) =>
      [job.id, job] as const))
    for (const jobId of [...plan.delta.existingChangedJobIds].sort(compareIds)) {
      const beforeJob = beforeJobById.get(jobId)
      if (!beforeJob) return revisionConflict()
      const [updated] = await tx.update(ticketJobs).set({
        revision: sql`${ticketJobs.revision} + 1`,
      }).where(and(
        eq(ticketJobs.shopId, scope.request.shopId),
        eq(ticketJobs.ticketId, plan.delta.ticketId),
        eq(ticketJobs.id, jobId),
        eq(ticketJobs.revision, beforeJob.revision),
      )).returning()
      if (!updated) return revisionConflict()
      jobsResult.push({
        id: jobId,
        revision: serializeRevisionDecimal(updated.revision),
      })
    }
  }

  await seams?.afterRevisionWrite?.()
  return freezeFinalizedResult(ticketsResult, jobsResult)
}
