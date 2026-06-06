import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from '@/lib/ai/client'
import type {
  SystemDataDraft,
  DraftComponent,
  DraftConnection,
  DraftObservableProperty,
  SystemDataProvenance,
} from '@/lib/diagnostics/promote-system-data'
import {
  components as componentsTable,
  componentConnections,
  observableProperties as observablePropertiesTable,
} from '@/lib/db/schema'
import type { ResearchAgentOutput } from './types'

/**
 * Standalone system-data synthesis (PR3). Reads a completed research run's
 * agent outputs and emits a DRAFT-ONLY SystemDataDraft (components +
 * connections + observable properties, each provenance-tagged).
 *
 * It NEVER approves, NEVER writes to any DB, and NEVER makes a real AI/network
 * call under test (the AI caller is injected). Anti-fabrication is enforced
 * DETERMINISTICALLY after the pass — the prompt is asked to behave, but the
 * code is what guarantees it: the draft envelope is stamped by us, every
 * model-emitted TRAINING-CONFIRMED is capped to TRAINING-INFERRED (this pass has
 * no per-item source attribution, so it cannot prove a specific item is
 * corpus-backed — see resolveProvenance), FIELD-VERIFIED and unknown enums
 * collapse to GAP or drop the item, and identity collisions are de-duped so the
 * emitted draft is structurally valid by construction.
 *
 * Mirrors lib/research/synthesis-runner.ts (the flow synthesis) — the JSON-fence
 * parsing is copied locally (NOT imported as a private helper) so this is a true
 * new-file sibling.
 */

/** Minimal injection seam: returns the model's raw text for one pass. */
export type AiComplete = (args: {
  system: string
  user: string
  maxTokens: number
}) => Promise<string>

export type SystemDataSynthesisInput = {
  /** slug-keyed; copied verbatim onto the draft (NEVER fabricated). */
  platformSlug: string
  /** for prompt context only. */
  platformDisplay: string
  /** for prompt context only. */
  symptomDisplay: string
  agents: ResearchAgentOutput[]
}

export type SystemDataSynthesisOutput = {
  /** status ALWAYS 'draft'; approvedBy NEVER set. */
  draft: SystemDataDraft
  /** best-effort; 0s under injection unless the caller reports them. */
  tokenUsage: { inputTokens: number; outputTokens: number }
}

