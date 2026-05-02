import Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL, cachedSystem } from './client'
import { SCAN_SCREEN_VISION_SYSTEM, WIRING_DIAGRAM_VISION_SYSTEM } from './prompts'

// --- Constants ---------------------------------------------------------------

const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

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
  if (!VISION_MIME_TYPES.has(input.mimeType)) {
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
  if (!VISION_MIME_TYPES.has(input.mimeType)) {
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
