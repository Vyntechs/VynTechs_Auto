import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before imports that reference these modules.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/queries', () => ({
  getArtifactById: vi.fn(),
  setArtifactExtraction: vi.fn(),
  getWhatWouldCloseForNode: vi.fn(),
}))

vi.mock('@/lib/storage/client', () => ({
  downloadArtifact: vi.fn(),
}))

vi.mock('@/lib/ai/vision', () => ({
  extractScanScreen: vi.fn(),
  extractWiringDiagram: vi.fn(),
  transcribeAudio: vi.fn(),
  extractGenericPhoto: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { processArtifactExtraction } from '@/lib/ai/extraction-worker'
import {
  getArtifactById,
  setArtifactExtraction,
  getWhatWouldCloseForNode,
} from '@/lib/db/queries'
import { downloadArtifact } from '@/lib/storage/client'
import {
  extractScanScreen,
  extractWiringDiagram,
  transcribeAudio,
  extractGenericPhoto,
} from '@/lib/ai/vision'
import type { Artifact } from '@/lib/db/schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DB = {} as Parameters<typeof processArtifactExtraction>[0]
const BYTES = new Uint8Array([1, 2, 3])

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: 'artifact-uuid',
    sessionId: 'session-uuid',
    nodeId: 'node-1',
    kind: 'photo',
    storageKey: 'sessions/photo/uuid.jpg',
    mimeType: 'image/jpeg',
    bytes: 100,
    durationMs: null,
    extraction: null,
    extractionStatus: 'pending',
    storageTier: 'hot',
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: downloadArtifact returns BYTES for all tests.
  vi.mocked(downloadArtifact).mockResolvedValue(BYTES)
  // Default: setArtifactExtraction resolves.
  vi.mocked(setArtifactExtraction).mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Happy-path tests — one per kind
// ---------------------------------------------------------------------------

describe('processArtifactExtraction — scan_screen', () => {
  it('extracts and stores text, structured, and DTC summary', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'scan_screen', mimeType: 'image/jpeg' }),
    )
    vi.mocked(extractScanScreen).mockResolvedValue({
      screenType: 'dtc_list',
      rawText: 'P0300 Random Misfire',
      dtcs: [{ code: 'P0300', description: 'Random Misfire', status: 'active' }],
    })

    await processArtifactExtraction(DB, 'artifact-uuid')

    expect(extractScanScreen).toHaveBeenCalledWith({
      bytes: BYTES,
      mimeType: 'image/jpeg',
    })
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({
        text: 'P0300 Random Misfire',
        summary: 'DTCs: P0300',
      }),
      'done',
    )
  })
})

describe('processArtifactExtraction — wiring_diagram', () => {
  it('extracts and stores structured result and circuit summary', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'wiring_diagram', mimeType: 'image/png' }),
    )
    vi.mocked(extractWiringDiagram).mockResolvedValue({
      circuit: 'Fuel Injector B1',
      wireColors: [{ signal: 'PWR', color: 'Red', pin: 'A1' }],
    })

    await processArtifactExtraction(DB, 'artifact-uuid')

    expect(extractWiringDiagram).toHaveBeenCalledWith({
      bytes: BYTES,
      mimeType: 'image/png',
    })
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({
        summary: 'Wiring: Fuel Injector B1',
      }),
      'done',
    )
  })
})

describe('processArtifactExtraction — audio', () => {
  it('extracts and stores transcript, structured, and diagnostic summary', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'audio', mimeType: 'audio/webm' }),
    )
    vi.mocked(transcribeAudio).mockResolvedValue({
      transcript: 'knocking sound under load',
      diagnosticSummary: 'Likely rod knock; verify oil pressure.',
      confidence: 0.85,
    })

    await processArtifactExtraction(DB, 'artifact-uuid')

    expect(transcribeAudio).toHaveBeenCalledWith({
      bytes: BYTES,
      mimeType: 'audio/webm',
    })
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({
        text: 'knocking sound under load',
        summary: 'Likely rod knock; verify oil pressure.',
      }),
      'done',
    )
  })
})

