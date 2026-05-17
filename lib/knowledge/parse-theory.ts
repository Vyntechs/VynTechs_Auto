import { anthropic, cachedSystem } from '@/lib/ai/client'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export type ProposedTheorySection = {
  heading: string
  body: string
}

export type ParsedTheoryResult = {
  status: 'parsed' | 'failed'
  draft: {
    title?: string
    sections: ProposedTheorySection[]
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

export const PARSE_THEORY_SYSTEM = `You split raw OEM "theory of operation" or "description and operation" text — pasted by an automotive shop owner — into structured sections. Output is a proposal the owner reviews and edits before saving.

You submit your proposal by calling the submit_parsed_theory tool. Do NOT return prose — only invoke the tool. The tool's input schema enforces the JSON shape, so you cannot produce malformed output.

FIELD GUIDANCE:
- status: "parsed" when you extracted at least one section with a non-empty body. "failed" when paste is empty / gibberish / fundamentally not theory text (e.g. a pinout was pasted by mistake).
- draft.title: a 1-line title for the whole document. Omit if the paste doesn't suggest one.
- draft.sections[].heading: 1-line section title.
- draft.sections[].body: section body — plain text. Preserve paragraph structure within each section using \\n\\n between paragraphs.
- sourceSpans: optional verbatim quotes from the paste, one per field where one is meaningful.
- llmNotes: 1-2 sentences if something was ambiguous.

RULES — these reflect REAL structure of OEM theory pastes (GM SI, Ford TIS, AllData, ProDemand, Toyota TIS):

1. Split on blank-line-preceded ALL-CAPS or Title Case lines. These are the section headings. Examples seen in real OEM theory text:
   - SYSTEM DESCRIPTION
   - COMPONENTS
   - SYSTEM OPERATION
   - MODES OF OPERATION
   - Description and Operation
   - System Description
   Accept ANY heading shape — don't require specific names.

2. Prose is the norm; bullets are the exception. OEM theory sections are 2-4 paragraph prose blocks per section, not bullet lists. Preserve paragraph structure within each section's body using \\n\\n between paragraphs.

3. Acronym spellings on first use are part of the body. "Engine Control Module (ECM)" — keep the spelled form in the body text, don't trim.

4. No markdown in raw paste. Bold/italic are lost in plain-text paste. The output body is plain text. Do NOT inject markdown syntax that wasn't in the source.

5. If no clear section structure exists, return ONE section with heading "Description" and the entire body. The owner can split manually in the form.

6. Non-breaking spaces ( ) in pasted OEM HTML should be treated as regular spaces.

7. Never invent content. Do not summarize. Preserve the original text verbatim within each section's body.`

const PARSE_THEORY_TOOL = {
  name: 'submit_parsed_theory',
  description: 'Submit the parsed theory of operation as a structured proposal the curator will review.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['parsed', 'failed'] },
      draft: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                heading: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['heading', 'body'],
            },
          },
        },
        required: ['sections'],
      },
      sourceSpans: { type: 'object', additionalProperties: { type: 'string' } },
      llmNotes: { type: 'string' },
    },
    required: ['status', 'draft'],
  },
} as const

export type ParseTheoryInput = {
  rawText: string
  titleHint?: string
}

export async function parseTheory(
  input: ParseTheoryInput,
  client: AnthropicLike = anthropic as unknown as AnthropicLike,
): Promise<ParsedTheoryResult> {
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: { sections: [] }, sourceSpans: {} }
  }

  const userContent = input.titleHint
    ? `Title hint: ${input.titleHint}\n\nPaste:\n${trimmed}`
    : `Paste:\n${trimmed}`

  const res = await client.messages.create({
    model: HAIKU,
    // Theory pastes preserve OEM prose verbatim per section, so output scales
    // ~1:1 with input. 8192 covers the full 20k-char input cap with headroom.
    max_tokens: 8192,
    system: cachedSystem(PARSE_THEORY_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
    tools: [PARSE_THEORY_TOOL],
    // Force the model to call our tool (not free-form text). The Anthropic
    // SDK validates the model's output against input_schema before returning,
    // so the response shape is structurally guaranteed — no JSON.parse, no
    // malformed-string risk.
    tool_choice: { type: 'tool', name: 'submit_parsed_theory' },
  } as unknown as Parameters<AnthropicLike['messages']['create']>[0])

  const toolUse = res.content.find(
    (b): b is { type: 'tool_use'; name?: string; input?: unknown; id?: string } =>
      b.type === 'tool_use',
  )
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    throw new Error('parse-theory: model did not call submit_parsed_theory tool')
  }

  const parsed = toolUse.input as Partial<ParsedTheoryResult>

  if (parsed.status !== 'parsed' && parsed.status !== 'failed') {
    throw new Error(`parse-theory returned invalid status: ${String(parsed.status)}`)
  }

  const draft = (parsed.draft ?? { sections: [] }) as ParsedTheoryResult['draft']
  if (!Array.isArray(draft.sections)) {
    throw new Error('parse-theory draft.sections must be an array')
  }
  if (parsed.status === 'parsed' && draft.sections.length === 0) {
    throw new Error('parse-theory returned parsed status with at least one section missing')
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
