import { describe, expect, it, vi } from 'vitest'
import {
  classifySimpleWorkFile,
  parseAttachmentResponse,
  parseEscalationResponse,
  parseSimpleWorkMutationResponse,
  parseSimpleWorkWorkspaceResponse,
  retainEscalationAttempt,
  retainFileAttempt,
} from '@/lib/shop-os/simple-work-ui'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const workspace = {
  id: uuid(1), title: 'Install lift kit', kind: 'repair', workStatus: 'in_progress',
  workNotes: 'Started', updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved',
  hasCompletionProof: true,
  attachments: [{ id: uuid(2), kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, createdAt: '2026-07-11T12:01:00.000Z' }],
}

describe('Shop OS simple-work UI contract', () => {
  it('strictly parses bounded workspace, mutation, attachment, and escalation responses', () => {
    expect(parseSimpleWorkWorkspaceResponse({ workspace })).toEqual(workspace)
    expect(parseSimpleWorkMutationResponse({
      changed: true, work: { status: 'done', workNotes: 'Done', updatedAt: '2026-07-11T12:02:00.000Z' },
    })).toMatchObject({ changed: true, work: { status: 'done' } })
    expect(parseAttachmentResponse({ changed: true, attachment: workspace.attachments[0] }))
      .toMatchObject({ changed: true, attachment: { kind: 'photo' } })
    expect(parseEscalationResponse({
      changed: true,
      job: { id: uuid(3), title: 'Diagnose: steering clunk', kind: 'diagnostic', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null },
    })).toMatchObject({ changed: true, job: { assignedTechId: null, sessionId: null } })
  })

  it('fails closed on extra private fields or malformed persisted values', () => {
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, shopId: uuid(9) } })).toBeNull()
    expect(parseSimpleWorkWorkspaceResponse({
      workspace: { ...workspace, attachments: [{ ...workspace.attachments[0], storageKey: 'private/path' }] },
    })).toBeNull()
    expect(parseAttachmentResponse({
      changed: true, attachment: { ...workspace.attachments[0], byteSize: 0 },
    })).toBeNull()
    expect(parseEscalationResponse({ changed: true, job: { id: 'bad' } })).toBeNull()
  })

  it('classifies only supported non-empty files up to four MiB', () => {
    expect(classifySimpleWorkFile(new File(['photo'], 'proof.jpg', { type: 'image/jpeg' }))).toBe('photo')
    expect(classifySimpleWorkFile(new File(['video'], 'proof.mp4', { type: 'video/mp4' }))).toBe('video')
    expect(classifySimpleWorkFile(new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' }))).toBe('document')
    expect(classifySimpleWorkFile(new File([], 'empty.jpg', { type: 'image/jpeg' }))).toBeNull()
    expect(classifySimpleWorkFile(new File(['x'], 'proof.heic', { type: 'image/heic' }))).toBeNull()
    const oversized = { size: 4 * 1024 * 1024 + 1, type: 'image/jpeg' } as File
    expect(classifySimpleWorkFile(oversized)).toBeNull()
  })

  it('binds upload identity to the selected File object and kind, not colliding metadata', () => {
    const key = vi.fn().mockReturnValueOnce(uuid(10)).mockReturnValueOnce(uuid(11)).mockReturnValueOnce(uuid(12))
    const firstFile = new File(['a'], 'proof.jpg', { type: 'image/jpeg', lastModified: 1 })
    const otherBytesSameMetadata = new File(['b'], 'proof.jpg', { type: 'image/jpeg', lastModified: 1 })
    const first = retainFileAttempt(null, firstFile, 'photo', key)
    expect(retainFileAttempt(first, firstFile, 'photo', key)).toBe(first)
    const second = retainFileAttempt(first, otherBytesSameMetadata, 'photo', key)
    expect(second.requestKey).toBe(uuid(11))
    expect(retainFileAttempt(second, otherBytesSameMetadata, 'document', key).requestKey).toBe(uuid(12))
  })

  it('retains concern identity only for the exact normalized concern and tier', () => {
    const key = vi.fn().mockReturnValueOnce(uuid(20)).mockReturnValueOnce(uuid(21)).mockReturnValueOnce(uuid(22))
    const first = retainEscalationAttempt(null, '  Steering clunk  ', 2, key)
    expect(retainEscalationAttempt(first, 'Steering clunk', 2, key)).toBe(first)
    expect(retainEscalationAttempt(first, 'Steering clunk', 3, key).requestKey).toBe(uuid(21))
    expect(retainEscalationAttempt(first, 'Steering knock', 2, key).requestKey).toBe(uuid(22))
  })
})