describe('processArtifactExtraction — photo', () => {
  it('invokes extractGenericPhoto when extractFor is resolvable from session state', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'photo', mimeType: 'image/jpeg' }),
    )
    vi.mocked(getWhatWouldCloseForNode).mockResolvedValue({
      kind: 'photo',
      prompt: 'snap pinout',
      extractFor: 'full pinout for C171',
    })
    vi.mocked(extractGenericPhoto).mockResolvedValue({
      summary: 'C171 pinout — 5 pins identified',
      structured: { pins: [{ number: 4, function: 'HSCAN+' }] },
      confidence: 0.92,
    })
    vi.mocked(downloadArtifact).mockResolvedValue(BYTES)

    await processArtifactExtraction(DB, 'artifact-uuid')

    expect(extractGenericPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ extractFor: 'full pinout for C171' }),
    )
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({ summary: expect.stringMatching(/pinout/i) }),
      'done',
    )
  })

  it('records a failed extraction when extractFor is not derivable', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'photo', mimeType: 'image/jpeg' }),
    )
    vi.mocked(getWhatWouldCloseForNode).mockResolvedValue(null)
    vi.mocked(downloadArtifact).mockResolvedValue(BYTES)

    await expect(processArtifactExtraction(DB, 'artifact-uuid')).rejects.toThrow(
      /extractFor/,
    )

    expect(extractGenericPhoto).not.toHaveBeenCalled()
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({ summary: expect.stringMatching(/extractFor/i) }),
      'failed',
    )
  })
})

describe('processArtifactExtraction — video (describe-first)', () => {
  it('stores a describe-first policy note without invoking vision', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'video', mimeType: 'video/mp4' }),
    )

    await processArtifactExtraction(DB, 'artifact-uuid')

    expect(extractScanScreen).not.toHaveBeenCalled()
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({
        summary: expect.stringContaining('describe-first'),
      }),
      'done',
    )
  })
})

// ---------------------------------------------------------------------------
// Error-path tests
// ---------------------------------------------------------------------------

describe('processArtifactExtraction — extractor throws', () => {
  it('calls setArtifactExtraction with failed status and error message, then re-throws', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(
      makeArtifact({ kind: 'scan_screen', mimeType: 'image/jpeg' }),
    )
    vi.mocked(extractScanScreen).mockRejectedValue(new Error('API timeout'))

    await expect(processArtifactExtraction(DB, 'artifact-uuid')).rejects.toThrow('API timeout')

    expect(setArtifactExtraction).toHaveBeenCalledWith(
      DB,
      'artifact-uuid',
      expect.objectContaining({
        summary: expect.stringContaining('API timeout'),
      }),
      'failed',
    )
  })
})

describe('processArtifactExtraction — artifact not found', () => {
  it('throws without calling setArtifactExtraction when getArtifactById returns null', async () => {
    vi.mocked(getArtifactById).mockResolvedValue(null)

    await expect(processArtifactExtraction(DB, 'missing-id')).rejects.toThrow('missing-id')

    expect(setArtifactExtraction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Deferred I1 fix: setArtifactExtraction throws for unknown id
// Uses vi.importActual to bypass the module-level mock and call the real impl.
// ---------------------------------------------------------------------------

describe('setArtifactExtraction — deferred I1 fix', () => {
  it('throws when the artifact id does not exist (no silent no-op)', async () => {
    // Pull the actual (unmocked) module to exercise the real DB guard.
    const { setArtifactExtraction: realFn } = await vi.importActual<
      typeof import('@/lib/db/queries')
    >('@/lib/db/queries')
    const { createTestDb } = await vi.importActual<typeof import('../helpers/db')>(
      '../helpers/db',
    )

    const { db: testDb, close } = await createTestDb()
    try {
      await expect(
        realFn(testDb, crypto.randomUUID(), { summary: 'test' }, 'done'),
      ).rejects.toThrow('not found')
    } finally {
      await close()
    }
  }, 30_000)
})
