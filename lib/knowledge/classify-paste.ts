import { anthropic, cachedSystem } from '@/lib/ai/client'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
export type SimpleType = (typeof SIMPLE_TYPES)[number]

export const MIN_PASTE_CHARS = 30
export const MIN_PASTE_WORDS = 6

export type ProposedVehicleScope = {
  yearStart: number
  yearEnd: number
  make: string
  model?: string
  engine?: string
  trim?: string
  drivetrain?: string
}

export type ClassifiedPasteResult = {
  status: 'parsed' | 'failed' | 'paste_too_short'
  draft: {
    type?: SimpleType
    title?: string
    body?: string
    structuredData?: Record<string, unknown>
    dtcList?: string[]
    systemCodes?: string[]
    symptoms?: string[]
    vehicleScopes?: ProposedVehicleScope[]
  }
  sourceSpans: Record<string, string>
  llmNotes?: string
}

export type AnthropicLike = {
  messages: {
    create: (args: unknown) => Promise<{
      content: Array<
        | { type: 'text'; text?: string }
        | { type: 'tool_use'; name?: string; input?: unknown; id?: string }
      >
    }>
  }
}

export const CLASSIFY_PASTE_SYSTEM = `You convert an automotive shop owner's pasted reference text into a structured draft for a vehicle-knowledge entry. Output is a proposal the owner reviews and edits before saving.

ALLOWED TYPES (exactly one):
- "cause_fix" — a complaint/cause/correction case: "X symptom on Y vehicle = check Z first; fix is W". Use when the paste names a specific failure pattern with a verified cause and corrective action.
- "bulletin" — a TSB / recall / OEM campaign reference. Use when the paste cites a bulletin ID, a recall, or an OEM campaign.
- "reference_doc" — a short generic technical reference that doesn't fit cause_fix or bulletin. Use when the paste is general technical info (a snippet from a service manual, a wiring color code chart, a torque spec note).
- "note" — anything that doesn't fit the three structured types. Free-form text.

You submit your proposal by calling the submit_classified_paste tool with the structured fields below. Do NOT return prose — only invoke the tool. The tool's input schema enforces the JSON shape, so you cannot produce malformed output.

FIELD GUIDANCE:
- status: "parsed" when you extract at least title and type. "failed" when paste is empty / gibberish / impossible to classify.
- draft.type: one of cause_fix, reference_doc, bulletin, note. Never propose pinout/connector/wiring_diagram/theory_of_operation — those are handled by a different flow.
- draft.title: <= 120 chars, names the vehicle scope + symptom/system if applicable.
- draft.body: populate for "note" and "reference_doc"; omit for "cause_fix" and "bulletin".
- draft.structuredData for cause_fix: { complaint, cause, correction, first_check, dtcs_common[] }
- draft.structuredData for bulletin: { source (OEM name), bulletin_id (e.g. "TSB 21-2299"), summary, body, link }
- draft.dtcList: bare OBD-II codes ("P0420" not "P0420-00"). Uppercase. Do not invent codes.
- draft.systemCodes: from the fixed set { transmission, engine, can_bus, fuel_delivery, ignition, charging, hvac, brakes, suspension, body_electrical, cooling, emissions, lighting, steering, abs, sas, hybrid_drive, restraint, infotainment, network }.
- draft.symptoms: short snake_case tags ("hard_shift", "no_start", "rough_idle").
- draft.vehicleScopes: extract from the paste. If a scope hint is supplied by the user, prefer that scope unless the paste contradicts. Canonical makes/models ("Ford", "F-150", "6.7L Powerstroke").
- sourceSpans: short verbatim quotes from the paste, one per field where one is meaningful. Skip fields with no clear source.
- llmNotes: 1-2 sentences for the owner if something was ambiguous.

Never fabricate. If the paste doesn't name a field, omit it from the tool input.`