const SYSTEM_PROMPT = `
You are a senior diagnostic engineer translating parallel research agents' findings into structured SYSTEM DATA: the components of a vehicle subsystem, the connections between them, and the observable properties you can measure on them.

Output a JSON object with EXACTLY these two arrays (no envelope fields — no "status", no "approvedBy", no "platformSlug"; those are added by the system):
{
  "components": [
    {
      "slug": "low-pressure-fuel-pump",        // kebab-case, stable identity
      "name": "Low-Pressure (Lift) Pump",
      "kind": "sensor|actuator|pump|valve|module|mechanical|splice|connector",
      "systems": ["fuel"],
      "location": "...",            (optional)
      "function": "...",            (optional)
      "unknownNote": "...",         (REQUIRED when sourceProvenance is GAP — say what is missing)
      "sourceProvenance": "TRAINING-CONFIRMED|TRAINING-INFERRED|GAP",
      "inferenceClass": "LAW|LOGIC|PATTERN",   (set ONLY when sourceProvenance is TRAINING-INFERRED)
      "observableProperties": [
        {
          "slug": "fuel-rail-pressure",        // globally unique kebab-case
          "description": "...",
          "observationMethod": "scan_tool_pid|pressure_test_with_gauge|electrical_measurement_at_pin|waveform_capture|direct_visual_internal|direct_visual_external|audible|touch|smell",
          "sourceProvenance": "TRAINING-CONFIRMED|TRAINING-INFERRED|GAP",
          "inferenceClass": "LAW|LOGIC|PATTERN"  (only when TRAINING-INFERRED)
        }
      ]
    }
  ],
  "connections": [
    {
      "fromComponentSlug": "low-pressure-fuel-pump",   // MUST be a slug present in components[]
      "toComponentSlug": "fuel-rail",                  // MUST be a slug present in components[]
      "connectionKind": "electrical-wire|fluid-line|mechanical-linkage|can-bus|lin-bus|reports_to|controlled_by",
      "direction": "unidirectional|bidirectional",     (optional)
      "electricalRole": "signal|5v-ref|low-ref|pwm|12v|ground",  (optional)
      "description": "...",         (optional)
      "sourceProvenance": "TRAINING-CONFIRMED|TRAINING-INFERRED|GAP",
      "inferenceClass": "LAW|LOGIC|PATTERN"  (only when TRAINING-INFERRED)
    }
  ]
}

ANTI-FABRICATION IS THE SPINE — these rules are absolute:
- Emit only components/connections/observable-properties that a finding's CLAIM TEXT actually supports.
- TRAINING-CONFIRMED: the corpus genuinely states it (a finding directly names this component/wire/reading, cited by a source the agent fetched). This is the ONLY "the corpus supports it" grade.
- TRAINING-INFERRED: logically derived but not stated verbatim (e.g. a sensor implies a ground return). Set inferenceClass to LAW / LOGIC / PATTERN.
- GAP: the corpus is SILENT. Use a real, flagged row with unknownNote describing what is missing. NEVER invent a wire, pin, or numeric reading to fill a hole.
- Connections the corpus does not establish → either omit, or if the topology demands the endpoint exists but the link is unknown, emit with sourceProvenance "GAP".
- NEVER output "FIELD-VERIFIED" — research is training-grounded, not bench-verified.
- Every connection's endpoints MUST be slugs that appear in components[]. No self-loops.

Output ONLY the JSON object, no commentary.
`.trim()

const PROVENANCE_VALUES = componentsTable.sourceProvenance.enumValues
const COMPONENT_KINDS = componentsTable.kind.enumValues
const INFERENCE_VALUES = componentsTable.inferenceClass.enumValues
const OBSERVATION_METHODS = observablePropertiesTable.observationMethod.enumValues
const HOUSING_OPACITY_VALUES = observablePropertiesTable.housingOpacityStatus.enumValues
const CONNECTION_KINDS = componentConnections.connectionKind.enumValues
const DIRECTION_VALUES = componentConnections.direction.enumValues
const ELECTRICAL_ROLES = componentConnections.electricalRole.enumValues

type RawModelDraft = {
  components?: unknown[]
  connections?: unknown[]
}

/**
 * Emit a draft-only SystemDataDraft from a research run's agent outputs.
 * Defaults to the shared lib/ai client; pass `ai` to inject (used by tests).
 */
export async function synthesizeSystemData(
  input: SystemDataSynthesisInput,
  ai?: AiComplete,
): Promise<SystemDataSynthesisOutput> {
  const tokenUsage = { inputTokens: 0, outputTokens: 0 }

  const call: AiComplete =
    ai ??
    (async ({ system, user, maxTokens }) => {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      })
      tokenUsage.inputTokens += resp.usage.input_tokens
      tokenUsage.outputTokens += resp.usage.output_tokens
      return lastTextBlock(resp) ?? ''
    })

  const findingsPayload = input.agents
    .filter((a) => a.status !== 'failed')
    .map((a) => ({ persona: a.persona, findings: a.findings }))

  const rawText = await call({
    system: SYSTEM_PROMPT,
    user: `Vehicle: ${input.platformDisplay}\nSymptom: ${input.symptomDisplay}\n\nAgents' findings:\n${JSON.stringify(
      findingsPayload,
      null,
      2,
    )}`,
    maxTokens: 12_000,
  })

  const raw = extractJsonObject<RawModelDraft>(rawText)

  // Deterministic enforcement — the real guard, not prompt-trust.
  const components = dedupeComponents(
    (Array.isArray(raw.components) ? raw.components : [])
      .map((c) => sanitizeComponent(c))
      .filter((c): c is DraftComponent => c !== null),
  )

  const componentSlugs = new Set(components.map((c) => c.slug))
  const connections = dedupeConnections(
    (Array.isArray(raw.connections) ? raw.connections : [])
      .map((c) => sanitizeConnection(c))
      .filter((c): c is DraftConnection => c !== null)
      // Drop self-loops and dangling endpoints (validateDraft would reject them).
      .filter(
        (c) =>
          c.fromComponentSlug !== c.toComponentSlug &&
          componentSlugs.has(c.fromComponentSlug) &&
          componentSlugs.has(c.toComponentSlug),
      ),
  )

  // Stamp the envelope OURSELVES — never the model. platformSlug verbatim,
  // status hardcoded 'draft', approvedBy omitted.
  const draft: SystemDataDraft = {
    platformSlug: input.platformSlug,
    status: 'draft',
    components,
    connections,
  }

  return { draft, tokenUsage }
}

