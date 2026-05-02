import Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL, cachedSystem } from './client'
import { SCAN_SCREEN_VISION_SYSTEM, WIRING_DIAGRAM_VISION_SYSTEM, AUDIO_TRANSCRIBE_SYSTEM } from './prompts'

// --- Constants ---------------------------------------------------------------

const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/**
 * Supported audio MIME types for transcription.
 *
 * Phase I8 note: the Anthropic SDK v0.92.0 does not expose a native audio
 * content block (Base64PDFSource only accepts application/pdf). The current
 * implementation sends audio bytes via a `document` block with `as any` to
 * bypass the type constraint — Anthropic's API accepts the call but will NOT
 * actually transcribe audio from a non-PDF document; it will return an error
 * or an empty response at runtime. This is an API-pending stub:
 *   - If an OPENAI_API_KEY is added, wire to Whisper and replace the block below.
 *   - If Anthropic ships a native audio block (expected in a future SDK version),
 *     replace the document block with { type: 'audio', source: { ... } }.
 * The AudioExtraction interface and all hardening are production-ready; only
 * the transport layer needs updating.
 */
const TRANSCRIBE_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/m4a',
  'audio/ogg',
])

// --- Types -------------------------------------------------------------------

export type ScanScreenExtraction = {
  screenType: 'dtc_list' | 'freeze_frame' | 'live_pids' | 'module_scan' | 'graph' | 'unknown'
  dtcs?: Array<{ code: string; description?: string; status?: 'active' | 'pending' | 'history' }>
  freezeFrame?: Record<string, string | number>
  pids?: Record<string, string | number>
  modules?: Array<{ name: string; codes?: string[]; communication?: 'ok' | 'no_response' }>
  rawText: string
  notes?: string
}

export type WiringDiagramExtraction = {
  circuit: string
  wireColors: Array<{ signal: string; color: string; pin?: string; connector?: string }>
  groundPoints?: Array<{ id: string; location: string }>
  splicePoints?: Array<{ id: string; description: string }>
  buildDateApplicable?: string
  notes?: string
}

// --- Helpers -----------------------------------------------------------------

/**
 * Parse JSON from LLM text response.
 *
 * Phase I implementation correction #2: hardened with brace-extraction recovery
 * and stop_reason/len diagnostic context, mirroring tree-engine's parseTreeJson
 * (Phase D corrections #10).
 */
export function parseJson<T>(
  text: string,
  stopReason?: string,
): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (firstErr) {
    // Recovery: extract from first '{' to last '}' — handles stray prose wrapping.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1))
        console.warn(
          `[vision] parseJson used brace-extraction recovery (stop_reason=${stopReason ?? 'unknown'}, len=${cleaned.length})`,
        )
      } catch {
        throw new Error(
          `vision response not valid JSON (stop_reason=${stopReason ?? 'unknown'}, len=${cleaned.length}): ${
            (firstErr as Error).message
          }`,
        )
      }
    } else {
      throw new Error(
        `vision response not valid JSON (stop_reason=${stopReason ?? 'unknown'}, len=${cleaned.length}): ${
          (firstErr as Error).message
        }`,
      )
    }
  }

  return parsed as T
}

/**
 * Convert Uint8Array to base64 string for Anthropic vision API.
 */
function toBase64(bytes: Uint8Array): string {
  // Use Buffer when available (Node/Next.js runtime) for correctness on all byte values.
  return Buffer.from(bytes).toString('base64')
}

/**
 * Simple retry wrapper — mirrors tree-engine's withRetry (Phase I correction #4).
 * Vision calls are equally subject to 529/output-TPM throttling.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      // Terminal errors — retrying will not help.
      if (
        e instanceof Anthropic.BadRequestError ||
        e instanceof Anthropic.UnprocessableEntityError
      ) {
        throw e
      }
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)))
      }
    }
  }
  throw lastErr
}

// --- Extractors --------------------------------------------------------------

/**
 * Extract structured data from a scan-tool screen photograph.
 *
 * Phase I correction #1: max_tokens=4096 (plan had 1500; DTC lists with
 * descriptions can exceed 1500 tokens — matches tree-engine pattern).
 */
export async function extractScanScreen(input: {
  bytes: Uint8Array
  mimeType: string
}): Promise<ScanScreenExtraction> {
  const baseMime = input.mimeType.split(';')[0].trim()
  if (!VISION_MIME_TYPES.has(baseMime)) {
    throw new Error(`unsupported image type for vision: ${input.mimeType}`)
  }
  return withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: cachedSystem(SCAN_SCREEN_VISION_SYSTEM),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimeType as
                  | 'image/jpeg'
                  | 'image/png'
                  | 'image/gif'
                  | 'image/webp',
                data: toBase64(input.bytes),
              },
            },
            { type: 'text', text: 'Extract this scan-tool screen. Return JSON only.' },
          ],
        },
      ],
    })

    const block = res.content.find((b: { type: string }) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block in response')
    if (res.stop_reason === 'max_tokens') {
      throw new Error(`vision response truncated at max_tokens (len=${block.text.length})`)
    }
    const result = parseJson<ScanScreenExtraction>(block.text, res.stop_reason ?? undefined)
    if (typeof (result as Record<string, unknown>).rawText !== 'string') {
      throw new Error('vision response missing required field: rawText')
    }
    return result
  })
}

/**
 * Extract structured facts from a photographed OEM wiring diagram.
 *
 * Phase I correction #1: max_tokens=4096 (plan had 1500; multi-pin
 * wire-color tables can exceed 1500 tokens — matches tree-engine pattern).
 */
