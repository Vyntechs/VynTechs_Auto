import { anthropic, MODEL, cachedSystem } from '@/lib/ai/client'
import type { CuratorCorpusInput } from '@/lib/curator/corpus-actions'

export type FounderStructureStatus = 'parsed' | 'partial' | 'failed'

export type FounderStructureResult = {
  status: FounderStructureStatus
  draft: Partial<CuratorCorpusInput>
  missingFields: string[]
  llmNotes?: string
}

export const REQUIRED_FIELDS: ReadonlyArray<keyof CuratorCorpusInput> = [
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleEngine',
  'rootCause',
  'summary',
  'actionType',
] as const

export const FOUNDER_STRUCTURE_SYSTEM = `You convert a shop owner's free-form repair note into a structured corpus entry for an automotive diagnostic knowledge base. The owner dictates notes via voice-to-text on their phone, so input is informal, fragmentary, and may contain transcription errors.

OUTPUT FORMAT — always return valid JSON matching this TypeScript type:

type Result = {
  status: "parsed" | "partial" | "failed"
  draft: {
    vehicleYear?: number
    vehicleMake?: string         // canonical capitalized form: "Ford", "Toyota", "Chevrolet"
    vehicleModel?: string        // canonical: "F-150", "Camry", "Silverado 1500"
    vehicleEngine?: string       // displacement + induction: "5.0L V8", "3.5L EcoBoost", "2.4L"
    symptomTags?: string[]       // 1-4 short snake_case tags from this set when applicable:
                                 //   power_loss, starting_issue, misfire, warning_light,
                                 //   overheat, leak, abnormal_noise, brake, electrical,
                                 //   transmission, hvac, fuel, emissions, suspension
    dtcs?: string[]              // OBD-II codes mentioned, normalized: "P0316", "U0100"
    rootCause: string            // 1-2 sentences naming the actual fault — what was wrong
    summary?: string             // 1-3 sentences: the case narrative, including how it
                                 // was confirmed and any pattern detail (year range,
                                 // engine variant, mileage band, conditions). Verbatim
                                 // detail from the founder's note where possible.
    actionType?: "part_replacement" | "repair" | "adjustment" | "cleaning" | "no_fix" | "referred"
    partInfo?: { name?: string; oemNumber?: string; cost?: number }
  }
  missingFields: string[]        // names of REQUIRED fields the note didn't supply
                                 // (from: vehicleYear, vehicleMake, vehicleModel,
                                 // vehicleEngine, rootCause, summary, actionType)
  llmNotes?: string              // 1-2 sentences for the founder if anything was
                                 // ambiguous, contradictory, or worth flagging
}

STATUS RULES:
- "parsed" — every required field is filled (vehicleYear, vehicleMake, vehicleModel, vehicleEngine, rootCause, summary, actionType). The entry is ready to promote.
- "partial" — at least one required field is missing but you got something useful. Fill what you can; list missing in missingFields.
- "failed" — the note isn't a repair note at all (off-topic, empty, gibberish), or you can't extract even a vehicle. Set draft to {} and missingFields to all 7 required fields.

EXTRACTION RULES:
- Year: accept ranges ("2014-2018 F-150") by picking the MIDDLE year; mention the range in summary.
- Make: canonicalize abbreviations ("chevy" → "Chevrolet", "vw" → "Volkswagen", "merc" → "Mercedes-Benz").
- DTCs: only include codes in standard P/B/C/U + 4-digit form. Do not invent codes.
- Symptom tags: max 4. Pick from the listed set. If none fit, omit the field.
- actionType: pick the dominant action. "Replaced cam phasers" → "part_replacement". "Cleaned MAF sensor" → "cleaning". "Tightened ground strap" → "repair". When in doubt prefer "repair".
- partInfo.cost: omit unless the note explicitly states a number.
- Never fabricate detail the note doesn't contain. If the founder didn't say what engine it was, omit vehicleEngine and add "vehicleEngine" to missingFields.

Return JSON only — no prose, no fences.`

export type AnthropicLike = {
  messages: {
    create: (args: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>
    }>
  }
}

/**
 * Structure a free-form founder note into a corpus draft. Pure function
 * with the Anthropic client injected so unit tests can stub it.
 *
 * Throws when the LLM returns malformed JSON or an unrecognized status —
 * the route layer maps these to a 'failed' queue row with the raw text
 * preserved, so the founder never loses what they typed.
 */
export async function structureFounderNote(
  rawText: string,
  client: AnthropicLike = anthropic as unknown as AnthropicLike,
): Promise<FounderStructureResult> {
  const trimmed = rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: {}, missingFields: [...REQUIRED_FIELDS] }
  }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: cachedSystem(FOUNDER_STRUCTURE_SYSTEM),
    messages: [{ role: 'user', content: `Founder note:\n${trimmed}\n\nReturn JSON only.` }],
  })

  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('founder structurer returned no text block')
  }

  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  const parsed = JSON.parse(cleaned) as Partial<FounderStructureResult>

  if (parsed.status !== 'parsed' && parsed.status !== 'partial' && parsed.status !== 'failed') {
    throw new Error(`founder structurer returned invalid status: ${String(parsed.status)}`)
  }

  return {
    status: parsed.status,
    draft: (parsed.draft as Partial<CuratorCorpusInput>) ?? {},
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
    llmNotes: typeof parsed.llmNotes === 'string' ? parsed.llmNotes : undefined,
  }
}