// ---------------------------------------------------------------------------
// Sanitizers — coerce each model item into a structurally-valid draft item, or
// drop it. Provenance is the spine: an unrecognized provenance (and any
// FIELD-VERIFIED, which research may never claim) becomes GAP (honest "we don't
// know"). A model-emitted TRAINING-CONFIRMED is ALWAYS downgraded to
// TRAINING-INFERRED: this synthesis pass has no per-item source attribution, so
// it cannot prove that THIS specific component/wire/reading is the one a fetched
// source backs. A whole-run "some URL exists" fact would launder CONFIRMED onto
// items the corpus is silent on, which is exactly the fabrication the product
// thesis forbids. CONFIRMED is reserved for a later step that can match a
// finding's claim text to a source (see the schema-gap note below).
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asStringOrNull(v: unknown): string | null | undefined {
  if (v === null) return null
  return typeof v === 'string' ? v : undefined
}

/**
 * Coerce provenance. The model is never trusted to grade its own corpus support:
 * - unrecognized value, or FIELD-VERIFIED (research is never bench-verified) → GAP.
 * - TRAINING-CONFIRMED → TRAINING-INFERRED. This pass carries no per-item source
 *   attribution, so it cannot prove a specific item is the one a fetched source
 *   backs; the only honest deterministic cap is TRAINING-INFERRED. Promoting an
 *   item to CONFIRMED needs claim-text→source matching that the SystemDataDraft
 *   schema does not yet carry (reported as a blocking PR2/PR4 schema gap).
 * - TRAINING-INFERRED, GAP → pass through.
 */
function resolveProvenance(raw: unknown): SystemDataProvenance {
  const value = asString(raw)
  if (
    value === undefined ||
    !PROVENANCE_VALUES.includes(value as SystemDataProvenance) ||
    value === 'FIELD-VERIFIED'
  ) {
    return 'GAP'
  }
  if (value === 'TRAINING-CONFIRMED') {
    return 'TRAINING-INFERRED'
  }
  return value as SystemDataProvenance
}

function coerceEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | undefined {
  const value = asString(raw)
  return value !== undefined && allowed.includes(value as T) ? (value as T) : undefined
}

function resolveInferenceClass(
  raw: unknown,
  provenance: SystemDataProvenance,
): DraftComponent['inferenceClass'] {
  if (provenance !== 'TRAINING-INFERRED') return undefined
  return coerceEnum(raw, INFERENCE_VALUES)
}

function sanitizeObservableProperty(raw: unknown): DraftObservableProperty | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const slug = asString(r.slug)
  const description = asString(r.description)
  const observationMethod = coerceEnum(r.observationMethod, OBSERVATION_METHODS)
  // Required fields the validator/DB demand; drop a malformed item rather than
  // emit something validateDraft would reject on a required enum.
  if (!slug || !description || !observationMethod) return null

  const provenance = resolveProvenance(r.sourceProvenance)
  return {
    slug,
    description,
    observationMethod,
    housingOpacityStatus: coerceEnum(r.housingOpacityStatus, HOUSING_OPACITY_VALUES),
    sourceProvenance: provenance,
    inferenceClass: resolveInferenceClass(r.inferenceClass, provenance),
  }
}

