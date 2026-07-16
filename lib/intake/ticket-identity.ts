import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { customers, vehicles } from '@/lib/db/schema'
import type { UpsertCustomerInput } from './customers'
import type { UpsertVehicleInput } from './vehicles'
import {
  assertLiveLockedMutationScopeV1,
  assertLiveMutationAttemptV1,
} from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import type {
  MaterializedTicketIntakeIdentityV1,
  MutationAttemptCapabilityV1,
  ResolvedTicketIntakeIdentityV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type { LockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import type { CreatedMutationRowsV1 } from '@/lib/shop-os/continuity/mutation-foundation/revisions'

export type TicketIntakeIdentityInputV1 =
  | Readonly<{
      mode: 'existing_vehicle'
      shopId: string
      existingVehicleId: string
      mileage?: number | null
    }>
  | Readonly<{
      mode: 'new_vehicle'
      shopId: string
      customer: Omit<UpsertCustomerInput, 'shopId'>
      vehicle: Omit<UpsertVehicleInput, 'customerId'>
    }>

export type TicketIntakeIdentityLockPlanV1 = Readonly<{
  lockShop: true
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  insertionIntents: Readonly<{
    customers: readonly Readonly<{ id: string; shopId: string }>[]
    vehicles: readonly Readonly<{ id: string; customerId: string }>[]
  }>
}>

export type TicketIntakeIdentitySeamsV1 = Readonly<{
  afterCustomerInsert?: () => Promise<void>
  afterVehicleInsert?: () => Promise<void>
  afterMileageWrite?: () => Promise<void>
}>

type NormalizedExistingIdentityInput = Extract<
  TicketIntakeIdentityInputV1,
  { mode: 'existing_vehicle' }
>
type NormalizedNewIdentityInput = Extract<
  TicketIntakeIdentityInputV1,
  { mode: 'new_vehicle' }
>
type NormalizedIdentityInput = NormalizedExistingIdentityInput | NormalizedNewIdentityInput

type VehicleNaturalKey =
  | Readonly<{ kind: 'vin'; customerId: string; vin: string }>
  | Readonly<{
      kind: 'plate'
      customerId: string
      year: number
      make: string
      model: string
      plate: string
    }>
  | Readonly<{ kind: 'none' }>

type ResolvedIdentityState = Readonly<{
  tx: AppDb
  capability: MutationAttemptCapabilityV1
  input: NormalizedIdentityInput
  customerId: string
  vehicleId: string
  customerExists: boolean
  vehicleExists: boolean
  customerMatchIds: readonly string[] | null
  vehicleMatchIds: readonly string[] | null
  vehicleNaturalKey: VehicleNaturalKey
  lockPlan: TicketIntakeIdentityLockPlanV1
}>

type MileageDisposition = Readonly<{
  kind: 'preserved' | 'updated' | 'inserted'
  mileage: number | null
}>

type MaterializedIdentityPayload = Readonly<{
  input: NormalizedIdentityInput
  customerId: string
  vehicleId: string
  createdRows: CreatedMutationRowsV1
  mileageDisposition: MileageDisposition
}>

type MaterializedIdentityState = MaterializedIdentityPayload & Readonly<{
  tx: AppDb
  scope: LockedMutationScopeV1
  capability: MutationAttemptCapabilityV1
}>

const resolvedIdentityStates = new WeakMap<
  ResolvedTicketIntakeIdentityV1,
  ResolvedIdentityState
>()
const materializedIdentityStates = new WeakMap<
  MaterializedTicketIntakeIdentityV1,
  MaterializedIdentityState
>()

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function invalidIdentity(): never {
  throw new Error('ticket_intake_identity_invalid')
}

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return invalidIdentity()
  return value.toLowerCase()
}

function normalizeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return invalidIdentity()
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > max) return invalidIdentity()
  return normalized
}

function normalizeNullableText(value: unknown, max: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return invalidIdentity()
  const normalized = value.trim()
  if (normalized.length === 0) return null
  if (normalized.length > max) return invalidIdentity()
  return normalized
}

function normalizeMileage(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) {
    return invalidIdentity()
  }
  return value as number
}

