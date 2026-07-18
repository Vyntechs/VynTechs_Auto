import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { profiles, tickets } from '@/lib/db/schema'
import { canCreateTickets } from '@/lib/shop-os/capabilities'
import {
  preflightStrictCannedJobV1,
  resolveStrictCannedJobInLockedScopeV1,
} from '@/lib/shop-os/canned-jobs'
import {
  ShopOsMutationConflict,
  ShopOsMutationNotFound,
  runBoundedShopOsMutationV1,
  type LockedMutationScopeV1,
  type MutationFingerprintKeyringV1,
  type MutationLockRequestV1,
  type ResolvedQuickTemplateV1,
  type ResolvedTicketIntakeIdentityV1,
} from '@/lib/shop-os/continuity/mutation-foundation'
import { loadMutationFingerprintKeyringFromProcessV1 } from '@/lib/shop-os/continuity/mutation-foundation/keyring.server'
import { hintMutationReceiptPresenceV1 } from '@/lib/shop-os/continuity/mutation-foundation/receipts'
import { createQuickTicketOriginV1 } from '@/lib/shop-os/continuity/mutation-foundation/ticket-origin.server'
import {
  classifyResolvedTicketCreationReceiptInTransactionV1,
  finalizeResolvedTicketCreationInTransactionV1,
  getTicketDetail,
  insertResolvedTicketBatchInTransactionV1,
  insertResolvedTicketCreationReceiptInTransactionV1,
  resolveTicketCreationInLockedScopeV1,
  type CreateTicketResult,
  type TicketActor,
} from '@/lib/tickets'
import {
  materializeTicketIntakeIdentityInLockedScopeV1,
  preflightTicketIntakeIdentityV1,
  type TicketIntakeIdentityInputV1,
  type TicketIntakeIdentityLockPlanV1,
} from './ticket-identity'
import {
  parseQuickTicketRequestV1,
  type ParsedQuickTicketRequestV1,
  type QuickTicketBodyV1,
} from './quick-ticket-contracts'

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())

export type QuickTicketDependencies = {
  hintReceiptPresence?: typeof hintMutationReceiptPresenceV1
  afterDiscovery?: () => Promise<void>
  afterCustomer?: () => Promise<void>
  afterVehicle?: () => Promise<void>
  afterMileage?: () => Promise<void>
  afterTicket?: () => Promise<void>
  afterLines?: () => Promise<void>
  afterFinalization?: () => Promise<void>
  loadMutationKeyring?: () => MutationFingerprintKeyringV1
}

type QuickTicketFailure = Exclude<CreateTicketResult, { ok: true }>

type QuickTicketDiscovery =
  | Readonly<{
      kind: 'unavailable'
      stableFailure: QuickTicketFailure | null
    }>
  | Readonly<{
      kind: 'prepared'
      identity: ResolvedTicketIntakeIdentityV1
      template: ResolvedQuickTemplateV1 | null
      ticketId: string
      jobId: string
    }>

class QuickTicketRollback extends Error {
  constructor(readonly result: QuickTicketFailure) {
    super('quick_ticket_rollback')
  }
}

function actorDenied(actor: TicketActor): QuickTicketFailure | null {
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (!canCreateTickets(actor.role)) return { ok: false, error: 'forbidden' }
  return null
}

