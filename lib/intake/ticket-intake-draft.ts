const MAX_BYTES = 16 * 1024
const MAX_AGE_MS = 12 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FINGERPRINT = /^[0-9a-f]{64}$/

export type TicketIntakeDraftSurface = 'write_up' | 'quick_ticket'

type SavedWork = { id: string; fingerprint: string }

export type TicketIntakeDraft = {
  actorId: string
  surface: TicketIntakeDraftSurface
  form: {
    existingVehicleId: string | null
    name: string
    phone: string
    email: string
    year: string
    make: string
    model: string
    engine: string
    vin: string
    mileage: string
    plate: string
    concern: string
    assignedTechId: string | null
    intent: 'diagnosis' | 'known'
    diagnosticMode: 'canned' | 'manual'
    knownWorkMode: 'canned' | 'manual'
    selectedDiagnostic: SavedWork | null
    selectedKnownWork: SavedWork | null
    customDiagnosticDescription: string
    customDiagnosticHours: string
    customDiagnosticPrice: string
    requestedServiceKind: 'repair' | 'maintenance'
    requestedServiceDescription: string
    customerSuppliedPartsNote: string
    quoteMode: 'canned' | 'manual'
    selectedCannedJob: SavedWork | null
    workKind: 'repair' | 'maintenance'
    requestedWork: string
  }
  pending: { signature: string; clientKey: string } | null
}

export type TicketIntakeDraftScope = {
  actorId: string
  surface: TicketIntakeDraftSurface
  now?: Date
}

type EncodedDraft = TicketIntakeDraft & { version: 1; savedAt: string }

export function ticketIntakeDraftKey(actorId: string, surface: TicketIntakeDraftSurface): string | null {
  const actor = normalizeUuid(actorId)
  return actor && isSurface(surface) ? `ticket-intake-draft:${actor}:${surface}` : null
}

export function encodeTicketIntakeDraft(draft: TicketIntakeDraft, now = new Date()): string | null {
  if (!isValidDraft(draft) || !isValidDate(now)) return null
  const encoded: EncodedDraft = {
    version: 1,
    savedAt: now.toISOString(),
    actorId: normalizeUuid(draft.actorId)!,
    surface: draft.surface,
    form: normalizeForm(draft.form),
    pending: normalizePending(draft.pending),
  }
  const raw = JSON.stringify(encoded)
  return byteLength(raw) <= MAX_BYTES ? raw : null
}

export function parseTicketIntakeDraft(raw: unknown, scope: TicketIntakeDraftScope): TicketIntakeDraft | null {
  try {
    if (typeof raw !== 'string' || byteLength(raw) > MAX_BYTES || !isValidScope(scope)) return null
    const value: unknown = JSON.parse(raw)
    if (!isEncodedDraft(value)) return null
    const now = scope.now ?? new Date()
    if (!isValidDate(now)) return null
    const savedAt = new Date(value.savedAt)
    const age = now.getTime() - savedAt.getTime()
    if (!Number.isFinite(savedAt.getTime()) || age < 0 || age > MAX_AGE_MS) return null
    const actorId = normalizeUuid(value.actorId)
    if (!actorId || actorId !== normalizeUuid(scope.actorId) || value.surface !== scope.surface) return null
    return {
      actorId,
      surface: value.surface,
      form: normalizeForm(value.form),
      pending: normalizePending(value.pending),
    }
  } catch {
    return null
  }
}

function isEncodedDraft(value: unknown): value is EncodedDraft {
  if (!isExactObject(value, ['version', 'savedAt', 'actorId', 'surface', 'form', 'pending'])) return false
  return value.version === 1
    && typeof value.savedAt === 'string'
    && normalizeUuid(value.actorId) !== null
    && isSurface(value.surface)
    && isValidForm(value.form)
    && isPending(value.pending)
}

function isValidDraft(value: unknown): value is TicketIntakeDraft {
  return isExactObject(value, ['actorId', 'surface', 'form', 'pending'])
    && normalizeUuid(value.actorId) !== null
    && isSurface(value.surface)
    && isValidForm(value.form)
    && isPending(value.pending)
}

function isValidScope(value: unknown): value is TicketIntakeDraftScope {
  if (!isExactObject(value, ['actorId', 'surface', 'now']) && !isExactObject(value, ['actorId', 'surface'])) {
    return false
  }
  return normalizeUuid(value.actorId) !== null
    && isSurface(value.surface)
    && (value.now === undefined || value.now instanceof Date)
}