function normalizeInput(input: TicketIntakeIdentityInputV1): NormalizedIdentityInput {
  if (typeof input !== 'object' || input === null) return invalidIdentity()
  const shopId = normalizeUuid(input.shopId)
  if (input.mode === 'existing_vehicle') {
    const mileage = input.mileage === undefined ? undefined : normalizeMileage(input.mileage)
    return Object.freeze({
      mode: 'existing_vehicle' as const,
      shopId,
      existingVehicleId: normalizeUuid(input.existingVehicleId),
      ...(mileage === undefined ? {} : { mileage }),
    })
  }
  if (input.mode !== 'new_vehicle') return invalidIdentity()
  if (
    typeof input.customer !== 'object' || input.customer === null ||
    typeof input.vehicle !== 'object' || input.vehicle === null
  ) return invalidIdentity()
  const year = input.vehicle.year
  if (
    !Number.isInteger(year) || year < 1886 ||
    year > new Date().getFullYear() + 1
  ) return invalidIdentity()
  return Object.freeze({
    mode: 'new_vehicle' as const,
    shopId,
    customer: Object.freeze({
      name: normalizeText(input.customer.name, 200),
      phone: normalizeText(input.customer.phone, 100),
      email: normalizeNullableText(input.customer.email, 320),
    }),
    vehicle: Object.freeze({
      year,
      make: normalizeText(input.vehicle.make, 100),
      model: normalizeText(input.vehicle.model, 100),
      engine: normalizeNullableText(input.vehicle.engine, 200),
      vin: normalizeNullableText(input.vehicle.vin, 200),
      mileage: normalizeMileage(input.vehicle.mileage),
      plate: normalizeNullableText(input.vehicle.plate, 32),
    }),
  })
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}

function copyLockPlan(plan: TicketIntakeIdentityLockPlanV1): TicketIntakeIdentityLockPlanV1 {
  return Object.freeze({
    lockShop: true as const,
    customerIds: freezeArray(plan.customerIds),
    vehicleIds: freezeArray(plan.vehicleIds),
    insertionIntents: Object.freeze({
      customers: Object.freeze(plan.insertionIntents.customers.map((intent) => Object.freeze({
        id: intent.id,
        shopId: intent.shopId,
      }))),
      vehicles: Object.freeze(plan.insertionIntents.vehicles.map((intent) => Object.freeze({
        id: intent.id,
        customerId: intent.customerId,
      }))),
    }),
  })
}

function copyInput(input: NormalizedIdentityInput): NormalizedIdentityInput {
  if (input.mode === 'existing_vehicle') {
    return Object.freeze({
      mode: input.mode,
      shopId: input.shopId,
      existingVehicleId: input.existingVehicleId,
      ...(input.mileage === undefined ? {} : { mileage: input.mileage }),
    })
  }
  return Object.freeze({
    mode: input.mode,
    shopId: input.shopId,
    customer: Object.freeze({ ...input.customer }),
    vehicle: Object.freeze({ ...input.vehicle }),
  })
}

function createResolvedHandle(state: ResolvedIdentityState): ResolvedTicketIntakeIdentityV1 {
  const handle = Object.freeze(
    Object.create(null) as ResolvedTicketIntakeIdentityV1,
  )
  resolvedIdentityStates.set(handle, state)
  return handle
}

function createMaterializedHandle(
  state: MaterializedIdentityState,
): MaterializedTicketIntakeIdentityV1 {
  const handle = Object.freeze(
    Object.create(null) as MaterializedTicketIntakeIdentityV1,
  )
  materializedIdentityStates.set(handle, state)
  return handle
}

function resolvedStateFor(
  identity: ResolvedTicketIntakeIdentityV1,
): ResolvedIdentityState {
  if ((typeof identity !== 'object' || identity === null) && typeof identity !== 'function') {
    return invalidIdentity()
  }
  return resolvedIdentityStates.get(identity) ?? invalidIdentity()
}

function materializedStateFor(
  identity: MaterializedTicketIntakeIdentityV1,
): MaterializedIdentityState {
  if ((typeof identity !== 'object' || identity === null) && typeof identity !== 'function') {
    return invalidIdentity()
  }
  return materializedIdentityStates.get(identity) ?? invalidIdentity()
}

async function customerMatchIds(
  tx: AppDb,
  shopId: string,
  phone: string,
): Promise<readonly string[]> {
  const rows = await tx.select({ id: customers.id }).from(customers).where(and(
    eq(customers.shopId, shopId),
    eq(customers.phone, phone),
  )).orderBy(customers.id).limit(2)
  return freezeArray(rows.map(({ id }) => id))
}