function deterministicTicketId(shopId: string, profileId: string, clientKey: string): string {
  const hash = createHash('sha256')
  hash.update('shop-os-quick-quote-ticket-v2\0')
  hash.update(shopId)
  hash.update('\0')
  hash.update(profileId)
  hash.update('\0')
  hash.update(clientKey)
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function identityInput(body: QuickTicketBodyV1, shopId: string): TicketIntakeIdentityInputV1 {
  if (body.vehicleMode === 'existing') {
    return {
      mode: 'existing_vehicle',
      shopId,
      existingVehicleId: body.existingVehicleId,
      ...(body.mileage === undefined ? {} : { mileage: body.mileage }),
    }
  }
  return {
    mode: 'new_vehicle',
    shopId,
    customer: {
      name: body.customer.name,
      phone: body.customer.phone,
      email: body.customer.email ?? null,
    },
    vehicle: {
      year: body.vehicle.year,
      make: body.vehicle.make,
      model: body.vehicle.model,
      engine: body.vehicle.engine ?? null,
      vin: body.vehicle.vin ?? null,
      mileage: body.vehicle.mileage ?? null,
      plate: body.vehicle.plate ?? null,
    },
  }
}

const emptyInsertionIntents = () => ({
  sessions: [],
  customers: [],
  vehicles: [],
  tickets: [],
  jobs: [],
})

function baseLockRequest(
  shopId: string,
  actorProfileId: string,
  requestKey: string,
  conditional: MutationLockRequestV1['receiptConditionalInsert'],
): MutationLockRequestV1 {
  return {
    shopId,
    actorProfileId,
    profileIds: [actorProfileId],
    lockShop: false,
    customerIds: [],
    vehicleIds: [],
    ticketIds: [],
    jobIds: [],
    includeAllJobsForTickets: false,
    includeAllLinesForJobs: false,
    includeAllQuoteVersionsForTickets: false,
    includeAllQuoteEventsForTickets: false,
    sessionIds: [],
    sessionEventIds: [],
    vendorAccountIds: [],
    cannedJobIds: [],
    receiptRequestKey: requestKey,
    receiptConditionalInsert: conditional,
    insertionIntents: emptyInsertionIntents(),
  }
}

function preparedLockRequest(
  shopId: string,
  actorProfileId: string,
  requestKey: string,
  plan: TicketIntakeIdentityLockPlanV1,
  ticketId: string,
  jobId: string,
  cannedJobIds: readonly string[],
): MutationLockRequestV1 {
  return baseLockRequest(shopId, actorProfileId, requestKey, {
    kind: 'prepared',
    extension: {
      lockShop: true,
      customerIds: [...plan.customerIds],
      vehicleIds: [...plan.vehicleIds],
      ticketIds: [],
      jobIds: [],
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: false,
      includeAllQuoteEventsForTickets: false,
      sessionIds: [],
      sessionEventIds: [],
      vendorAccountIds: [],
      cannedJobIds: [...cannedJobIds],
      insertionIntents: {
        sessions: [],
        customers: plan.insertionIntents.customers.map((intent) => ({ ...intent })),
        vehicles: plan.insertionIntents.vehicles.map((intent) => ({ ...intent })),
        tickets: [ticketId],
        jobs: [{ id: jobId, ticketId }],
      },
    },
  })
}

function lockedActor(scope: LockedMutationScopeV1): TicketActor {
  return {
    profileId: scope.actor.id,
    shopId: scope.actor.shopId,
    role: scope.actor.role,
    skillTier: scope.actor.skillTier,
    membershipStatus: 'active',
    deactivatedAt: null,
  }
}

async function safeTicketProjection(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  ticketId: string,
  expectedJobIds: readonly string[],
): Promise<Extract<CreateTicketResult, { ok: true }>> {
  const detail = await getTicketDetail(tx, {
    actor: lockedActor(scope),
    ticketId,
  })
  if (!detail.ok) throw new QuickTicketRollback(detail)
  const projectedJobIds = new Set(detail.ticket.jobs.map(({ id }) => id))
  if (
    detail.ticket.id !== ticketId || expectedJobIds.length !== 1 ||
    expectedJobIds.some((id) => !projectedJobIds.has(id))
  ) {
    throw new QuickTicketRollback({ ok: false, error: 'conflict' })
  }
  return detail
}

function isResolvedTemplateDrift(error: unknown): boolean {
  return error instanceof Error && error.message === 'resolved_quick_template_invalid'
}

export async function createQuickTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown },
  dependencies: QuickTicketDependencies = {},
): Promise<CreateTicketResult> {
  const boundaryActor = Object.freeze({
    profileId: input.actor.profileId,
    shopId: input.actor.shopId,
    role: input.actor.role,
    skillTier: input.actor.skillTier,
    membershipStatus: input.actor.membershipStatus,
    deactivatedAt: input.actor.deactivatedAt,
  })
  const denied = actorDenied(boundaryActor)
  if (denied) return denied

  const profileId = uuidSchema.safeParse(boundaryActor.profileId)
  const boundaryShopId = uuidSchema.safeParse(boundaryActor.shopId)
  if (!profileId.success || !boundaryShopId.success) return { ok: false, error: 'not_found' }
  const actor = Object.freeze({
    ...boundaryActor,
    profileId: profileId.data,
    shopId: boundaryShopId.data,
  })
  const parsed = parseQuickTicketRequestV1(input.body)
  if (!parsed.ok) return { ok: false, error: 'invalid_input' }
  const request: ParsedQuickTicketRequestV1 = parsed.value
  const body = request.body
  const origin = createQuickTicketOriginV1(body.clientKey)
  const callbacks = Object.freeze({
    afterCustomer: dependencies.afterCustomer,
    afterVehicle: dependencies.afterVehicle,
    afterMileage: dependencies.afterMileage,
    afterTicket: dependencies.afterTicket,
    afterLines: dependencies.afterLines,
    afterFinalization: dependencies.afterFinalization,
  })
  const hintReceiptPresence = dependencies.hintReceiptPresence ??
    hintMutationReceiptPresenceV1
  const loadMutationKeyring = dependencies.loadMutationKeyring ??
    loadMutationFingerprintKeyringFromProcessV1
  let keyring: MutationFingerprintKeyringV1
  try {
    keyring = loadMutationKeyring()
  } catch {
    return { ok: false, error: 'conflict', retryable: true }
  }

  const replay = async (
    tx: AppDb,
    scope: LockedMutationScopeV1,
  ): Promise<CreateTicketResult> => {
    if (scope.receiptPeek.kind !== 'owned') {
      throw new Error('quick_ticket_replay_scope_invalid')
    }
    const resultTicketId = scope.receiptPeek.resultTicketId
    const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
      mode: 'replay',
      origin,
      resultTicketId,
      receipt: request.receipt,
    })
    const classification = await classifyResolvedTicketCreationReceiptInTransactionV1(
      tx,
      scope,
      resolved,
      keyring,
    )
    if (classification.kind === 'conflict') {
      throw new QuickTicketRollback({ ok: false, error: 'conflict' })
    }
    if (classification.kind === 'verification_unavailable') {
      throw new QuickTicketRollback({ ok: false, error: 'conflict', retryable: true })
    }
    if (classification.kind !== 'replay') throw new ShopOsMutationConflict()
    if (classification.ticketId !== resultTicketId) {
      throw new QuickTicketRollback({ ok: false, error: 'conflict' })
    }
    return safeTicketProjection(tx, scope, classification.ticketId, classification.jobIds)
  }

  try {
    return await runBoundedShopOsMutationV1<CreateTicketResult, QuickTicketDiscovery>(db, {
      discover: async (tx, attempt) => {
        const [persistedProfile] = await tx.select({ shopId: profiles.shopId })
          .from(profiles)
          .where(eq(profiles.id, actor.profileId))
          .limit(1)
        if (!persistedProfile?.shopId) throw new ShopOsMutationNotFound()
        const shopId = persistedProfile.shopId
        const hint = await hintReceiptPresence(tx, attempt.capability, {
          shopId,
          requestKey: body.clientKey,
        })
        if (hint === 'present' || attempt.purpose === 'unique_collision_recovery') {
          await dependencies.afterDiscovery?.()
          return {
            lockRequest: baseLockRequest(shopId, actor.profileId, body.clientKey, {
              kind: 'unavailable',
            }),
            payload: Object.freeze({ kind: 'unavailable', stableFailure: null }),
          }
        }

        const legacyTicketId = deterministicTicketId(shopId, actor.profileId, body.clientKey)
        const templatePromise = body.quote.mode === 'canned'
          ? preflightStrictCannedJobV1(tx, attempt.capability, {
              shopId,
              cannedJobId: body.quote.cannedJobId,
              expectedFingerprint: body.quote.expectedFingerprint,
              expectedTaxRateBps: body.quote.expectedTaxRateBps,
            })
          : Promise.resolve(null)
        const [legacyRows, identity, template] = await Promise.all([
          tx.select({ present: sql<number>`1` }).from(tickets).where(and(
            eq(tickets.shopId, shopId),
            eq(tickets.id, legacyTicketId),
          )).limit(1),
          preflightTicketIntakeIdentityV1(
            tx,
            attempt.capability,
            identityInput(body, shopId),
          ),
          templatePromise,
        ])
        await dependencies.afterDiscovery?.()

        let stableFailure: QuickTicketFailure | null = null
        if (legacyRows.length > 0) {
          stableFailure = { ok: false, error: 'conflict' }
        } else if (template !== null && !template.ok) {
          stableFailure = template.error === 'not_found'
            ? { ok: false, error: 'not_found' }
            : { ok: false, error: 'conflict' }
        } else if (!identity.ok) {
          stableFailure = identity.error === 'not_found'
            ? { ok: false, error: 'not_found' }
            : { ok: false, error: 'conflict' }
        }
        if (stableFailure !== null || !identity.ok || (template !== null && !template.ok)) {
          return {
            lockRequest: baseLockRequest(shopId, actor.profileId, body.clientKey, {
              kind: 'unavailable',
            }),
            payload: Object.freeze({ kind: 'unavailable', stableFailure }),
          }
        }

        const ticketId = randomUUID()
        const jobId = randomUUID()
        return {
          lockRequest: preparedLockRequest(
            shopId,
            actor.profileId,
            body.clientKey,
            identity.lockPlan,
            ticketId,
            jobId,
            template === null ? [] : template.cannedJobIds,
          ),
          payload: Object.freeze({
            kind: 'prepared',
            identity: identity.identity,
            template: template === null ? null : template.template,
            ticketId,
            jobId,
          }),
        }
      },
      executeLocked: async (tx, scope, discovery, attempt) => {
        if (scope.receiptPeek.kind === 'owned') return replay(tx, scope)
        if (scope.receiptPeek.kind === 'occupied') {
          throw new QuickTicketRollback({ ok: false, error: 'conflict' })
        }
        if (scope.receiptConditionalInsertState === 'unavailable') {
          if (attempt.ordinal === 1) throw new ShopOsMutationConflict()
          if (discovery.kind !== 'unavailable') {
            throw new Error('quick_ticket_unavailable_discovery_invalid')
          }
          if (discovery.stableFailure) throw new QuickTicketRollback(discovery.stableFailure)
          throw new ShopOsMutationConflict()
        }
        if (
          scope.receiptConditionalInsertState !== 'activated' ||
          discovery.kind !== 'prepared'
        ) {
          throw new Error('quick_ticket_prepared_scope_invalid')
        }

        let lockedTemplate = null
        if (discovery.template !== null) {
          try {
            lockedTemplate = resolveStrictCannedJobInLockedScopeV1(
              tx,
              scope,
              discovery.template,
            )
          } catch (error) {
            if (isResolvedTemplateDrift(error)) throw new ShopOsMutationConflict()
            throw error
          }
        }
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          discovery.identity,
          {
            afterCustomerInsert: callbacks.afterCustomer,
            afterVehicleInsert: callbacks.afterVehicle,
            afterMileageWrite: callbacks.afterMileage,
          },
        )
        if (!materialized.ok) {
          if (materialized.error === 'identity_drift') throw new ShopOsMutationConflict()
          throw new QuickTicketRollback({ ok: false, error: 'conflict' })
        }
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin,
          identity: materialized.materialized,
          receipt: request.receipt,
          template: lockedTemplate,
        })
        const classification = await classifyResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          resolved,
          keyring,
        )
        if (classification.kind !== 'missing') {
          throw new Error('quick_ticket_insert_receipt_state_invalid')
        }
        const batch = await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        if (
          batch.ticketId !== discovery.ticketId || batch.jobIds.length !== 1 ||
          batch.jobIds[0] !== discovery.jobId
        ) {
          throw new Error('quick_ticket_insert_batch_invalid')
        }
        await callbacks.afterTicket?.()
        if (discovery.template !== null) await callbacks.afterLines?.()
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: discovery.ticketId,
            createdTicket: true,
            createdJobIds: [discovery.jobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        await callbacks.afterFinalization?.()
        const safe = await insertResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          finalized,
          keyring,
        )
        if (
          safe.ticketId !== discovery.ticketId || safe.jobIds.length !== 1 ||
          safe.jobIds[0] !== discovery.jobId
        ) {
          throw new Error('quick_ticket_receipt_result_invalid')
        }
        return safeTicketProjection(tx, scope, safe.ticketId, safe.jobIds)
      },
      uniqueCollisionRecovery: {
        allowedConstraints: ['ticket_mutation_receipts_shop_request_key_uq'],
        executeLocked: async (tx, scope) => {
          if (scope.receiptPeek.kind === 'owned') {
            return { kind: 'recovered', value: await replay(tx, scope) }
          }
          if (scope.receiptPeek.kind === 'occupied') {
            return {
              kind: 'recovered',
              value: { ok: false, error: 'conflict' },
            }
          }
          return { kind: 'unresolved' }
        },
      },
    })
  } catch (error) {
    if (error instanceof QuickTicketRollback) return error.result
    if (error instanceof ShopOsMutationNotFound) return { ok: false, error: 'not_found' }
    if (error instanceof ShopOsMutationConflict) {
      return { ok: false, error: 'conflict', retryable: true }
    }
    throw error
  }
}
