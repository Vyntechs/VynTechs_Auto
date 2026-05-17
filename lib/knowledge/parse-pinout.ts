import { anthropic, cachedSystem } from '@/lib/ai/client'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export type ProposedPinRow = {
  pin_number: string
  signal_name: string
  wire_color?: string
  expected_voltage_or_waveform?: string
  notes?: string
}

export type ParsedPinoutResult = {
  status: 'parsed' | 'failed'
  draft: {
    connector_ref?: string
    pins: ProposedPinRow[]
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

export const PARSE_PINOUT_SYSTEM = `You convert raw OEM pinout text — pasted by an automotive shop owner — into structured pin rows. Output is a proposal the owner reviews and edits before saving.

OUTPUT FORMAT — return valid JSON matching this TypeScript type:

type Result = {
  status: "parsed" | "failed"
  draft: {
    connector_ref?: string         // a name or OEM ID for the connector (e.g. "BCM C2280", "Alternator 4-pin"); omit if you can't infer it
    pins: Array<{
      pin_number: string           // e.g. "1", "12", "A3", "C1-3" — preserve exactly as in the source
      signal_name: string          // e.g. "12V SUPPLY", "LIN BUS", "GROUND" — preserve OEM terminology
      wire_color?: string          // preserve exactly as pasted (see RULES below)
      expected_voltage_or_waveform?: string   // free text; only fill when the source explicitly states a voltage / waveform / spec
      notes?: string               // anything else the owner should see
    }>
  }
  sourceSpans: { [fieldName: string]: string }   // optional verbatim quotes from the paste
  llmNotes?: string                              // 1-2 sentences if something was ambiguous
}

RULES — these reflect REAL variation in OEM pinout pastes across Mitchell1, AllData, Ford TIS, GM SI, and Identifix:

1. Don't require a header row. Real pastes are often body-only — techs select rows, not the table header. Infer column meaning from content shape: a token starting with a digit or letter-then-digit ("1", "12", "A3", "C1-3") is a pin number.

2. Wire color conventions vary by manufacturer. Preserve color tokens EXACTLY as pasted. Do NOT canonicalize. Examples that are all valid:
   - GM: "BLK", "LT GRN", "DK BLU/WHT", "PNK/BLK" (space-separated "LT"/"DK" modifiers are part of the color, NOT separators)
   - Ford: "YEL", "GRY/BLK", "LT GRN/RED"
   - Toyota: "B" (Black), "W", "R", "G" (Green), "L" (Blue), "R/G" (Red w/ Green tracer)
   - Chrysler: "BK", "BK*" (asterisk = tracer), "BK/RD*"
   - SAE J1128: "BRN", "WHT", "BLU", "GRY"

3. SLASH IS A TRACER SEPARATOR — keep slashes intact. "DK BLU/WHT" is ONE color (dark blue with white tracer), NOT two fields. Never split on slash.

4. GM CIRCUIT-NUMBER COLUMN TRAP. Real GM tables often have 4 columns: Pin | Color | Circuit# | Function. The circuit number is a 3-4 digit integer (e.g. "1867", "451") that is NOT pin data. If a column between color and function contains only 3-4 digit integers with no alphabetic characters, treat it as an OEM circuit reference and DROP it — do NOT stuff it into expected_voltage_or_waveform.

5. Empty cells stay empty. "—", "N/A", "N.C.", or blank — all map to OMITTED optional fields. Never coerce to "0" or "null".

6. Prose-embedded pin descriptions count. "Pin 3 is the 5V reference (LT GRN wire)" → { pin_number: "3", signal_name: "5V reference", wire_color: "LT GRN" }.

7. Non-breaking spaces ( ) in pasted OEM HTML should be treated as regular spaces.

8. Connector ID inline. "C1-3" means Connector 1, Pin 3 — preserve as pin_number "C1-3"; the form has a separate connector_ref field.

STATUS:
- "parsed" if you extracted at least one pin row.
- "failed" if the paste is empty, gibberish, or fundamentally not a pinout (e.g. someone pasted theory text by mistake).

Never invent pins. Do not fabricate wire colors that aren't in the source.

Return JSON only — no prose, no fences.`

export type ParsePinoutInput = {
  rawText: string
  connectorHint?: string
}

export async function parsePinout(
  input: ParsePinoutInput,
  client: AnthropicLike = anthropic as unknown as AnthropicLike,
): Promise<ParsedPinoutResult> {
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: { pins: [] }, sourceSpans: {} }
  }

  const userContent = input.connectorHint
    ? `Connector hint: ${input.connectorHint}\n\nPaste:\n${trimmed}\n\nReturn JSON only.`
    : `Paste:\n${trimmed}\n\nReturn JSON only.`

  const res = await client.messages.create({
    model: HAIKU,
    // Pinouts produce structured JSON (one row per pin); 80-pin connectors
    // can exceed 2048 tokens. 8192 covers any realistic pinout pasted from
    // OEM source.
    max_tokens: 8192,
    system: cachedSystem(PARSE_PINOUT_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
  })

  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('parse-pinout returned no text block')
  }

  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  const parsed = JSON.parse(cleaned) as Partial<ParsedPinoutResult>

  if (parsed.status !== 'parsed' && parsed.status !== 'failed') {
    throw new Error(`parse-pinout returned invalid status: ${String(parsed.status)}`)
  }

  const draft = (parsed.draft ?? { pins: [] }) as ParsedPinoutResult['draft']
  if (!Array.isArray(draft.pins)) {
    throw new Error('parse-pinout draft.pins must be an array')
  }
  if (parsed.status === 'parsed' && draft.pins.length === 0) {
    throw new Error('parse-pinout returned parsed status with at least one pin missing')
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