function naturalKeyFor(input: NormalizedNewIdentityInput, customerId: string): VehicleNaturalKey {
  if (input.vehicle.vin !== null) {
    return Object.freeze({ kind: 'vin' as const, customerId, vin: input.vehicle.vin })
  }
  if (input.vehicle.plate !== null) {
    return Object.freeze({
      kind: 'plate' as const,
      customerId,
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      plate: input.vehicle.plate,
    })
  }
  return Object.freeze({ kind: 'none' as const })
}

async function vehicleMatchIds(
  tx: AppDb,
  key: VehicleNaturalKey,
): Promise<readonly string[]> {
  if (key.kind === 'none') return Object.freeze([])
  const rows = key.kind === 'vin'
    ? await tx.select({ id: vehicles.id }).from(vehicles).where(and(
        eq(vehicles.customerId, key.customerId),
        eq(vehicles.vin, key.vin),
      )).orderBy(vehicles.id).limit(2)
    : await tx.select({ id: vehicles.id }).from(vehicles).where(and(
        eq(vehicles.customerId, key.customerId),
        eq(vehicles.year, key.year),
        eq(vehicles.make, key.make),
        eq(vehicles.model, key.model),
        eq(vehicles.plate, key.plate),
      )).orderBy(vehicles.id).limit(2)
  return freezeArray(rows.map(({ id }) => id))
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sameCustomerIntents(
  left: readonly Readonly<{ id: string; shopId: string }>[],
  right: readonly Readonly<{ id: string; shopId: string }>[],
): boolean {
  return left.length === right.length && left.every((intent, index) =>
    intent.id === right[index]?.id && intent.shopId === right[index]?.shopId)
}

function sameVehicleIntents(
  left: readonly Readonly<{ id: string; customerId: string }>[],
  right: readonly Readonly<{ id: string; customerId: string }>[],
): boolean {
  return left.length === right.length && left.every((intent, index) =>
    intent.id === right[index]?.id && intent.customerId === right[index]?.customerId)
}

function assertExactScope(
  scope: LockedMutationScopeV1,
  state: ResolvedIdentityState,
): void {
  const plan = state.lockPlan
  if (
    scope.actor.shopId !== state.input.shopId ||
    scope.request.shopId !== state.input.shopId ||
    scope.request.lockShop !== true ||
    scope.shop?.id !== state.input.shopId ||
    !sameIds(scope.request.customerIds, plan.customerIds) ||
    !sameIds(scope.request.vehicleIds, plan.vehicleIds) ||
    !sameIds(scope.customers.map(({ id }) => id), plan.customerIds) ||
    !sameIds(scope.vehicles.map(({ id }) => id), plan.vehicleIds) ||
    !sameCustomerIntents(
      scope.insertionIntents.customers,
      plan.insertionIntents.customers,
    ) ||
    !sameVehicleIntents(
      scope.insertionIntents.vehicles,
      plan.insertionIntents.vehicles,
    )
  ) return invalidIdentity()

  const customer = state.customerExists
    ? scope.customers.find(({ id }) => id === state.customerId)
    : undefined
  const vehicle = state.vehicleExists
    ? scope.vehicles.find(({ id }) => id === state.vehicleId)
    : undefined
  if (
    (state.customerExists && customer?.shopId !== state.input.shopId) ||
    (!state.customerExists && customer !== undefined) ||
    (state.vehicleExists && vehicle?.customerId !== state.customerId) ||
    (!state.vehicleExists && vehicle !== undefined)
  ) return invalidIdentity()
}

export async function preflightTicketIntakeIdentityV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  input: TicketIntakeIdentityInputV1,
): Promise<
  | Readonly<{
      ok: true
      identity: ResolvedTicketIntakeIdentityV1
      lockPlan: TicketIntakeIdentityLockPlanV1
    }>
  | Readonly<{ ok: false; error: 'not_found' | 'identity_ambiguous' }>
