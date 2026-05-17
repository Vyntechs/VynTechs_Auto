import { anthropic, cachedSystem } from '@/lib/ai/client'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
export type SimpleType = (typeof SIMPLE_TYPES)[number]

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
  status: 'parsed' | 'failed'
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
      content: Array<{ type: string; text?: string }>
    }>
  }
}

export const CLASSIFY_PASTE_SYSTEM = `You convert an automotive shop owner's pasted reference text into a structured draft for a vehicle-knowledge entry. Output is a proposal the owner reviews and edits before saving.

ALLOWED TYPES (exactly one):
- "cause_fix" — a complaint/cause/correction case: "X symptom on Y vehicle = check Z first; fix is W". Use when the paste names a specific failure pattern with a verified cause and corrective action.
- "bulletin" — a TSB / recall / OEM campaign reference. Use when the paste cites a bulletin ID, a recall, or an OEM campaign.
- "reference_doc" — a short generic technical reference that doesn't fit cause_fix or bulletin. Use when the paste is general technical info (a snippet from a service manual, a wiring color code chart, a torque spec note).
- "note" — anything that doesn't fit the three structured types. Free-form text.

OUTPUT FORMAT — return valid JSON matching this TypeScript type:

type Result = {
  status: "parsed" | "failed"
  draft: {
    type: "cause_fix" | "reference_doc" | "bulletin" | "note"
    title: string                  // <= 120 chars, names the vehicle scope + symptom/system if applicable
    body?: string                  // populate for "note" and "reference_doc"; omit for "cause_fix" and "bulletin"
    structuredData?: {
      // for cause_fix:
      complaint?: string
      cause?: string
      correction?: string
      first_check?: string
      dtcs_common?: string[]
      // for bulletin:
      source?: string              // OEM name (Ford, GM, Toyota, ...)
      bulletin_id?: string         // e.g. "TSB 21-2299"
      summary?: string
      body?: string                // bulletin body (separate from top-level body)
      link?: string
    }
    dtcList?: string[]             // OBD-II codes mentioned, bare form (no "-XX" suffix), uppercase
    systemCodes?: string[]         // pick from: transmission, engine, can_bus, fuel_delivery, ignition, charging, hvac, brakes, suspension, body_electrical, cooling, emissions, lighting, steering, abs, sas, hybrid_drive, restraint, infotainment, network
    symptoms?: string[]            // short snake_case tags (e.g. "hard_shift", "no_start", "rough_idle")
    vehicleScopes?: Array<{
      yearStart: number            // e.g. 2011
      yearEnd: number              // single year = yearStart == yearEnd
      make: string                 // canonical: "Ford", "Chevrolet", "Toyota"
      model?: string               // canonical: "F-150", "Silverado 1500"
      engine?: string              // canonical: "6.7L Powerstroke", "5.0L V8"
      trim?: string
      drivetrain?: string
    }>
  }
  sourceSpans: { [fieldName: string]: string }   // quoted substring from the paste that produced each proposed field
  llmNotes?: string                              // 1-2 sentences for the owner if anything was ambiguous
}

RULES:
- status: "parsed" — you extracted at least title and type.
- status: "failed" — paste is empty / gibberish / impossible to extract type and title.
- DTCs: bare form ("P0420", not "P0420-00"). Uppercase. Do not invent codes.
- Vehicle scope: extract from the paste; if a scope hint is supplied by the user, prefer that scope unless the paste contradicts.
- Never propose a type outside the four allowed values. The rich types (pinout, connector, wiring_diagram, theory_of_operation) are handled by a different flow — do not return them.
- sourceSpans: short verbatim quotes from the paste, one per field where one is meaningful. Skip fields that have no clear source.
- Do not fabricate. If the paste doesn't name a field, omit it.

Return JSON only — no prose, no fences.`

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

  const userContent = input.scopeHint
    ? `Scope hint: ${input.scopeHint}\n\nPaste:\n${trimmed}\n\nReturn JSON only.`
    : `Paste:\n${trimmed}\n\nReturn JSON only.`

  const res = await client.messages.create({
    model: HAIKU,
    // Output includes the verbatim body for note/reference_doc, plus title +
    // optional structuredData. For a 20k-char input paste, the draft can run
    // ~5-8k tokens. 1024 truncated mid-JSON and crashed JSON.parse with
    // "Unterminated string" on real curator pastes.
    max_tokens: 8192,
    system: cachedSystem(CLASSIFY_PASTE_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
  })

  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('classify-paste classifier returned no text block')
  }

  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  const parsed = JSON.parse(cleaned) as Partial<ClassifiedPasteResult>

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