export async function extractWiringDiagram(input: {
  bytes: Uint8Array
  mimeType: string
  circuitHint?: string
}): Promise<WiringDiagramExtraction> {
  const baseMime = input.mimeType.split(';')[0].trim()
  if (!VISION_MIME_TYPES.has(baseMime)) {
    throw new Error(`unsupported image type for vision: ${input.mimeType}`)
  }
  return withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: cachedSystem(WIRING_DIAGRAM_VISION_SYSTEM),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimeType as
                  | 'image/jpeg'
                  | 'image/png'
                  | 'image/gif'
                  | 'image/webp',
                data: toBase64(input.bytes),
              },
            },
            {
              type: 'text',
              text: `Extract structured facts only. ${
                input.circuitHint ? `Circuit hint: ${input.circuitHint}.` : ''
              } Return JSON only.`,
            },
          ],
        },
      ],
    })

    const block = res.content.find((b: { type: string }) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block in response')
    if (res.stop_reason === 'max_tokens') {
      throw new Error(`vision response truncated at max_tokens (len=${block.text.length})`)
    }
    const result = parseJson<WiringDiagramExtraction>(block.text, res.stop_reason ?? undefined)
    if (!Array.isArray((result as Record<string, unknown>).wireColors)) {
      throw new Error('vision response missing required field: wireColors')
    }
    if (typeof (result as Record<string, unknown>).circuit !== 'string') {
      throw new Error('vision response missing required field: circuit')
    }
    return result
  })
}

// --- Audio transcription -----------------------------------------------------

export type AudioExtraction = {
  transcript: string         // verbatim transcription of any speech
  diagnosticSummary: string  // 1-2 sentence diagnostic interpretation
  acousticTags?: string[]    // e.g. ["lifter_tick", "vacuum_hiss"]
  confidence: number         // 0-1
}

/**
 * Transcribe and diagnostically interpret an engine-sound or voice-annotation
 * audio clip from a technician's device.
 *
 * API PATH (Phase I8): The Anthropic SDK v0.92.0 does not expose a native audio
 * content block — Base64PDFSource only accepts `application/pdf`. Audio bytes
 * are sent via a `document` block using `as any` to bypass the TS constraint.
 * Anthropic's API will NOT transcribe audio from non-PDF payloads at runtime;
 * this function is API-pending. Wire to OpenAI Whisper (add OPENAI_API_KEY) or
 * wait for an Anthropic audio block in a future SDK version to make it live.
 * The AudioExtraction interface, MIME gate, withRetry, and shape validation are
 * all production-ready; only the transport layer needs updating.
 *
 * Hardening applied (mirrors I7 extractScanScreen / extractWiringDiagram):
 * 1. withRetry wrapping with terminal-error skip (BadRequestError + UnprocessableEntityError).
 * 2. MIME gate via TRANSCRIBE_MIME_TYPES set.
 * 3. Shape validation: transcript coerced to string; diagnosticSummary and confidence validated.
 * 4. stop_reason='max_tokens' → throw before parseJson.
 * 5. Tightened prompt: "respond with valid JSON and nothing else. No intro, no commentary, no fences."
 */
export async function transcribeAudio(input: {
  bytes: Uint8Array
  mimeType: string
}): Promise<AudioExtraction> {
  const baseMime = input.mimeType.split(';')[0].trim()
  if (!TRANSCRIBE_MIME_TYPES.has(baseMime)) {
    throw new Error(`unsupported audio type for transcription: ${input.mimeType}`)
  }
  return withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1600,
      system: cachedSystem(AUDIO_TRANSCRIBE_SYSTEM),
      messages: [
        {
          role: 'user',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: [
            // TODO(I8): replace this stub with a real audio path — Anthropic audio
            // content block when SDK supports it, or OpenAI Whisper. Currently fails
            // at runtime against the live API because document-block expects PDFs.
            {
              type: 'document',
              source: {
                type: 'base64',
                // SDK type only allows application/pdf here; audio requires a future
                // native audio block. Cast to any so TS compiles; runtime will need
                // the transport replaced (Whisper or Anthropic audio block).
                media_type: input.mimeType,
                data: toBase64(input.bytes),
              },
            } as any,
            { type: 'text', text: 'Transcribe and analyze this audio clip. Return JSON only.' },
          ],
        },
      ],
    })

    const block = res.content.find((b: { type: string }) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block in response')
    if (res.stop_reason === 'max_tokens') {
      throw new Error(`transcription response truncated at max_tokens (len=${block.text.length})`)
    }
    const result = parseJson<AudioExtraction>(block.text, res.stop_reason ?? undefined)

    // Shape validation — lenient on transcript (noise clips are expected to have empty speech),
    // strict on diagnosticSummary and confidence which are always required.
    const r = result as Record<string, unknown>
    if (typeof r.transcript !== 'string') {
      // Coerce missing/non-string transcript to empty string (low-confidence noise clips).
      ;(result as Record<string, unknown>).transcript = ''
    }
    if (typeof r.diagnosticSummary !== 'string') {
      throw new Error('transcription response missing required field: diagnosticSummary')
    }
    if (typeof r.confidence !== 'number') {
      throw new Error('transcription response missing required field: confidence')
    }
    if (result.acousticTags !== undefined && !Array.isArray(result.acousticTags)) {
      // Coerce to empty array — preserves the optional contract without failing the call
      ;(result as Record<string, unknown>).acousticTags = []
    }
    return result
  })
}