> {
  assertLiveMutationAttemptV1(tx, attempt)
  const normalized = normalizeInput(input)
  const proposedCustomerId = normalized.mode === 'new_vehicle' ? randomUUID() : null
  const proposedVehicleId = normalized.mode === 'new_vehicle' ? randomUUID() : null

  if (normalized.mode === 'existing_vehicle') {
    const rows = await tx.select({
      customerId: customers.id,
      vehicleId: vehicles.id,
    }).from(vehicles).innerJoin(
      customers,
      eq(customers.id, vehicles.customerId),
    ).where(and(
      eq(customers.shopId, normalized.shopId),
      eq(vehicles.id, normalized.existingVehicleId),
    )).orderBy(vehicles.id).limit(2)
    if (rows.length === 0) return Object.freeze({ ok: false, error: 'not_found' })
    if (rows.length > 1) return Object.freeze({ ok: false, error: 'identity_ambiguous' })
    const row = rows[0]!
    const lockPlan = copyLockPlan({
      lockShop: true,
      customerIds: [row.customerId],
      vehicleIds: [row.vehicleId],
      insertionIntents: { customers: [], vehicles: [] },
    })
    const state: ResolvedIdentityState = Object.freeze({
      tx,
      capability: attempt,
      input: copyInput(normalized),
      customerId: row.customerId,
      vehicleId: row.vehicleId,
      customerExists: true,
      vehicleExists: true,
      customerMatchIds: null,
      vehicleMatchIds: null,
      vehicleNaturalKey: Object.freeze({ kind: 'none' as const }),
      lockPlan: copyLockPlan(lockPlan),
    })
    return Object.freeze({
      ok: true,
      identity: createResolvedHandle(state),
      lockPlan: copyLockPlan(lockPlan),
    })
  }

  const foundCustomerIds = await customerMatchIds(
    tx,
    normalized.shopId,
    normalized.customer.phone,
  )
  if (foundCustomerIds.length > 1) {
    return Object.freeze({ ok: false, error: 'identity_ambiguous' })
  }
  const customerExists = foundCustomerIds.length === 1
  const customerId = foundCustomerIds[0] ?? proposedCustomerId!
  const key = naturalKeyFor(normalized, customerId)
  const foundVehicleIds = await vehicleMatchIds(tx, key)
  if (foundVehicleIds.length > 1) {
    return Object.freeze({ ok: false, error: 'identity_ambiguous' })
  }
  const vehicleExists = foundVehicleIds.length === 1
  const vehicleId = foundVehicleIds[0] ?? proposedVehicleId!
  const lockPlan = copyLockPlan({
    lockShop: true,
    customerIds: customerExists ? [customerId] : [],
    vehicleIds: vehicleExists ? [vehicleId] : [],
    insertionIntents: {
      customers: customerExists ? [] : [{ id: customerId, shopId: normalized.shopId }],
      vehicles: vehicleExists ? [] : [{ id: vehicleId, customerId }],
    },
  })
  const state: ResolvedIdentityState = Object.freeze({
    tx,
    capability: attempt,
    input: copyInput(normalized),
    customerId,
    vehicleId,
    customerExists,
    vehicleExists,
    customerMatchIds: freezeArray(foundCustomerIds),
    vehicleMatchIds: key.kind === 'none' ? null : freezeArray(foundVehicleIds),
    vehicleNaturalKey: key,
    lockPlan: copyLockPlan(lockPlan),
  })
  return Object.freeze({
    ok: true,
    identity: createResolvedHandle(state),
    lockPlan: copyLockPlan(lockPlan),
  })
}

export async function materializeTicketIntakeIdentityInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  identity: ResolvedTicketIntakeIdentityV1,
  seams: TicketIntakeIdentitySeamsV1 = {},
): Promise<
  | Readonly<{ ok: true; materialized: MaterializedTicketIntakeIdentityV1 }>
  | Readonly<{ ok: false; error: 'identity_drift' | 'identity_ambiguous' }>
