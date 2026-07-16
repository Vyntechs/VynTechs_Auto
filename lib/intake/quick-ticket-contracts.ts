import { z } from 'zod'
import type {
  CanonicalQuickReceiptRequestV1,
  CanonicalValue,
  TicketCreatingEnvelopeBaseV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())
const optionalTrimmedText = (max: number) => z.string().trim().max(max).nullable().optional()
const mileageSchema = z.number().int().nonnegative().max(2_147_483_647)
const manualQuoteSchema = z.strictObject({
  mode: z.literal('manual'),
  kind: z.enum(['repair', 'maintenance']),
  description: z.string().trim().min(1).max(200),
})
const cannedQuoteSchema = z.strictObject({
  mode: z.literal('canned'),
  cannedJobId: uuidSchema,
  expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expectedTaxRateBps: z.union([z.literal(null), z.number().int().min(0).max(10_000)]),
})
const quoteSchema = z.discriminatedUnion('mode', [manualQuoteSchema, cannedQuoteSchema])
const common = { clientKey: uuidSchema, quote: quoteSchema }
const existingQuickTicketBodySchema = z.strictObject({
  vehicleMode: z.literal('existing'),
  existingVehicleId: uuidSchema,
  mileage: mileageSchema.nullable().optional(),
  ...common,
})
const newQuickTicketBodySchema = z.strictObject({
  vehicleMode: z.literal('new'),
  customer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(320).nullable().optional(),
  }),
  vehicle: z.strictObject({
    year: z.number().int().min(1886).max(new Date().getFullYear() + 1),
    make: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    engine: optionalTrimmedText(200),
    vin: z.string().trim().length(17).nullable().optional(),
    mileage: mileageSchema.nullable().optional(),
    plate: optionalTrimmedText(32),
  }),
  ...common,
})
const quickTicketBodySchema = z.discriminatedUnion('vehicleMode', [
  existingQuickTicketBodySchema,
  newQuickTicketBodySchema,
])

export type QuickTicketBodyV1 = z.output<typeof quickTicketBodySchema>

export type ParsedQuickTicketRequestV1 = Readonly<{
  body: QuickTicketBodyV1
  receipt: CanonicalQuickReceiptRequestV1
}>

type CanonicalQuickReceiptState = Readonly<{
  requestKey: string
  body: QuickTicketBodyV1
  base: TicketCreatingEnvelopeBaseV1
}>

const canonicalQuickReceiptStates = new WeakMap<
  CanonicalQuickReceiptRequestV1,
  CanonicalQuickReceiptState
>()

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T
  }
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) copy[key] = cloneAndFreeze(item)
    }
    return Object.freeze(copy) as T
  }
  return value
}

function invalidCanonicalReceipt(): never {
  throw new Error('canonical_quick_receipt_invalid')
}

function stateFor(
  receipt: CanonicalQuickReceiptRequestV1,
): CanonicalQuickReceiptState {
  if ((typeof receipt !== 'object' || receipt === null) && typeof receipt !== 'function') {
    return invalidCanonicalReceipt()
  }
  return canonicalQuickReceiptStates.get(receipt) ?? invalidCanonicalReceipt()
}

function copyState(state: CanonicalQuickReceiptState): CanonicalQuickReceiptState {
  return Object.freeze({
    requestKey: state.requestKey,
    body: cloneAndFreeze(state.body),
    base: cloneAndFreeze(state.base),
  })
}

export function parseQuickTicketRequestV1(
  input: unknown,
): Readonly<
  | { ok: true; value: ParsedQuickTicketRequestV1 }
  | { ok: false; error: 'invalid_input' }
> {
  let parsed: ReturnType<typeof quickTicketBodySchema.safeParse>
  try {
    parsed = quickTicketBodySchema.safeParse(input)
  } catch {
    return Object.freeze({ ok: false, error: 'invalid_input' })
  }
  if (!parsed.success) return Object.freeze({ ok: false, error: 'invalid_input' })

  const privateBody = cloneAndFreeze(parsed.data)
  const base = Object.freeze({
    schemaVersion: 1 as const,
    mutationKind: 'create_repair_order' as const,
    target: Object.freeze({}),
    candidates: Object.freeze([]),
    payload: cloneAndFreeze(privateBody) as Readonly<Record<string, CanonicalValue>>,
  })
  const receipt = Object.freeze(
    Object.create(null) as CanonicalQuickReceiptRequestV1,
  )
  canonicalQuickReceiptStates.set(receipt, Object.freeze({
    requestKey: privateBody.clientKey,
    body: privateBody,
    base,
  }))

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      body: cloneAndFreeze(privateBody),
      receipt,
    }),
  })
}

export function consumeCanonicalQuickReceiptRequestForCreationV1(
  receipt: CanonicalQuickReceiptRequestV1,
): Readonly<{
  requestKey: string
  body: QuickTicketBodyV1
  base: TicketCreatingEnvelopeBaseV1
}> {
  return copyState(stateFor(receipt))
}
