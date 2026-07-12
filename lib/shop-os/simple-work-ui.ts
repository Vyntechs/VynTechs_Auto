import { z } from 'zod'

export const MAX_SIMPLE_WORK_FILE_BYTES = 4 * 1024 * 1024

const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const attachmentKind = z.enum(['photo', 'video', 'document'])
const attachment = z.strictObject({
  id: uuid,
  kind: attachmentKind,
  mimeType: z.enum([
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm',
    'application/pdf', 'text/plain',
  ]),
  byteSize: z.number().int().min(1).max(MAX_SIMPLE_WORK_FILE_BYTES),
  createdAt: timestamp,
})
const workspace = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(500),
  kind: z.enum(['repair', 'maintenance']),
  workStatus: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  updatedAt: timestamp,
  authorization: z.enum(['approved', 'declined', 'awaiting_approval']),
  hasCompletionProof: z.boolean(),
  attachments: z.array(attachment).max(200),
})
const work = z.strictObject({
  status: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  updatedAt: timestamp,
})
const escalationJob = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(520),
  kind: z.literal('diagnostic'),
  requiredSkillTier: z.number().int().min(1).max(3),
  assignedTechId: z.null(),
  workStatus: z.literal('open'),
  approvalState: z.literal('pending_quote'),
  sessionId: z.null(),
})

export type SimpleWorkWorkspaceView = z.infer<typeof workspace>
export type SimpleWorkProjectionView = z.infer<typeof work>
export type SimpleWorkAttachmentView = z.infer<typeof attachment>
export type SimpleWorkAttachmentKind = z.infer<typeof attachmentKind>
export type SimpleWorkEscalationView = z.infer<typeof escalationJob>

export function parseSimpleWorkWorkspaceResponse(value: unknown): SimpleWorkWorkspaceView | null {
  const parsed = z.strictObject({ workspace }).safeParse(value)
  return parsed.success ? parsed.data.workspace : null
}

export function parseSimpleWorkMutationResponse(
  value: unknown,
): { changed: boolean; work: SimpleWorkProjectionView } | null {
  const parsed = z.strictObject({ changed: z.boolean(), work }).safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseAttachmentResponse(
  value: unknown,
): { changed: boolean; attachment: SimpleWorkAttachmentView } | null {
  const parsed = z.strictObject({ changed: z.boolean(), attachment }).safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseEscalationResponse(
  value: unknown,
): { changed: boolean; job: SimpleWorkEscalationView } | null {
  const parsed = z.strictObject({ changed: z.boolean(), job: escalationJob }).safeParse(value)
  return parsed.success ? parsed.data : null
}

const kindByMime = new Map<string, SimpleWorkAttachmentKind>([
  ['image/jpeg', 'photo'],
  ['image/png', 'photo'],
  ['image/webp', 'photo'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
  ['application/pdf', 'document'],
  ['text/plain', 'document'],
])

export function classifySimpleWorkFile(
  file: Pick<File, 'size' | 'type'>,
): SimpleWorkAttachmentKind | null {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_SIMPLE_WORK_FILE_BYTES) {
    return null
  }
  return kindByMime.get(file.type.trim().toLowerCase()) ?? null
}

export type FileUploadAttempt = {
  file: File
  kind: SimpleWorkAttachmentKind
  requestKey: string
}

export function retainFileAttempt(
  current: FileUploadAttempt | null,
  file: File,
  kind: SimpleWorkAttachmentKind,
  createKey: () => string = () => crypto.randomUUID(),
): FileUploadAttempt {
  return current?.file === file && current.kind === kind
    ? current
    : { file, kind, requestKey: createKey() }
}

export type EscalationAttempt = {
  signature: string
  requestKey: string
}

export function retainEscalationAttempt(
  current: EscalationAttempt | null,
  concern: string,
  requiredSkillTier: number,
  createKey: () => string = () => crypto.randomUUID(),
): EscalationAttempt {
  const signature = JSON.stringify([concern.trim(), requiredSkillTier])
  return current?.signature === signature
    ? current
    : { signature, requestKey: createKey() }
}