function sanitizeComponent(raw: unknown): DraftComponent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const slug = asString(r.slug)
  const name = asString(r.name)
  const kind = coerceEnum(r.kind, COMPONENT_KINDS)
  if (!slug || !name || !kind) return null

  const systems = Array.isArray(r.systems)
    ? r.systems.filter((s): s is string => typeof s === 'string')
    : []

  const provenance = resolveProvenance(r.sourceProvenance)
  const observableProperties = (
    Array.isArray(r.observableProperties) ? r.observableProperties : []
  )
    .map((op) => sanitizeObservableProperty(op))
    .filter((op): op is DraftObservableProperty => op !== null)

  return {
    slug,
    name,
    kind,
    systems,
    location: asStringOrNull(r.location),
    function: asStringOrNull(r.function),
    electricalContract: asStringOrNull(r.electricalContract),
    subtitle: asStringOrNull(r.subtitle),
    role: asStringOrNull(r.role),
    wireSummary: asStringOrNull(r.wireSummary),
    body: asStringOrNull(r.body),
    probingTactic: asStringOrNull(r.probingTactic),
    unknownNote: asStringOrNull(r.unknownNote),
    sourceProvenance: provenance,
    inferenceClass: resolveInferenceClass(r.inferenceClass, provenance),
    observableProperties,
  }
}

function sanitizeConnection(raw: unknown): DraftConnection | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const fromComponentSlug = asString(r.fromComponentSlug)
  const toComponentSlug = asString(r.toComponentSlug)
  const connectionKind = coerceEnum(r.connectionKind, CONNECTION_KINDS)
  if (!fromComponentSlug || !toComponentSlug || !connectionKind) return null

  const provenance = resolveProvenance(r.sourceProvenance)
  return {
    fromComponentSlug,
    toComponentSlug,
    connectionKind,
    direction: coerceEnum(r.direction, DIRECTION_VALUES),
    electricalRole: coerceEnum(r.electricalRole, ELECTRICAL_ROLES),
    description: asStringOrNull(r.description),
    sourceProvenance: provenance,
    inferenceClass: resolveInferenceClass(r.inferenceClass, provenance),
  }
}

// ---------------------------------------------------------------------------
// De-dupe by the same identity validateDraft enforces: components by slug,
// observable properties by slug (global), connections by (from, to, kind).
// First occurrence wins.
// ---------------------------------------------------------------------------

function dedupeComponents(components: DraftComponent[]): DraftComponent[] {
  const seenComponents = new Set<string>()
  const seenOps = new Set<string>()
  const out: DraftComponent[] = []
  for (const c of components) {
    if (seenComponents.has(c.slug)) continue
    seenComponents.add(c.slug)
    const observableProperties: DraftObservableProperty[] = []
    for (const op of c.observableProperties) {
      if (seenOps.has(op.slug)) continue
      seenOps.add(op.slug)
      observableProperties.push(op)
    }
    out.push({ ...c, observableProperties })
  }
  return out
}

function dedupeConnections(connections: DraftConnection[]): DraftConnection[] {
  const seen = new Set<string>()
  const out: DraftConnection[] = []
  for (const c of connections) {
    const key = `${c.fromComponentSlug} ${c.toComponentSlug} ${c.connectionKind}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

// ---------------------------------------------------------------------------
// Local helpers copied from synthesis-runner.ts (anti-fabrication parity).
// Copied — NOT imported — so this stays a standalone new file.
// ---------------------------------------------------------------------------

function extractJsonObject<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('No JSON object in system-data synthesis response')
  return JSON.parse(m[0]) as T
}

function lastTextBlock(resp: Anthropic.Messages.Message): string | null {
  const blocks = Array.isArray(resp.content) ? resp.content : []
  const block = [...blocks].reverse().find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : null
}
