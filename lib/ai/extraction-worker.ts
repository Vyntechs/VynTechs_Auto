import { getArtifactById, setArtifactExtraction } from '../db/queries'
import type { AppDb } from '../db/queries'
import type { Artifact } from '../db/schema'
import {
  extractScanScreen,
  extractWiringDiagram,
  transcribeAudio,
} from './vision'
import { downloadArtifact } from '../storage/client'
import { HIGH_SIGNAL_KINDS } from './artifact-kinds'

export type ExtractionResult = NonNullable<Artifact['extraction']>

export { HIGH_SIGNAL_KINDS }

/**
 * Process extraction for a `scan_screen` artifact.
 * Stores raw text, full structured result, and a DTC-list summary.
 */
async function extractScanScreenArtifact(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractionResult> {
  const structured = await extractScanScreen({ bytes, mimeType })
  const dtcSummary =
    structured.dtcs && structured.dtcs.length > 0
      ? `DTCs: ${structured.dtcs.map((d) => d.code).join(', ')}`
      : 'No DTCs detected'
  return {
    text: structured.rawText,
    structured: structured as unknown as Record<string, unknown>,
    summary: dtcSummary,
  }
}

/**
 * Process extraction for a `wiring_diagram` artifact.
 * Stores full structured result and a circuit summary.
 */
async function extractWiringDiagramArtifact(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractionResult> {
  const structured = await extractWiringDiagram({ bytes, mimeType })
  return {
    structured: structured as unknown as Record<string, unknown>,
    summary: `Wiring: ${structured.circuit}`,
  }
}

/**
 * Process extraction for an `audio` artifact.
 * Stores transcript, full structured result, and diagnostic summary.
 *
 * Note (I8): At runtime the Anthropic transport for audio is a stub — the call
 * will fail with a BadRequestError/API error because the SDK does not yet support
 * native audio content blocks. That error propagates through catch → 'failed'
 * status, which is the correct behaviour. Wire to Whisper or a future Anthropic
 * audio block to make this path live.
 */
async function extractAudioArtifact(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractionResult> {
  const structured = await transcribeAudio({ bytes, mimeType })
  return {
    text: structured.transcript,
    structured: structured as unknown as Record<string, unknown>,
    summary: structured.diagnosticSummary,
  }
}

/**
 * Core extraction worker. Fetches the artifact row, downloads bytes, runs the
 * appropriate extractor based on kind, and persists the result back to the DB.
 *
 * - High-signal kinds (scan_screen, wiring_diagram, audio) → full AI extraction.
 * - describe-first kinds (photo, video) → stored with a deferred-extraction note.
 * - On any extractor error: calls setArtifactExtraction with status='failed' and
 *   re-throws so the caller can handle (e.g. the capture route logs and continues).
 *
 * @param db   Drizzle database instance (threaded — never imported globally here).
 * @param artifactId  UUID of the artifact row to process.
 */
export async function processArtifactExtraction(
  db: AppDb,
  artifactId: string,
): Promise<void> {
  const artifact = await getArtifactById(db, artifactId)
  if (!artifact) throw new Error(`artifact ${artifactId} not found`)

  const bytes = await downloadArtifact(artifact.storageKey)

  let extraction: ExtractionResult
  try {
    switch (artifact.kind) {
      case 'scan_screen':
        extraction = await extractScanScreenArtifact(bytes, artifact.mimeType)
        break
      case 'wiring_diagram':
        extraction = await extractWiringDiagramArtifact(bytes, artifact.mimeType)
        break
      case 'audio':
        extraction = await extractAudioArtifact(bytes, artifact.mimeType)
        break
      case 'photo':
      case 'video':
        extraction = {
          summary: 'Stored — vision not auto-invoked (describe-first policy).',
        }
        break
      default: {
        // TypeScript exhaustiveness guard — should never reach here.
        const _exhaustive: never = artifact.kind
        throw new Error(`unknown artifact kind: ${_exhaustive}`)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setArtifactExtraction(
      db,
      artifactId,
      { summary: `Extraction failed: ${message}` },
      'failed',
    )
    throw err
  }

  await setArtifactExtraction(db, artifactId, extraction, 'done')
}