> {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  const state = resolvedStateFor(identity)
  if (state.tx !== tx || state.capability !== capability) return invalidIdentity()
  assertExactScope(scope, state)

  if (state.input.mode === 'new_vehicle') {
    const currentCustomerIds = await customerMatchIds(
      tx,
      state.input.shopId,
      state.input.customer.phone,
    )
    const currentVehicleIds = state.vehicleNaturalKey.kind === 'none'
      ? Object.freeze([]) as readonly string[]
      : await vehicleMatchIds(tx, state.vehicleNaturalKey)
    if (currentCustomerIds.length > 1 || currentVehicleIds.length > 1) {
      return Object.freeze({ ok: false, error: 'identity_ambiguous' })
    }
    if (
      !sameIds(currentCustomerIds, state.customerMatchIds ?? []) ||
      !sameIds(currentVehicleIds, state.vehicleMatchIds ?? [])
    ) return Object.freeze({ ok: false, error: 'identity_drift' })
  }

  const createdCustomerIds: string[] = []
  const createdVehicleIds: string[] = []
  if (!state.customerExists) {
    if (state.input.mode !== 'new_vehicle') return invalidIdentity()
    await tx.insert(customers).values({
      id: state.customerId,
      shopId: state.input.shopId,
      name: state.input.customer.name,
      phone: state.input.customer.phone,
      email: state.input.customer.email,
    })
    createdCustomerIds.push(state.customerId)
    await seams.afterCustomerInsert?.()
  }

  let mileageDisposition: MileageDisposition
  if (!state.vehicleExists) {
    if (state.input.mode !== 'new_vehicle') return invalidIdentity()
    await tx.insert(vehicles).values({
      id: state.vehicleId,
      customerId: state.customerId,
      year: state.input.vehicle.year,
      make: state.input.vehicle.make,
      model: state.input.vehicle.model,
      engine: state.input.vehicle.engine,
      vin: state.input.vehicle.vin,
      mileage: state.input.vehicle.mileage,
      plate: state.input.vehicle.plate,
    })
    createdVehicleIds.push(state.vehicleId)
    mileageDisposition = Object.freeze({
      kind: 'inserted',
      mileage: state.input.vehicle.mileage,
    })
    await seams.afterVehicleInsert?.()
  } else {
    const lockedVehicle = scope.vehicles.find(({ id }) => id === state.vehicleId)
    if (!lockedVehicle || lockedVehicle.customerId !== state.customerId) return invalidIdentity()
    const desiredMileage = state.input.mode === 'existing_vehicle'
      ? state.input.mileage
      : state.input.vehicle.mileage
    if (desiredMileage !== undefined && desiredMileage !== null && desiredMileage !== lockedVehicle.mileage) {
      const updated = await tx.update(vehicles).set({
        mileage: desiredMileage,
        updatedAt: new Date(),
      }).where(and(
        eq(vehicles.id, state.vehicleId),
        eq(vehicles.customerId, state.customerId),
      )).returning()
      if (updated.length !== 1 || updated[0]?.id !== state.vehicleId) return invalidIdentity()
      mileageDisposition = Object.freeze({ kind: 'updated', mileage: desiredMileage })
      await seams.afterMileageWrite?.()
    } else {
      mileageDisposition = Object.freeze({
        kind: 'preserved',
        mileage: lockedVehicle.mileage,
      })
    }
  }

  const createdRows: CreatedMutationRowsV1 = Object.freeze({
    sessionIds: Object.freeze([]),
    customerIds: freezeArray(createdCustomerIds),
    vehicleIds: freezeArray(createdVehicleIds),
  })
  const materialized = createMaterializedHandle(Object.freeze({
    tx,
    scope,
    capability,
    input: copyInput(state.input),
    customerId: state.customerId,
    vehicleId: state.vehicleId,
    createdRows,
    mileageDisposition,
  }))
  return Object.freeze({ ok: true, materialized })
}

function copyPayload(state: MaterializedIdentityState): MaterializedIdentityPayload {
  return Object.freeze({
    input: copyInput(state.input),
    customerId: state.customerId,
    vehicleId: state.vehicleId,
    createdRows: Object.freeze({
      sessionIds: freezeArray(state.createdRows.sessionIds),
      customerIds: freezeArray(state.createdRows.customerIds),
      vehicleIds: freezeArray(state.createdRows.vehicleIds),
    }),
    mileageDisposition: Object.freeze({ ...state.mileageDisposition }),
  })
}

export function consumeMaterializedTicketIntakeIdentityForCreationV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  identity: MaterializedTicketIntakeIdentityV1,
): MaterializedIdentityPayload {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  const state = materializedStateFor(identity)
  if (
    state.tx !== tx || state.scope !== scope || state.capability !== capability
  ) return invalidIdentity()
  return copyPayload(state)
}
