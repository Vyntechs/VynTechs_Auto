import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { ensureProfileAndShop, createSession, getArtifactById } from '@/lib/db/queries'
import { captureArtifact } from '@/lib/sessions'
import { createArtifact } from '@/lib/db/queries'

const intake = {
  vehicleYear: 2020,
  vehicleMake: 'Toyota',
  vehicleModel: 'Camry',
  customerComplaint: 'engine misfire on acceleration',
}

const initialTree = {
  nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' as const }],
  currentNodeId: 'scan-codes',
  message: 'pull codes',
}

function makeBytes(n = 100): Uint8Array {
  return new Uint8Array(n).fill(0xff)
}

describe('captureArtifact', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  async function seedSession(opts: { status?: 'open' | 'closed' | 'declined' | 'deferred' } = {}) {
    const userId = crypto.randomUUID()
    const profile = await ensureProfileAndShop(db, userId, 'tech@shop.com')
    const session = await createSession(db, {
      shopId: profile.shopId!,
      techId: profile.id,
      intake,
      treeState: initialTree,
      status: opts.status ?? 'open',
    })
    return { userId, profile, session }
  }

  it('happy path: returns ok with artifactId, storageKey, and kind', async () => {
    const { userId, session } = await seedSession()
    const bytes = makeBytes(512)
    const uploadArtifact = vi.fn().mockResolvedValue('session-id/photo/uuid.jpg')

    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'photo',
      file: { bytes, mimeType: 'image/jpeg', size: 512 },
      uploadArtifact,
      createArtifact,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('photo')
      expect(result.storageKey).toBe('session-id/photo/uuid.jpg')
      expect(result.artifactId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    }
  })

  it('persists an artifact row in the db', async () => {
    const { userId, session } = await seedSession()
    const bytes = makeBytes(256)
    const uploadArtifact = vi.fn().mockResolvedValue('session-id/audio/uuid.webm')

    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'audio',
      file: { bytes, mimeType: 'audio/webm', size: 256 },
      durationMs: 4500,
      uploadArtifact,
      createArtifact,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = await getArtifactById(db, result.artifactId)
      expect(row?.kind).toBe('audio')
      expect(row?.durationMs).toBe(4500)
      expect(row?.mimeType).toBe('audio/webm')
      expect(row?.bytes).toBe(256)
      expect(row?.extractionStatus).toBe('pending')
    }
  })

  it('uses the tree currentNodeId when nodeId is not supplied', async () => {
    const { userId, session } = await seedSession()
    const bytes = makeBytes(100)
    const uploadArtifact = vi.fn().mockResolvedValue('key')

    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'photo',
      file: { bytes, mimeType: 'image/jpeg', size: 100 },
      uploadArtifact,
      createArtifact,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = await getArtifactById(db, result.artifactId)
      expect(row?.nodeId).toBe('scan-codes') // matches initialTree.currentNodeId
    }
  })

  it('uses the explicit nodeId when provided', async () => {
    const { userId, session } = await seedSession()
    const bytes = makeBytes(100)
    const uploadArtifact = vi.fn().mockResolvedValue('key')

    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'photo',
      nodeId: 'inspect-cac',
      file: { bytes, mimeType: 'image/jpeg', size: 100 },
      uploadArtifact,
      createArtifact,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = await getArtifactById(db, result.artifactId)
      expect(row?.nodeId).toBe('inspect-cac')
    }
  })

  it('returns 400 when the userId has no profile', async () => {
    const { session } = await seedSession()
    const result = await captureArtifact({
      db,
      userId: crypto.randomUUID(),
      sessionId: session.id,
      kind: 'photo',
      file: { bytes: makeBytes(100), mimeType: 'image/jpeg', size: 100 },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('no profile')
    }
  })

  it('returns 404 when the session does not belong to the caller', async () => {
    const { session } = await seedSession()
    const intruder = await ensureProfileAndShop(db, crypto.randomUUID(), 'intruder@shop.com')
    const result = await captureArtifact({
      db,
      userId: intruder.userId,
      sessionId: session.id,
      kind: 'photo',
      file: { bytes: makeBytes(100), mimeType: 'image/jpeg', size: 100 },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.error).toBe('not found')
    }
  })

  it('returns 404 for an unknown session id', async () => {
    const { userId } = await seedSession()
    const result = await captureArtifact({
      db,
      userId,
      sessionId: crypto.randomUUID(),
      kind: 'photo',
      file: { bytes: makeBytes(100), mimeType: 'image/jpeg', size: 100 },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.error).toBe('not found')
    }
  })

  it('returns 400 when the session is not open', async () => {
    const { userId, session } = await seedSession({ status: 'closed' })
    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'photo',
      file: { bytes: makeBytes(100), mimeType: 'image/jpeg', size: 100 },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('session not open')
    }
  })

  it('returns 400 for an invalid kind', async () => {
    const { userId, session } = await seedSession()
    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'selfie',
      file: { bytes: makeBytes(100), mimeType: 'image/jpeg', size: 100 },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('invalid kind')
    }
  })

  it('returns 400 when file size is 0', async () => {
    const { userId, session } = await seedSession()
    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'photo',
      file: { bytes: new Uint8Array(0), mimeType: 'image/jpeg', size: 0 },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('invalid size')
    }
  })

  it('returns 400 when file size exceeds 25 MB', async () => {
    const { userId, session } = await seedSession()
    const result = await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'video',
      file: {
        bytes: makeBytes(100), // actual bytes doesn't matter; size field is checked
        mimeType: 'video/mp4',
        size: 26 * 1024 * 1024,
      },
      uploadArtifact: vi.fn(),
      createArtifact,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('invalid size')
    }
  })

  it('passes the bytes and mimeType through to uploadArtifact', async () => {
    const { userId, session } = await seedSession()
    const bytes = makeBytes(200)
    const uploadArtifact = vi.fn().mockResolvedValue('storage/key')

    await captureArtifact({
      db,
      userId,
      sessionId: session.id,
      kind: 'wiring_diagram',
      file: { bytes, mimeType: 'image/png', size: 200 },
      uploadArtifact,
      createArtifact,
    })

    expect(uploadArtifact).toHaveBeenCalledWith({
      sessionId: session.id,
      kind: 'wiring_diagram',
      bytes,
      mimeType: 'image/png',
    })
  })
})
