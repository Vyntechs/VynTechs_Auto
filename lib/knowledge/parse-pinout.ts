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
      content: Array<
        | { type: 'text'; text?: string }
        | { type: 'tool_use'; name?: string; input?: unknown; id?: string }
      >
    }>
  }
}

export const PARSE_PINOUT_SYSTEM = `You convert raw OEM pinout text — pasted by an automotive shop owner — into structured pin rows. Output is a proposal the owner reviews and edits before saving.

You submit your proposal by calling the submit_parsed_pinout tool. Do NOT return prose — only invoke the tool. The tool's input schema enforces the JSON shape, so you cannot produce malformed output.

FIELD GUIDANCE:
- status: "parsed" when you extracted at least one pin row. "failed" when paste is empty / gibberish / fundamentally not a pinout (e.g. theory text was pasted by mistake).
- draft.connector_ref: a name or OEM ID for the connector (e.g. "BCM C2280", "Alternator 4-pin"). Omit if you can't infer it.
- draft.pins[].pin_number: e.g. "1", "12", "A3", "C1-3". Preserve exactly as in the source.
- draft.pins[].signal_name: e.g. "12V SUPPLY", "LIN BUS", "GROUND". Preserve OEM terminology.
- draft.pins[].wire_color: preserve exactly as pasted (see RULES below).
- draft.pins[].expected_voltage_or_waveform: free text; only fill when the source explicitly states a voltage / waveform / spec.
- draft.pins[].notes: anything else the owner should see.
- sourceSpans: optional verbatim quotes from the paste, one per field where one is meaningful.
- llmNotes: 1-2 sentences if something was ambiguous.

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

Never invent pins. Do not fabricate wire colors that aren't in the source.`

const PARSE_PINOUT_TOOL = {
  name: 'submit_parsed_pinout',
  description: 'Submit the parsed pinout as a structured proposal the curator will review.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['parsed', 'failed'] },
      draft: {
        type: 'object',
        properties: {
          connector_ref: { type: 'string' },
          pins: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pin_number: { type: 'string' },
                signal_name: { type: 'string' },
                wire_color: { type: 'string' },
                expected_voltage_or_waveform: { type: 'string' },
                notes: { type: 'string' },
              },
              required: ['pin_number', 'signal_name'],
            },
          },
        },
        required: ['pins'],
      },
      sourceSpans: { type: 'object', additionalProperties: { type: 'string' } },
      llmNotes: { type: 'string' },
    },
    required: ['status', 'draft'],
  },
} as const

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
    ? `Connector hint: ${input.connectorHint}\n\nPaste:\n${trimmed}`
    : `Paste:\n${trimmed}`

  const res = await client.messages.create({
    model: HAIKU,
    // Pinouts produce structured JSON (one row per pin); 80-pin connectors
    // can exceed 2048 tokens. 8192 covers any realistic pinout pasted from
    // OEM source.
    max_tokens: 8192,
    system: cachedSystem(PARSE_PINOUT_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
    tools: [PARSE_PINOUT_TOOL],
    // Force the model to call our tool (not free-form text). The Anthropic
    // SDK validates the model's output against input_schema before returning,
    // so the response shape is structurally guaranteed — no JSON.parse, no
    // malformed-string risk.
    tool_choice: { type: 'tool', name: 'submit_parsed_pinout' },
  } as unknown as Parameters<AnthropicLike['messages']['create']>[0])

  const toolUse = res.content.find(
    (b): b is { type: 'tool_use'; name?: string; input?: unknown; id?: string } =>
      b.type === 'tool_use',
  )
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw new Error('parse-pinout: model did not call submit_parsed_pinout tool')
  }

  const parsed = toolUse.input as Partial<ParsedPinoutResult>

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