function isValidForm(value: unknown): value is TicketIntakeDraft['form'] {
  if (!isExactObject(value, [
    'existingVehicleId', 'name', 'phone', 'email', 'year', 'make', 'model', 'engine', 'vin', 'mileage',
    'plate', 'concern', 'assignedTechId', 'intent', 'diagnosticMode', 'knownWorkMode', 'selectedDiagnostic',
    'selectedKnownWork', 'customDiagnosticDescription', 'customDiagnosticHours', 'customDiagnosticPrice',
    'requestedServiceKind', 'requestedServiceDescription', 'customerSuppliedPartsNote', 'quoteMode',
    'selectedCannedJob', 'workKind', 'requestedWork',
  ])) return false
  return nullableUuid(value.existingVehicleId)
    && stringWithin(value.name, 200)
    && stringWithin(value.phone, 100)
    && stringWithin(value.email, 320)
    && stringWithin(value.year, 4)
    && stringWithin(value.make, 100)
    && stringWithin(value.model, 100)
    && stringWithin(value.engine, 200)
    && stringWithin(value.vin, 17)
    && stringWithin(value.mileage, 10)
    && stringWithin(value.plate, 32)
    && stringWithin(value.concern, 2_000)
    && nullableUuid(value.assignedTechId)
    && (value.intent === 'diagnosis' || value.intent === 'known')
    && (value.diagnosticMode === 'canned' || value.diagnosticMode === 'manual')
    && (value.knownWorkMode === 'canned' || value.knownWorkMode === 'manual')
    && isSavedWork(value.selectedDiagnostic)
    && isSavedWork(value.selectedKnownWork)
    && stringWithin(value.customDiagnosticDescription, 500)
    && stringWithin(value.customDiagnosticHours, 16)
    && stringWithin(value.customDiagnosticPrice, 16)
    && (value.requestedServiceKind === 'repair' || value.requestedServiceKind === 'maintenance')
    && stringWithin(value.requestedServiceDescription, 500)
    && stringWithin(value.customerSuppliedPartsNote, 500)
    && (value.quoteMode === 'canned' || value.quoteMode === 'manual')
    && isSavedWork(value.selectedCannedJob)
    && (value.workKind === 'repair' || value.workKind === 'maintenance')
    && stringWithin(value.requestedWork, 200)
}

function isSavedWork(value: unknown): value is SavedWork | null {
  return value === null || (
    isExactObject(value, ['id', 'fingerprint'])
    && normalizeUuid(value.id) !== null
    && typeof value.fingerprint === 'string'
    && FINGERPRINT.test(value.fingerprint)
  )
}

function isPending(value: unknown): value is TicketIntakeDraft['pending'] {
  return value === null || (
    isExactObject(value, ['signature', 'clientKey'])
    && typeof value.signature === 'string'
    && value.signature.length > 0
    && value.signature.length <= 8_192
    && normalizeUuid(value.clientKey) !== null
  )
}

function normalizeForm(form: TicketIntakeDraft['form']): TicketIntakeDraft['form'] {
  return {
    ...form,
    existingVehicleId: normalizeNullableUuid(form.existingVehicleId),
    assignedTechId: normalizeNullableUuid(form.assignedTechId),
    selectedDiagnostic: normalizeSavedWork(form.selectedDiagnostic),
    selectedKnownWork: normalizeSavedWork(form.selectedKnownWork),
    selectedCannedJob: normalizeSavedWork(form.selectedCannedJob),
  }
}

function normalizeSavedWork(value: SavedWork | null): SavedWork | null {
  return value && { ...value, id: normalizeUuid(value.id)! }
}

function normalizePending(value: TicketIntakeDraft['pending']): TicketIntakeDraft['pending'] {
  return value && { ...value, clientKey: normalizeUuid(value.clientKey)! }
}

function normalizeNullableUuid(value: string | null): string | null {
  return value === null ? null : normalizeUuid(value)!
}

function nullableUuid(value: unknown): boolean {
  return value === null || (typeof value === 'string' && normalizeUuid(value) !== null)
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
}

function isSurface(value: unknown): value is TicketIntakeDraftSurface {
  return value === 'write_up' || value === 'quick_ticket'
}

function stringWithin(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function isExactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime())
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