const VEHICLE_SCOPE_SCHEMA = {
  type: 'object',
  properties: {
    yearStart: { type: 'integer' },
    yearEnd: { type: 'integer' },
    make: { type: 'string' },
    model: { type: 'string' },
    engine: { type: 'string' },
    trim: { type: 'string' },
    drivetrain: { type: 'string' },
  },
  required: ['yearStart', 'yearEnd', 'make'],
} as const

const CLASSIFY_PASTE_TOOL = {
  name: 'submit_classified_paste',
  description: 'Submit the classified paste as a structured proposal the curator will review.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['parsed', 'failed'] },
      draft: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...SIMPLE_TYPES] },
          title: { type: 'string' },
          body: { type: 'string' },
          structuredData: { type: 'object', additionalProperties: true },
          dtcList: { type: 'array', items: { type: 'string' } },
          systemCodes: { type: 'array', items: { type: 'string' } },
          symptoms: { type: 'array', items: { type: 'string' } },
          vehicleScopes: { type: 'array', items: VEHICLE_SCOPE_SCHEMA },
        },
      },
      sourceSpans: { type: 'object', additionalProperties: { type: 'string' } },
      llmNotes: { type: 'string' },
    },
    required: ['status', 'draft'],
  },
} as const

export type ClassifyPasteInput = {
  rawText: string
  scopeHint?: string
}

export async function classifyPaste(
  input: ClassifyPasteInput,
  client: AnthropicLike = anthropic as unknown as AnthropicLike,
): Promise<ClassifiedPasteResult> {
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: {}, sourceSpans: {} }
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (trimmed.length < MIN_PASTE_CHARS || wordCount < MIN_PASTE_WORDS) {
    return { status: 'paste_too_short', draft: {}, sourceSpans: {} }
  }

  const userContent = input.scopeHint
    ? `Scope hint: ${input.scopeHint}\n\nPaste:\n${trimmed}`
    : `Paste:\n${trimmed}`

  const res = await client.messages.create({
    model: HAIKU,
    // Haiku 4.5 supports up to 32k output tokens. 8192 is conservative
    // headroom; the tool-use path produces structured fields so the
    // model isn't paying tokens for JSON syntax.
    max_tokens: 8192,
    system: cachedSystem(CLASSIFY_PASTE_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
    tools: [CLASSIFY_PASTE_TOOL],
    // Force the model to call our tool (not free-form text). The Anthropic
    // SDK validates input against input_schema before returning, so the
    // shape we get back is structurally guaranteed — no JSON.parse,
    // no malformed-string risk, no unterminated-string crashes.
    tool_choice: { type: 'tool', name: 'submit_classified_paste' },
  } as unknown as Parameters<AnthropicLike['messages']['create']>[0])

  const toolUse = res.content.find(
    (b): b is { type: 'tool_use'; name?: string; input?: unknown; id?: string } =>
      b.type === 'tool_use',
  )
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw new Error(
      'classify-paste: model did not call submit_classified_paste tool',
    )
  }

  const parsed = toolUse.input as Partial<ClassifiedPasteResult>

  if (parsed.status !== 'parsed' && parsed.status !== 'failed') {
    throw new Error(`classify-paste returned invalid status: ${String(parsed.status)}`)
  }

  const draft = (parsed.draft ?? {}) as ClassifiedPasteResult['draft']

  if (draft.type && !SIMPLE_TYPES.includes(draft.type)) {
    throw new Error(
      `classify-paste proposed a non-simple type "${String(draft.type)}"; only ${SIMPLE_TYPES.join(', ')} are allowed in this flow`,
    )
  }

  return {
    status: parsed.status,
    draft,
    sourceSpans:
      parsed.sourceSpans && typeof parsed.sourceSpans === 'object'
        ? (parsed.sourceSpans as Record<string, string>)
        : {},
    llmNotes: typeof parsed.llmNotes === 'string' ? parsed.llmNotes : undefined,
  }
}
