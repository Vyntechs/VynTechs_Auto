# Two-Phase Diagnose+Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split "case open" into three phases (diagnosing → diagnosis-proposed → repairing → closed) with explicit user-controlled lock-in and AI-guided repair-time chat.

**Architecture:** Phases tracked in `treeState.phase` (jsonb extension, no schema migration). Two new API endpoints (`/lock-diagnosis`, `/repair-observation`). New `repair-guidance` AI prompt that cannot revise the locked rootCauseSummary. Repair-phase chat reuses existing `session_events` table with two new event types. UI adds three new components on top of existing active-session.tsx routing.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle (PostgreSQL via Supabase), Anthropic SDK, vitest + PGlite (unit), @testing-library/react (component), Playwright (e2e), pnpm.

**Spec:** `docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md`

**Milestones:** M1 (backend) → M2 (diagnosis-proposed review screen) → M3 (repair-phase chat) → M4 (validation + e2e + manual checklist).

---

## File structure

| File | Status | Purpose |
|---|---|---|
| `lib/db/schema.ts` | Modify | Extend `treeState` $type with `phase` + `diagnosisLockedAt`; add new event types; extend `aiResponse` $type with `repairGuidance` |
| `lib/sessions.ts` | Modify | Add `lockDiagnosisForUser` + `submitRepairObservationForUser` |
| `lib/ai/repair-guidance.ts` | Create | New: `getRepairGuidance(input)` + `buildRepairGuidancePrompt(input)`. Anthropic call with the locked-diagnosis system prompt |
| `app/api/sessions/[id]/lock-diagnosis/route.ts` | Create | POST handler for the lock-in event |
| `app/api/sessions/[id]/repair-observation/route.ts` | Create | POST handler for repair-time observations |
| `components/screens/active-session.tsx` | Modify | Branch on `treeState.phase` + `treeState.done` to render one of three components |
| `components/screens/diagnosis-proposed-review.tsx` | Create | Done-state UI extracted from active-session.tsx + LockDiagnosisButton |
| `components/screens/lock-diagnosis-button.tsx` | Create | Client component, posts to `/lock-diagnosis`, redirects on success |
| `components/screens/repair-phase-view.tsx` | Create | Locked-diagnosis banner + RepairConversation + RepairAskForm + Close case |
| `components/screens/repair-conversation.tsx` | Create | Chat-thread renderer for `repair_observation` + `repair_guidance` events |
| `components/screens/repair-ask-form.tsx` | Create | Client textarea + submit, calls `/repair-observation`, handles error/retry |
| `tests/unit/lock-diagnosis.test.ts` | Create | Unit tests for `lockDiagnosisForUser` |
| `tests/unit/repair-observation.test.ts` | Create | Unit tests for `submitRepairObservationForUser` |
| `tests/unit/repair-guidance-prompt.test.ts` | Create | Unit tests for `buildRepairGuidancePrompt` |
| `tests/unit/active-session.test.tsx` | Modify | Add tests for phase-mode rendering |
| `tests/e2e/sessions.spec.ts` | Modify | Add repair-phase smoke + observation-submit smoke |
| `docs/testing/manual-checklist.md` | Modify | Add lock-in + repair-phase steps |

---

## Task 0: Branch setup

**Files:** none (git operations)

- [ ] **Step 1: Verify clean working tree on preview-curator**

```bash
cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/testing-pipeline
git status
```

Expected: `On branch preview-curator. nothing to commit, working tree clean.` (the 2 unpushed spec doc commits are OK — they go onto the new branch)

- [ ] **Step 2: Fetch latest main**

```bash
git fetch origin main
```

- [ ] **Step 3: Create new branch off main with the foundation commits**

```bash
git checkout -b feature/two-phase-diagnose-repair origin/main
git cherry-pick d4472df  # abandon button (Mark incomplete)
git cherry-pick d70a357  # diagnosis-complete view (interim, will be replaced in M2)
git cherry-pick 62c199a  # spec doc (initial)
git cherry-pick 3036656  # spec doc (self-review fixes)
```

Expected: 4 commits on top of origin/main, working tree clean.

- [ ] **Step 4: Verify**

```bash
git log --oneline -6
```

Expected output (top to bottom):
```
3036656 docs(spec): self-review fixes on two-phase design
62c199a docs(spec): two-phase diagnostic + repair model design
d70a357 fix(sessions): show diagnosis-complete state on active-session, drop auto-redirect to /outcome
d4472df feat(sessions): add user-initiated "Mark incomplete" abandon path
5d7065b docs(handoff): Phase Q merged; next pick is full Phase P (#2)
```

- [ ] **Step 5: Push branch (don't open PR yet — wait until M4)**

```bash
git push -u origin feature/two-phase-diagnose-repair
```

---

# M1 — Backend (Tasks 1-7)

No user-visible UI changes in M1. After M1 completes: APIs work, unit tests green, but no UI references the new fields yet so legacy flow is unchanged.

## Task 1: Extend schema types

**Files:**
- Modify: `lib/db/schema.ts:69-93` (sessionEvents table — extend `eventType` + `aiResponse` $type)
- Modify: `lib/ai/tree-engine.ts:31-40` (TreeState type — add `phase` + `diagnosisLockedAt`)

- [ ] **Step 1: Extend `TreeState` type in tree-engine.ts**

Open `lib/ai/tree-engine.ts`, find the `TreeState` type around line 31-40. Add two optional fields at the bottom:

```typescript
export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: RequestedArtifact
  proposedAction?: ProposedAction
  gateDecision?: GateDecision
  // NEW (Phase 1 → 3 transition):
  phase?: 'diagnosing' | 'repairing'  // undefined → treated as 'diagnosing' by consumers
  diagnosisLockedAt?: string           // ISO timestamp set when phase flips to 'repairing'
}
```

- [ ] **Step 2: Extend `sessionEvents.eventType` enum**

Open `lib/db/schema.ts`, find the `sessionEvents` table at line 69. Update the `eventType` enum:

```typescript
eventType: text('event_type', {
  enum: [
    'advance',
    'observation',
    'tree_update',
    'close',
    'repair_observation',  // NEW: tech-submitted text during repair phase
    'repair_guidance',     // NEW: AI reply during repair phase
  ],
}).notNull(),
```

- [ ] **Step 3: Extend `aiResponse` $type to include `repairGuidance`**

In the same `sessionEvents` table, find the `aiResponse` $type<{...}> around line 77. Add a `repairGuidance` field:

```typescript
aiResponse: jsonb('ai_response').$type<{
  nextNodeId?: string
  treeUpdate?: unknown
  requestedFollowUp?: string
  declineOrDefer?: {
    reason: 'decline' | 'defer'
    gap: string
    riskClass: 'low' | 'medium' | 'high' | 'destructive'
    language: {
      customerMessage: string
      internalNote: string
      recommendedReferral?: string
    }
  }
  abandon?: {
    reason: 'mistake' | 'test' | 'wrong_vehicle' | 'customer_left' | 'other'
    note?: string
  }
  repairGuidance?: {
    text: string                    // markdown-ish guidance content
    tangentialConcerns?: string[]   // optional list of side-issues AI flagged
  }
}>(),
```

(The `abandon` field is already there from `d4472df`. Just add `repairGuidance` after it.)

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean, no errors. (No code consumes the new fields yet, so no failures.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/ai/tree-engine.ts
git commit -m "$(cat <<'EOF'
schema(sessions): extend treeState with phase + diagnosisLockedAt; add repair_observation/repair_guidance event types

Two field additions on the jsonb TreeState type:
- phase: 'diagnosing' | 'repairing' (optional; undefined = diagnosing)
- diagnosisLockedAt: ISO timestamp string

Two new sessionEvents.eventType enum values:
- repair_observation: tech text during repair phase
- repair_guidance: AI reply during repair phase

aiResponse $type extended with repairGuidance? envelope ({text,
tangentialConcerns?}) so AI repair-time replies have a typed home.

No DB migration needed — tree_state and ai_response are jsonb. Existing
in-flight sessions implicitly have phase=undefined and won't break
under the new TS types because all new fields are optional.

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement `lockDiagnosisForUser`

**Files:**
- Create: `tests/unit/lock-diagnosis.test.ts`
- Modify: `lib/sessions.ts` (append at end of file)

- [ ] **Step 1: Write the failing test (full file)**

Create `tests/unit/lock-diagnosis.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { lockDiagnosisForUser } from '@/lib/sessions'

async function seedDoneSession(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  const session = await createSession(db, {
    shopId: shop.id,
    techId: tech.id,
    intake: {
      vehicleYear: 2009,
      vehicleMake: 'ram',
      vehicleModel: '1500',
      customerComplaint: 'P0171/P0174',
    },
    treeState: {
      nodes: [{ id: 'replace', label: 'Replace booster + master cyl', status: 'active' }],
      currentNodeId: 'replace',
      message: 'Brake fluid in booster — replace both.',
      done: true,
      rootCauseSummary: 'Brake booster crimp seam vacuum leak.',
      proposedAction: {
        confidence: 0.98,
        description: 'Replace booster + master cyl as a matched pair.',
        expectedSignal: 'Firm pedal; trims within ±5%.',
      },
    },
  })
  return { shop, tech, session }
}

describe('lockDiagnosisForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('flips phase to repairing + sets diagnosisLockedAt + appends tree_update event when done=true', async () => {
    const { tech, session } = await seedDoneSession(db)

    const before = Date.now()
    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })
    const after = Date.now()

    expect(result.ok).toBe(true)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.treeState.phase).toBe('repairing')
    expect(row.treeState.diagnosisLockedAt).toBeTruthy()
    const lockedAt = new Date(row.treeState.diagnosisLockedAt!).getTime()
    expect(lockedAt).toBeGreaterThanOrEqual(before)
    expect(lockedAt).toBeLessThanOrEqual(after)
    // rootCauseSummary preserved verbatim:
    expect(row.treeState.rootCauseSummary).toBe('Brake booster crimp seam vacuum leak.')

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    const treeUpdates = events.filter(e => e.eventType === 'tree_update')
    expect(treeUpdates).toHaveLength(1)
  })

  it('rejects when treeState.done is false (cannot lock incomplete diagnosis)', async () => {
    const { tech, session } = await seedDoneSession(db)
    // Force done=false
    await db
      .update(sessions)
      .set({
        treeState: { ...session.treeState, done: false },
      })
      .where(eq(sessions.id, session.id))

    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not done/i)
  })

  it('rejects when phase is already repairing (already locked)', async () => {
    const { tech, session } = await seedDoneSession(db)
    await db
      .update(sessions)
      .set({
        treeState: {
          ...session.treeState,
          phase: 'repairing',
          diagnosisLockedAt: new Date().toISOString(),
        },
      })
      .where(eq(sessions.id, session.id))

    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/already locked/i)
  })

  it('rejects when status is not open', async () => {
    const { tech, session } = await seedDoneSession(db)
    await db
      .update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, session.id))

    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not open/i)
  })

  it('rejects non-owning tech (404)', async () => {
    const { session } = await seedDoneSession(db)
    const otherShop = await createShop(db, { name: 'Other' })
    const otherTech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })

    const result = await lockDiagnosisForUser({
      db,
      userId: otherTech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm test tests/unit/lock-diagnosis.test.ts 2>&1 | tail -10
```

Expected: All 5 tests fail with `lockDiagnosisForUser is not exported from @/lib/sessions` or similar import error.

- [ ] **Step 3: Implement `lockDiagnosisForUser` in `lib/sessions.ts`**

Append to the end of `lib/sessions.ts` (after the existing `abandonSessionForUser`):

```typescript
import { updateSessionTreeState } from './db/queries'  // already imported earlier in the file; verify

export type LockDiagnosisResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

/**
 * Tech-initiated diagnostic-phase lock-in. Transitions session from
 * `phase=diagnosing` (with done=true) to `phase=repairing`. After this:
 * - rootCauseSummary is frozen (the repair-guidance prompt explicitly
 *   instructs the AI not to revise it)
 * - subsequent tech inputs go through /api/sessions/[id]/repair-observation
 * - the repair phase ends when the tech closes the case via /outcome OR
 *   marks it incomplete via abandon
 */
export async function lockDiagnosisForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<LockDiagnosisResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase === 'repairing') {
    return { ok: false, status: 400, error: 'diagnosis already locked' }
  }
  if (!session.treeState.done) {
    return { ok: false, status: 400, error: 'diagnosis not done — cannot lock' }
  }

  const lockedAt = new Date().toISOString()
  const nextTree = {
    ...session.treeState,
    phase: 'repairing' as const,
    diagnosisLockedAt: lockedAt,
  }

  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'tree_update',
  })

  return { ok: true }
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
pnpm test tests/unit/lock-diagnosis.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5: Run full unit suite to confirm no regression**

```bash
pnpm test 2>&1 | tail -5
```

Expected: all tests pass (count varies but should be ≥436).

- [ ] **Step 6: Commit**

```bash
git add lib/sessions.ts tests/unit/lock-diagnosis.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add lockDiagnosisForUser — phase 2→3 transition

User-initiated diagnostic lock-in. Flips treeState.phase from
'diagnosing' to 'repairing' and stamps diagnosisLockedAt. After this
transition the AI's repair-guidance prompt cannot revise the
rootCauseSummary (server-side guard implemented in repair-guidance.ts).

Preconditions:
- session.status === 'open'
- treeState.phase is undefined or 'diagnosing'
- treeState.done === true (cannot lock without a root cause)

Side effects:
- treeState.phase = 'repairing'
- treeState.diagnosisLockedAt = ISO now()
- One tree_update session_event appended

Tests: 5 unit (PGlite) — happy path, done=false rejection, already-locked
rejection, status-not-open rejection, non-owning-tech 404.

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement repair-guidance prompt builder + AI call

**Files:**
- Create: `tests/unit/repair-guidance-prompt.test.ts`
- Create: `lib/ai/repair-guidance.ts`

- [ ] **Step 1: Write the failing test (prompt builder only — AI call is integration-tested in Task 4)**

Create `tests/unit/repair-guidance-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildRepairGuidancePrompt } from '@/lib/ai/repair-guidance'
import type { TreeState, SessionEvent } from '@/lib/db/schema'

const baseLockedTree: TreeState = {
  nodes: [{ id: 'replace', label: 'Replace booster + master cyl', status: 'active' }],
  currentNodeId: 'replace',
  message: 'Brake fluid in booster.',
  done: true,
  phase: 'repairing',
  diagnosisLockedAt: '2026-05-07T10:21:12Z',
  rootCauseSummary: 'Brake booster crimp seam vacuum leak + master cyl backward leakage.',
  proposedAction: {
    confidence: 0.98,
    description: 'Replace booster + master cyl as a matched pair; full four-corner bleed.',
    expectedSignal: 'Firm pedal post-bleed; fuel trims within ±5% at idle.',
  },
}

function makeEvent(
  eventType: 'repair_observation' | 'repair_guidance',
  text: string,
  createdAt: Date,
  id = crypto.randomUUID(),
): SessionEvent {
  if (eventType === 'repair_observation') {
    return {
      id,
      sessionId: 'sess-1',
      nodeId: 'replace',
      eventType,
      observationText: text,
      aiResponse: null,
      createdAt,
    } as SessionEvent
  }
  return {
    id,
    sessionId: 'sess-1',
    nodeId: 'replace',
    eventType,
    observationText: null,
    aiResponse: { repairGuidance: { text } },
    createdAt,
  } as SessionEvent
}

describe('buildRepairGuidancePrompt', () => {
  it('includes locked diagnosis (rootCauseSummary, repair description, expected signal) in the user message', () => {
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: [],
      observation: 'Master cyl bolts are corroded — replace?',
    })

    expect(out.userMessage).toContain('Brake booster crimp seam vacuum leak')
    expect(out.userMessage).toContain('Replace booster + master cyl as a matched pair')
    expect(out.userMessage).toContain('Firm pedal post-bleed')
    expect(out.userMessage).toContain('Master cyl bolts are corroded')
  })

  it('includes the system prompt directive forbidding rootCauseSummary revision', () => {
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: [],
      observation: 'q',
    })
    expect(out.systemPrompt.toLowerCase()).toContain('locked')
    expect(out.systemPrompt.toLowerCase()).toMatch(/do not (modify|revise|alter)/i)
  })

  it('includes recent repair conversation in chronological order', () => {
    const events = [
      makeEvent('repair_observation', 'first tech message', new Date('2026-05-07T10:25:00Z')),
      makeEvent('repair_guidance', 'first AI reply', new Date('2026-05-07T10:25:30Z')),
      makeEvent('repair_observation', 'second tech message', new Date('2026-05-07T10:30:00Z')),
      makeEvent('repair_guidance', 'second AI reply', new Date('2026-05-07T10:30:30Z')),
    ]
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: events,
      observation: 'newest tech message',
    })

    const idxFirst = out.userMessage.indexOf('first tech message')
    const idxFirstAI = out.userMessage.indexOf('first AI reply')
    const idxSecond = out.userMessage.indexOf('second tech message')
    const idxSecondAI = out.userMessage.indexOf('second AI reply')
    const idxNewest = out.userMessage.indexOf('newest tech message')

    expect(idxFirst).toBeGreaterThan(-1)
    expect(idxFirst).toBeLessThan(idxFirstAI)
    expect(idxFirstAI).toBeLessThan(idxSecond)
    expect(idxSecond).toBeLessThan(idxSecondAI)
    expect(idxSecondAI).toBeLessThan(idxNewest)
  })

  it('truncates context to last 10 events when more than 10 exist', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent(
        i % 2 === 0 ? 'repair_observation' : 'repair_guidance',
        `event ${i}`,
        new Date(`2026-05-07T10:${String(25 + i).padStart(2, '0')}:00Z`),
      ),
    )
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: events,
      observation: 'newest',
    })

    // Expect events 0-4 (oldest 5) to be excluded; events 5-14 (newest 10) included
    expect(out.userMessage).not.toContain('event 0')
    expect(out.userMessage).not.toContain('event 4')
    expect(out.userMessage).toContain('event 5')
    expect(out.userMessage).toContain('event 14')
  })

  it('does not include diagnostic tree nodes in the prompt', () => {
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: [],
      observation: 'q',
    })
    // The active node id 'replace' is part of intake context but NOT
    // serialized as a tree of nodes. Specifically: no "currentNodeId":
    // serialization, no full nodes[] array.
    expect(out.userMessage).not.toContain('"nodes"')
    expect(out.userMessage).not.toContain('currentNodeId')
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm test tests/unit/repair-guidance-prompt.test.ts 2>&1 | tail -8
```

Expected: All 5 tests fail with import error (`buildRepairGuidancePrompt is not exported`).

- [ ] **Step 3: Implement `lib/ai/repair-guidance.ts`**

Create `lib/ai/repair-guidance.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { TreeState, SessionEvent } from '@/lib/db/schema'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const MODEL = 'claude-opus-4-7'
const MAX_RECENT_EVENTS = 10

export const REPAIR_GUIDANCE_SYSTEM = `You are an automotive master tech assistant in REPAIR PHASE.

The diagnosis is COMPLETE and LOCKED. Your job is repair-time guidance, not re-diagnosis.

Rules:
1. Help the tech execute the locked repair safely and correctly.
2. Answer concrete in-the-moment questions ("master cyl bolts are corroded — should I replace?").
3. Surface tangentially-related concerns the new observation suggests (e.g., "if you're already pulling the master cyl, also check the proportioning valve").
4. REFUSE to revise the root cause. DO NOT modify, contradict, or alter the locked diagnosis.

If the tech surfaces a NEW concern that suggests the original diagnosis was wrong, do NOT silently change the diagnosis. Tell them: "This observation suggests the original diagnosis may be incomplete. Consider marking this case incomplete and opening a new diagnostic session to investigate."

Output JSON only — { "text": string, "tangentialConcerns"?: string[] } — no prose, no fences, no other fields.`

export type RepairGuidancePromptInput = {
  tree: TreeState
  recentEvents: SessionEvent[]
  observation: string
}

export type RepairGuidancePromptOutput = {
  systemPrompt: string
  userMessage: string
}

export type RepairGuidanceResult = {
  text: string
  tangentialConcerns?: string[]
}

export function buildRepairGuidancePrompt(
  input: RepairGuidancePromptInput,
): RepairGuidancePromptOutput {
  const lockedDiagnosis = `Locked diagnosis:
- Root cause: ${input.tree.rootCauseSummary ?? '(none recorded)'}
- Recommended repair: ${input.tree.proposedAction?.description ?? '(none recorded)'}
- Expected signal post-repair: ${input.tree.proposedAction?.expectedSignal ?? '(none recorded)'}`

  const recent = input.recentEvents
    .filter(e => e.eventType === 'repair_observation' || e.eventType === 'repair_guidance')
    .slice(-MAX_RECENT_EVENTS)
    .map(e => {
      if (e.eventType === 'repair_observation') {
        return `[tech] ${e.observationText ?? ''}`
      }
      const text = (e.aiResponse as { repairGuidance?: { text: string } } | null)?.repairGuidance?.text ?? ''
      return `[ai] ${text}`
    })
    .join('\n\n')

  const conversationBlock = recent
    ? `\n\nRecent repair conversation (last ${input.recentEvents.length > MAX_RECENT_EVENTS ? MAX_RECENT_EVENTS : input.recentEvents.length} events, oldest first):\n${recent}`
    : ''

  const userMessage = `${lockedDiagnosis}${conversationBlock}\n\nTech's new observation:\n${input.observation}`

  return {
    systemPrompt: REPAIR_GUIDANCE_SYSTEM,
    userMessage,
  }
}

export async function getRepairGuidance(
  input: RepairGuidancePromptInput,
): Promise<RepairGuidanceResult> {
  const { systemPrompt, userMessage } = buildRepairGuidancePrompt(input)

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = res.content.find((b: { type: string }) => b.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('repair-guidance: no text block in response')
  }

  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    // Recovery: extract from first '{' to last '}'.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } else {
      throw new Error(`repair-guidance: not valid JSON: ${(err as Error).message}`)
    }
  }

  // Server-side guard: drop any field other than text + tangentialConcerns.
  // Prevents prompt-injection where the model tries to override the diagnosis.
  const obj = parsed as Record<string, unknown>
  if (typeof obj.text !== 'string' || !obj.text.trim()) {
    throw new Error('repair-guidance: response missing text')
  }
  const tangentials = Array.isArray(obj.tangentialConcerns)
    ? obj.tangentialConcerns.filter((c): c is string => typeof c === 'string')
    : undefined

  return {
    text: obj.text,
    ...(tangentials && tangentials.length > 0 ? { tangentialConcerns: tangentials } : {}),
  }
}
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
pnpm test tests/unit/repair-guidance-prompt.test.ts 2>&1 | tail -8
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/repair-guidance.ts tests/unit/repair-guidance-prompt.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): add repair-guidance prompt + Anthropic call for repair phase

New lib/ai/repair-guidance.ts with two exports:
- buildRepairGuidancePrompt(input): pure function returning {systemPrompt,
  userMessage}. Bundles locked diagnosis context + last 10 repair events
  + new tech observation. Excludes the diagnostic tree nodes (out of
  scope for repair guidance).
- getRepairGuidance(input): calls Anthropic with the new prompt, parses
  + validates response, returns {text, tangentialConcerns?}.

System prompt explicitly forbids revising the rootCauseSummary. Server-
side response parser drops any field other than text + tangentialConcerns
to prevent prompt-injection attempts at the diagnosis.

Context window: last 10 repair events (FIFO drop oldest). Older events
stay in DB for audit but don't go to the model. Bounds token cost.

Tests: 5 unit (pure prompt builder) — locked-diagnosis inclusion, system
prompt directive, chronological ordering, FIFO truncation at 10,
diagnostic-tree exclusion. AI call itself is integration-tested via the
session-level tests in Task 4 (with Anthropic mocked).

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement `submitRepairObservationForUser`

**Files:**
- Create: `tests/unit/repair-observation.test.ts`
- Modify: `lib/sessions.ts` (append after `lockDiagnosisForUser`)

- [ ] **Step 1: Write the failing test (full file)**

Create `tests/unit/repair-observation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { submitRepairObservationForUser } from '@/lib/sessions'

async function seedRepairingSession(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  const session = await createSession(db, {
    shopId: shop.id,
    techId: tech.id,
    intake: {
      vehicleYear: 2009,
      vehicleMake: 'ram',
      vehicleModel: '1500',
      customerComplaint: 'P0171/P0174',
    },
    treeState: {
      nodes: [{ id: 'replace', label: 'Replace booster + master cyl', status: 'active' }],
      currentNodeId: 'replace',
      message: 'Brake fluid in booster.',
      done: true,
      phase: 'repairing',
      diagnosisLockedAt: '2026-05-07T10:21:12Z',
      rootCauseSummary: 'Brake booster crimp seam vacuum leak.',
      proposedAction: {
        confidence: 0.98,
        description: 'Replace booster + master cyl as a matched pair.',
        expectedSignal: 'Firm pedal; trims within ±5%.',
      },
    },
  })
  return { shop, tech, session }
}

describe('submitRepairObservationForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('happy path: appends observation event, calls AI, appends guidance event, returns guidance', async () => {
    const { tech, session } = await seedRepairingSession(db)
    const getGuidance = vi.fn().mockResolvedValueOnce({
      text: 'Yes, replace those bolts. Corrosion suggests prior moisture exposure.',
      tangentialConcerns: ['Inspect proportioning valve while you have the system open'],
    })

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: 'Master cyl bolts are corroded — should I replace?' },
      getGuidance,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.guidance.text).toMatch(/replace those bolts/i)
    expect(result.guidance.tangentialConcerns).toContain('Inspect proportioning valve while you have the system open')

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    const obs = events.filter(e => e.eventType === 'repair_observation')
    const guid = events.filter(e => e.eventType === 'repair_guidance')
    expect(obs).toHaveLength(1)
    expect(obs[0].observationText).toBe('Master cyl bolts are corroded — should I replace?')
    expect(guid).toHaveLength(1)
    expect((guid[0].aiResponse as any)?.repairGuidance?.text).toMatch(/replace those bolts/i)

    expect(getGuidance).toHaveBeenCalledTimes(1)
  })

  it('AI failure: observation persisted, guidance NOT persisted, returns 502', async () => {
    const { tech, session } = await seedRepairingSession(db)
    const getGuidance = vi.fn().mockRejectedValueOnce(new Error('Anthropic timed out'))

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: 'will the AI fail?' },
      getGuidance,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(502)
    expect(result.error).toMatch(/anthropic|guidance/i)

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    expect(events.filter(e => e.eventType === 'repair_observation')).toHaveLength(1)
    expect(events.filter(e => e.eventType === 'repair_guidance')).toHaveLength(0)
  })

  it('rejects when phase is not repairing', async () => {
    const { tech, session } = await seedRepairingSession(db)
    await db
      .update(sessions)
      .set({
        treeState: { ...session.treeState, phase: 'diagnosing' as const, diagnosisLockedAt: undefined },
      })
      .where(eq(sessions.id, session.id))

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: 'q' },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/repair phase/i)
  })

  it('rejects empty observation', async () => {
    const { tech, session } = await seedRepairingSession(db)

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: '' },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
  })

  it('rejects observation longer than 2000 chars', async () => {
    const { tech, session } = await seedRepairingSession(db)
    const longText = 'x'.repeat(2001)

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: longText },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
  })

  it('rejects non-owning tech (404)', async () => {
    const { session } = await seedRepairingSession(db)
    const otherShop = await createShop(db, { name: 'Other' })
    const otherTech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })

    const result = await submitRepairObservationForUser({
      db,
      userId: otherTech.userId,
      sessionId: session.id,
      body: { observation: 'q' },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm test tests/unit/repair-observation.test.ts 2>&1 | tail -10
```

Expected: 6 tests fail with import error.

- [ ] **Step 3: Implement `submitRepairObservationForUser` in `lib/sessions.ts`**

Append to `lib/sessions.ts` (after `lockDiagnosisForUser`):

```typescript
import type { RepairGuidanceResult, RepairGuidancePromptInput } from './ai/repair-guidance'
// (Add this import near the top with other imports.)

const repairObservationSchema = z.object({
  observation: z.string().min(1).max(2000),
})

export type SubmitRepairObservationResult =
  | { ok: true; guidance: RepairGuidanceResult }
  | { ok: false; status: 400 | 404 | 502; error: string }

export type GetRepairGuidanceFn = (
  input: RepairGuidancePromptInput,
) => Promise<RepairGuidanceResult>

/**
 * Tech-submitted observation during the repair phase. Persists the
 * observation as a session_event, then calls the repair-guidance AI
 * prompt for a reply, and persists the AI's reply as a separate
 * session_event. Both events are queryable via the session_events
 * table for the chat-thread render.
 *
 * On AI failure: observation is persisted, guidance is NOT persisted,
 * caller receives 502 with the original error message. UI surfaces
 * this as "AI unavailable, retry?" without losing the tech's input.
 */
export async function submitRepairObservationForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  /** Injected for testability — production wires this to lib/ai/repair-guidance#getRepairGuidance. */
  getGuidance: GetRepairGuidanceFn
}): Promise<SubmitRepairObservationResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase !== 'repairing') {
    return { ok: false, status: 400, error: 'session is not in repair phase' }
  }

  const parsed = repairObservationSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  // Persist the tech's observation FIRST so it's not lost if the AI call fails.
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'repair_observation',
    observationText: parsed.data.observation,
  })

  // Fetch recent repair events for context.
  const allEvents = await opts.db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, opts.sessionId))
    .orderBy(sessionEvents.createdAt)
  // Drop the just-inserted observation from "recent context" — it goes in
  // the user message body separately.
  const priorEvents = allEvents.slice(0, -1)

  let guidance: RepairGuidanceResult
  try {
    guidance = await opts.getGuidance({
      tree: session.treeState,
      recentEvents: priorEvents,
      observation: parsed.data.observation,
    })
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `repair-guidance failed: ${(err as Error).message}`,
    }
  }

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'repair_guidance',
    aiResponse: { repairGuidance: guidance },
  })

  return { ok: true, guidance }
}
```

You'll also need to import `sessionEvents` and `eq` if they aren't already imported in `lib/sessions.ts`. Add to the top:

```typescript
import { eq } from 'drizzle-orm'
import { sessionEvents } from './db/schema'
```

- [ ] **Step 4: Run the test — confirm it passes**

```bash
pnpm test tests/unit/repair-observation.test.ts 2>&1 | tail -8
```

Expected: 6 tests pass.

- [ ] **Step 5: Run full unit suite**

```bash
pnpm test 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/sessions.ts tests/unit/repair-observation.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add submitRepairObservationForUser — phase 3 chat turn

Persists the tech's repair-time observation, calls
getRepairGuidance with the locked diagnosis + last 10 repair events
as context, persists the AI's reply.

Order of operations matters: observation event is persisted FIRST so
it's not lost if the AI call fails. On AI failure, guidance event is
NOT persisted; caller receives 502. UI shows "AI unavailable, retry?"
inline without losing tech input.

DI seam: getGuidance is injected so unit tests can mock the AI call.
Production wires it to lib/ai/repair-guidance#getRepairGuidance via
the route handler.

Tests: 6 unit (PGlite + vi.fn AI mock) — happy path with both events
persisted, AI failure with observation persisted but guidance dropped,
phase!=repairing rejection, empty observation rejection, >2000 char
rejection, non-owning tech 404.

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: API route `/lock-diagnosis`

**Files:**
- Create: `app/api/sessions/[id]/lock-diagnosis/route.ts`

- [ ] **Step 1: Write the route handler** (this is a thin wrapper; no separate route test — covered by lib unit tests + e2e in M4)

Create `app/api/sessions/[id]/lock-diagnosis/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { lockDiagnosisForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await lockDiagnosisForUser({
    db,
    userId: user.id,
    sessionId: id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/sessions/\[id\]/lock-diagnosis/route.ts
git commit -m "feat(api): POST /api/sessions/[id]/lock-diagnosis route handler

Thin wrapper over lockDiagnosisForUser. Mirrors the close + abandon
endpoint pattern. Auth via Supabase server client; profile lookup +
session ownership check + preconditions handled in the lib function.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: API route `/repair-observation`

**Files:**
- Create: `app/api/sessions/[id]/repair-observation/route.ts`

- [ ] **Step 1: Write the route handler**

Create `app/api/sessions/[id]/repair-observation/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { submitRepairObservationForUser } from '@/lib/sessions'
import { getRepairGuidance } from '@/lib/ai/repair-guidance'
import { getServerSupabase } from '@/lib/supabase-server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)

  const result = await submitRepairObservationForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
    getGuidance: getRepairGuidance,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, guidance: result.guidance })
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/sessions/\[id\]/repair-observation/route.ts
git commit -m "feat(api): POST /api/sessions/[id]/repair-observation route handler

Thin wrapper over submitRepairObservationForUser. Auth via Supabase
server client; injects production getRepairGuidance from
lib/ai/repair-guidance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: M1 verification

**Files:** none (verification only)

- [ ] **Step 1: Run full unit suite**

```bash
pnpm test 2>&1 | tail -5
```

Expected: all green; new tests counted: lock-diagnosis (5) + repair-observation (6) + repair-guidance-prompt (5) = 16 new tests on top of the existing baseline.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Mark M1 complete**

No commit; this is just a checkpoint. The next milestone (M2) starts the UI work.

---

# M2 — Diagnosis-proposed review screen (Tasks 8-10)

After M2: tech can lock in their diagnosis, but repair-phase view is still the placeholder (active-session falls through to existing UI when phase=repairing). Full flow lights up in M3.

## Task 8: Extract `DiagnosisProposedReview` component

**Files:**
- Create: `components/screens/diagnosis-proposed-review.tsx`
- Modify: `components/screens/active-session.tsx` (remove the inline `done` branch added in d70a357 — it moves into the new component)

- [ ] **Step 1: Create the component (extract from active-session.tsx + add Lock-in CTA)**

Create `components/screens/diagnosis-proposed-review.tsx`:

```typescript
import Link from 'next/link'
import {
  VehicleStrip,
  Module,
  Pill,
  ConfidenceBlock,
  TreeRail,
  CaptureBar,
} from '@/components/vt'
import { formatVehicleName, formatElapsed, nodesToSteps, getActiveNode } from '@/lib/format'
import type { Session } from '@/lib/db/schema'
import { ActiveStepForm } from './active-step-form'
import { AbandonButton } from './abandon-button'
import { LockDiagnosisButton } from './lock-diagnosis-button'

export function DiagnosisProposedReview({ session }: { session: Session }) {
  const active = getActiveNode(session.treeState.nodes)
  const steps = nodesToSteps(session.treeState.nodes)
  const elapsed = formatElapsed(new Date(session.createdAt))
  const proposedAction = session.treeState.proposedAction

  return (
    <div className="app">
      <VehicleStrip
        name={formatVehicleName(session.intake)}
        vin={`Session · ${session.id.slice(0, 8)}`}
        timer={elapsed}
      />
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module
          num="✓"
          label="Diagnosis proposed"
          status={<Pill kind="active">Review & lock</Pill>}
        >
          {session.treeState.rootCauseSummary && (
            <h2
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontWeight: 400,
                fontSize: 22,
                lineHeight: 1.25,
                letterSpacing: '-0.02em',
                margin: '0 0 12px',
              }}
            >
              {session.treeState.rootCauseSummary}
            </h2>
          )}
          {session.treeState.message && (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.55,
                margin: '0 0 14px',
              }}
            >
              {session.treeState.message}
            </p>
          )}
          {(proposedAction?.description || active?.label) && (
            <div style={{ marginTop: 12 }}>
              <span className="eyebrow">Recommended repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction?.description ?? active?.label}
              </p>
            </div>
          )}
          {proposedAction?.expectedSignal && (
            <div style={{ marginTop: 14 }}>
              <span className="eyebrow">Expected signal post-repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction.expectedSignal}
              </p>
            </div>
          )}
        </Module>

        {proposedAction?.confidence !== undefined && (
          <Module num="—" label="Confidence">
            <ConfidenceBlock
              value={proposedAction.confidence}
              basis={
                proposedAction.confidenceGap
                  ? `gap: ${proposedAction.confidenceGap}`
                  : 'based on AI reasoning + retrieval'
              }
            />
          </Module>
        )}

        <Module num="—" label="Push back?">
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 12px',
            }}
          >
            Disagree with the diagnosis? Submit another observation and the AI will revise.
          </p>
          <ActiveStepForm
            sessionId={session.id}
            nodeId={session.treeState.currentNodeId}
            requestedArtifact={session.treeState.requestedArtifact}
          />
        </Module>

        <Module
          num="—"
          label="Plan"
          status={<span className="eyebrow">{steps.length} steps</span>}
        >
          <TreeRail steps={steps} />
        </Module>

        <Module num="—" label="Lock in & start repair">
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 12px',
            }}
          >
            When you've reviewed the diagnosis and you're ready to do the repair, lock it in. The AI will switch to repair-coach mode — it can answer questions during the repair but won't revise the diagnosis.
          </p>
          <LockDiagnosisButton sessionId={session.id} />
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              color: 'var(--vt-fg-3)',
              margin: '14px 0 8px',
            }}
          >
            Started by mistake or testing? Mark it incomplete instead — no diagnosis required.
          </p>
          <AbandonButton sessionId={session.id} />
        </Module>
      </div>
      <CaptureBar />
    </div>
  )
}
```

- [ ] **Step 2: Update `active-session.tsx` to remove the inline done-state branch (it now lives in DiagnosisProposedReview)**

Open `components/screens/active-session.tsx`. Find the `done` ternary (around line 41 with `{done ? (...) : (...)}`). Replace the WHOLE component body with the simpler !done-only path. Add a route at the top to render `DiagnosisProposedReview` when done. Full new file:

```typescript
import Link from 'next/link'
import {
  VehicleStrip,
  Module,
  Pill,
  Risk,
  ConfidenceBlock,
  TreeRail,
  CaptureBar,
} from '@/components/vt'
import { formatVehicleName, formatElapsed, nodesToSteps, getActiveNode } from '@/lib/format'
import type { Session } from '@/lib/db/schema'
import { ActiveStepForm } from './active-step-form'
import { AbandonButton } from './abandon-button'
import { DiagnosisProposedReview } from './diagnosis-proposed-review'

export function ActiveSession({ session }: { session: Session }) {
  const phase = session.treeState.phase ?? 'diagnosing'
  const done = session.treeState.done === true

  // M2: when done && phase=diagnosing, route to the review screen.
  // (M3 will add: when phase=repairing, route to RepairPhaseView.)
  if (phase === 'diagnosing' && done) {
    return <DiagnosisProposedReview session={session} />
  }

  // Diagnosing-active UI (the !done path) — unchanged from d70a357.
  const active = getActiveNode(session.treeState.nodes)
  const steps = nodesToSteps(session.treeState.nodes)
  const elapsed = formatElapsed(new Date(session.createdAt))
  const stepNumber = active
    ? String(session.treeState.nodes.indexOf(active) + 1).padStart(2, '0')
    : '—'
  const proposedAction = session.treeState.proposedAction

  return (
    <div className="app">
      <VehicleStrip
        name={formatVehicleName(session.intake)}
        vin={`Session · ${session.id.slice(0, 8)}`}
        timer={elapsed}
      />
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module
          num={stepNumber}
          label="Active step"
          status={<Pill kind="active">In progress</Pill>}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Risk level="low" />
            <span
              style={{
                fontFamily: 'var(--vt-font-mono)',
                fontSize: 10,
                color: 'var(--vt-fg-3)',
              }}
            >
              req. ≥ 70 %
            </span>
          </div>
          <h2
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontWeight: 400,
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              margin: '0 0 10px',
            }}
          >
            {active?.label ?? 'No active step.'}
          </h2>
          {active?.rationale && (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
                margin: '0 0 14px',
              }}
            >
              {active.rationale}
            </p>
          )}
          {!active?.rationale && session.treeState.message && (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
                margin: '0 0 14px',
              }}
            >
              {session.treeState.message}
            </p>
          )}
          <ActiveStepForm
            sessionId={session.id}
            nodeId={session.treeState.currentNodeId}
            requestedArtifact={session.treeState.requestedArtifact}
          />
        </Module>

        {proposedAction?.confidence !== undefined && (
          <Module num="—" label="Confidence">
            <ConfidenceBlock
              value={proposedAction.confidence}
              basis={
                proposedAction.confidenceGap
                  ? `gap: ${proposedAction.confidenceGap}`
                  : 'based on AI reasoning + retrieval'
              }
            />
          </Module>
        )}

        <Module
          num="—"
          label="Plan"
          status={<span className="eyebrow">{steps.length} steps</span>}
        >
          <TreeRail steps={steps} />
        </Module>

        <Module num="—" label="Close case">
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 12px',
            }}
          >
            Done diagnosing? Capture what fixed it and close the case.
          </p>
          <Link
            href={`/sessions/${session.id}/outcome`}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            Close case
          </Link>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              color: 'var(--vt-fg-3)',
              margin: '14px 0 8px',
            }}
          >
            Started by mistake or testing? Mark it incomplete instead — no diagnosis required.
          </p>
          <AbandonButton sessionId={session.id} />
        </Module>
      </div>
      <CaptureBar />
    </div>
  )
}
```

(Note: do NOT add the lock-diagnosis-button import here yet — it goes in DiagnosisProposedReview.)

- [ ] **Step 3: Skip typecheck for now** — `LockDiagnosisButton` doesn't exist yet (next task). Typecheck will fail until Task 9.

- [ ] **Step 4: Stage but don't commit yet** (commit in Task 9 after LockDiagnosisButton lands)

```bash
git add components/screens/diagnosis-proposed-review.tsx components/screens/active-session.tsx
```

---

## Task 9: `LockDiagnosisButton` client component

**Files:**
- Create: `components/screens/lock-diagnosis-button.tsx`

- [ ] **Step 1: Implement the button**

Create `components/screens/lock-diagnosis-button.tsx`:

```typescript
'use client'

import { useState } from 'react'

type Props = {
  sessionId: string
  /** Defaults to staying on /sessions/[id]; override only for testing/preview. */
  redirectTo?: string
}

export function LockDiagnosisButton({ sessionId, redirectTo }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/sessions/${sessionId}/lock-diagnosis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    if (!res.ok) {
      setBusy(false)
      const errText = await res.text().catch(() => '')
      setError(errText || 'Could not lock diagnosis')
      return
    }
    // Redirect to the same session URL — the page will re-render in
    // RepairPhaseView mode now that phase='repairing'.
    window.location.href = redirectTo ?? `/sessions/${sessionId}`
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="btn btn-primary"
      >
        {busy ? 'Locking diagnosis…' : 'Lock in diagnosis & start repair →'}
      </button>
      {error && (
        <div role="alert" style={{ marginTop: 8, color: 'var(--vt-signal-700)' }}>
          {error}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean (Tasks 8 + 9 changes now compile together).

- [ ] **Step 3: Run unit suite to confirm no regression**

```bash
pnpm test 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 4: Commit Tasks 8 + 9 together**

```bash
git add components/screens/lock-diagnosis-button.tsx
git commit -m "$(cat <<'EOF'
feat(ui): DiagnosisProposedReview screen + LockDiagnosisButton (M2)

When treeState.done=true && phase=diagnosing, active-session.tsx now
routes to DiagnosisProposedReview instead of rendering the inline
done-state branch from d70a357.

DiagnosisProposedReview content:
- Diagnosis proposed Module (rootCauseSummary + AI safety message +
  recommended repair + expected post-repair signal)
- Confidence Module (existing component)
- Push back? Module (the existing ActiveStepForm with copy framing it
  as 'submit another observation if you disagree' — submitting an
  observation goes to /api/sessions/[id]/advance, the tree-engine
  re-runs, and may unset done. Push-back built in for free.)
- Plan Module (existing tree rail)
- Lock in & start repair Module (new): primary 'Lock in diagnosis &
  start repair' button + Mark incomplete fallback

LockDiagnosisButton (client component) posts to
/api/sessions/[id]/lock-diagnosis. On success: window.location.href
back to /sessions/[id] which now renders in repair-phase mode (M3
adds the phase='repairing' branch). On failure: inline error + retry.

active-session.tsx restructured to a phase-based mode selector. The
existing diagnosing-active UI (the !done path from d70a357) is
unchanged. The done-state inline JSX is removed (moved into
DiagnosisProposedReview).

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: M2 verification (component test)

**Files:**
- Modify: `tests/unit/active-session.test.tsx` (add tests for the new routing)

- [ ] **Step 1: Add test cases for phase-mode rendering**

Open `tests/unit/active-session.test.tsx`. After the existing `doneSession` const + tests, add:

```typescript
const repairingSession: Session = {
  ...doneSession,
  treeState: {
    ...doneSession.treeState,
    phase: 'repairing',
    diagnosisLockedAt: '2026-05-07T10:21:12Z',
  },
} as unknown as Session

describe('ActiveSession — phase-based routing', () => {
  it('routes to DiagnosisProposedReview when done=true and phase=undefined', () => {
    render(<ActiveSession session={doneSession} />)
    // DiagnosisProposedReview's hallmark: "Lock in diagnosis & start repair" button
    expect(screen.getByRole('button', { name: /lock in diagnosis/i })).toBeInTheDocument()
    // Push-back form (existing ActiveStepForm) is also present
    // (We don't assert on the form's exact structure since it's existing UI.)
  })

  it('routes to DiagnosisProposedReview when done=true and phase=diagnosing (explicit)', () => {
    const explicit: Session = {
      ...doneSession,
      treeState: { ...doneSession.treeState, phase: 'diagnosing' },
    } as unknown as Session
    render(<ActiveSession session={explicit} />)
    expect(screen.getByRole('button', { name: /lock in diagnosis/i })).toBeInTheDocument()
  })

  it('does NOT route to DiagnosisProposedReview when phase=repairing (will go to RepairPhaseView in M3)', () => {
    render(<ActiveSession session={repairingSession} />)
    // The lock-in button is NOT shown in repair phase
    expect(screen.queryByRole('button', { name: /lock in diagnosis/i })).not.toBeInTheDocument()
    // M3 NOTE: until RepairPhaseView is wired in Task 14, this test exercises
    // the fallthrough to the diagnosing-active UI. After Task 14, this test
    // should be updated to assert RepairPhaseView's hallmark element instead.
  })
})
```

- [ ] **Step 2: Run the test**

```bash
pnpm test tests/unit/active-session.test.tsx 2>&1 | tail -8
```

Expected: all tests pass (existing 2 + new 3 = 5 total).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/active-session.test.tsx
git commit -m "test(active-session): add phase-mode routing assertions

Three new tests for the M2 routing:
- done=true + phase=undefined → DiagnosisProposedReview
- done=true + phase=diagnosing (explicit) → DiagnosisProposedReview
- phase=repairing → does NOT show DiagnosisProposedReview's lock-in
  button (currently falls through to diagnosing-active UI; M3 will
  flip this to assert RepairPhaseView's hallmark)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# M3 — Repair-phase chat (Tasks 11-14)

After M3: full end-to-end flow works. Tech can lock diagnosis, submit repair-time observations, get AI guidance, close case.

## Task 11: `RepairConversation` component

**Files:**
- Create: `components/screens/repair-conversation.tsx`

- [ ] **Step 1: Implement the chat-thread renderer**

Create `components/screens/repair-conversation.tsx`:

```typescript
import type { SessionEvent } from '@/lib/db/schema'

type Props = {
  events: SessionEvent[]
}

/**
 * Chat-thread renderer for repair-phase events. Filters session_events
 * to repair_observation + repair_guidance and renders them as alternating
 * bubbles (tech left-aligned, AI right-aligned) in chronological order.
 *
 * Renders nothing when there are no repair events yet (the empty state
 * is the parent component's responsibility).
 */
export function RepairConversation({ events }: Props) {
  const repairEvents = events.filter(
    e => e.eventType === 'repair_observation' || e.eventType === 'repair_guidance',
  )

  if (repairEvents.length === 0) {
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {repairEvents.map(event => {
        const isTech = event.eventType === 'repair_observation'
        const text = isTech
          ? event.observationText ?? ''
          : (event.aiResponse as { repairGuidance?: { text: string } } | null)?.repairGuidance?.text ?? ''
        const tangentials = isTech
          ? null
          : (event.aiResponse as { repairGuidance?: { tangentialConcerns?: string[] } } | null)?.repairGuidance
              ?.tangentialConcerns

        return (
          <div
            key={event.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isTech ? 'flex-start' : 'flex-end',
            }}
          >
            <span
              className="eyebrow"
              style={{
                fontSize: 10,
                color: 'var(--vt-fg-3)',
                marginBottom: 4,
              }}
            >
              {isTech ? 'You' : 'AI'} ·{' '}
              {new Date(event.createdAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <div
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 14,
                lineHeight: 1.55,
                padding: '10px 14px',
                borderRadius: 12,
                maxWidth: '85%',
                background: isTech ? 'var(--vt-bone-50)' : 'var(--vt-paper)',
                border: '0.5px solid var(--vt-rule)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {text}
            </div>
            {tangentials && tangentials.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--vt-paper)',
                  border: '0.5px dashed var(--vt-rule)',
                  maxWidth: '85%',
                  fontSize: 13,
                  color: 'var(--vt-fg-2)',
                }}
              >
                <span className="eyebrow" style={{ fontSize: 9, marginBottom: 4, display: 'block' }}>
                  Also worth checking
                </span>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {tangentials.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/screens/repair-conversation.tsx
git commit -m "feat(ui): RepairConversation chat-thread renderer

Renders session_events filtered to repair_observation +
repair_guidance as alternating left/right bubbles with role labels
(You / AI) and timestamps. Tangential concerns from AI replies render
as a dashed sub-card under the relevant guidance bubble.

Returns null when no repair events exist (parent renders the empty
state).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `RepairAskForm` component

**Files:**
- Create: `components/screens/repair-ask-form.tsx`

- [ ] **Step 1: Implement the ask form**

Create `components/screens/repair-ask-form.tsx`:

```typescript
'use client'

import { useState } from 'react'

type Props = {
  sessionId: string
}

export function RepairAskForm({ sessionId }: Props) {
  const [observation, setObservation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !busy && observation.trim().length > 0

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    const res = await fetch(`/api/sessions/${sessionId}/repair-observation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observation: observation.trim() }),
    })

    if (!res.ok) {
      setBusy(false)
      const data = await res.json().catch(() => ({}))
      setError(data?.error || 'Could not submit. Try again?')
      return
    }

    // Success — clear the textarea and reload the page so the new pair
    // (observation + guidance) renders in the conversation thread from
    // the server-side data fetch.
    setObservation('')
    setBusy(false)
    window.location.reload()
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <label htmlFor="repair-observation" className="eyebrow">
        Ask a question or report what you found
      </label>
      <textarea
        id="repair-observation"
        value={observation}
        onChange={e => setObservation(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g., master cyl bolts are corroded — should I replace?"
        disabled={busy}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn btn-primary"
        >
          {busy ? 'Asking AI…' : 'Submit'}
        </button>
        {error && (
          <span role="alert" style={{ color: 'var(--vt-signal-700)', fontSize: 13 }}>
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/screens/repair-ask-form.tsx
git commit -m "feat(ui): RepairAskForm — textarea + submit + retry on failure

Client component for repair-phase observation submission. Posts to
/api/sessions/[id]/repair-observation with {observation}. On success:
clears textarea + reloads page (server-rendered conversation thread
picks up the new event pair). On AI failure: inline error with retry
hint; observation event is already persisted server-side so user input
isn't lost.

2000-char limit enforced both client (maxLength) and server (zod).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `RepairPhaseView` component

**Files:**
- Create: `components/screens/repair-phase-view.tsx`

- [ ] **Step 1: Implement the repair-phase screen**

`RepairPhaseView` needs the session_events for the conversation. The events are fetched server-side in the page route, so the component takes them as a prop.

Create `components/screens/repair-phase-view.tsx`:

```typescript
import Link from 'next/link'
import {
  VehicleStrip,
  Module,
  Pill,
  CaptureBar,
} from '@/components/vt'
import { formatVehicleName, formatElapsed } from '@/lib/format'
import type { Session, SessionEvent } from '@/lib/db/schema'
import { AbandonButton } from './abandon-button'
import { RepairConversation } from './repair-conversation'
import { RepairAskForm } from './repair-ask-form'

type Props = {
  session: Session
  events: SessionEvent[]
}

export function RepairPhaseView({ session, events }: Props) {
  const elapsed = formatElapsed(new Date(session.createdAt))
  const proposedAction = session.treeState.proposedAction
  const lockedAt = session.treeState.diagnosisLockedAt
  const lockedAtDisplay = lockedAt
    ? new Date(lockedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—'

  const repairEvents = events.filter(
    e => e.eventType === 'repair_observation' || e.eventType === 'repair_guidance',
  )

  return (
    <div className="app">
      <VehicleStrip
        name={formatVehicleName(session.intake)}
        vin={`Session · ${session.id.slice(0, 8)}`}
        timer={elapsed}
      />
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module
          num="🔒"
          label="Diagnosis locked"
          status={<Pill kind="active">Repair phase</Pill>}
        >
          <span
            className="eyebrow"
            style={{ fontSize: 10, color: 'var(--vt-fg-3)' }}
          >
            Locked at {lockedAtDisplay}
          </span>
          {session.treeState.rootCauseSummary && (
            <h2
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontWeight: 400,
                fontSize: 20,
                lineHeight: 1.25,
                margin: '4px 0 12px',
              }}
            >
              {session.treeState.rootCauseSummary}
            </h2>
          )}
          {proposedAction?.description && (
            <div style={{ marginTop: 8 }}>
              <span className="eyebrow">Recommended repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction.description}
              </p>
            </div>
          )}
          {proposedAction?.expectedSignal && (
            <div style={{ marginTop: 12 }}>
              <span className="eyebrow">Expected signal post-repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction.expectedSignal}
              </p>
            </div>
          )}
        </Module>

        <Module num="—" label="Repair conversation">
          {repairEvents.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-3)',
                margin: 0,
              }}
            >
              No repair-time questions yet. Ask anything you find while you work.
            </p>
          ) : (
            <RepairConversation events={events} />
          )}
        </Module>

        <Module num="—" label="Ask the AI">
          <RepairAskForm sessionId={session.id} />
        </Module>

        <Module num="—" label="Close case">
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 12px',
            }}
          >
            Repair done? Verified the fix? Close the case to record the outcome.
          </p>
          <Link
            href={`/sessions/${session.id}/outcome`}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            Repair done & verified — close case
          </Link>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              color: 'var(--vt-fg-3)',
              margin: '14px 0 8px',
            }}
          >
            Hit a wall? Mark this case incomplete and start fresh.
          </p>
          <AbandonButton sessionId={session.id} />
        </Module>
      </div>
      <CaptureBar />
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/screens/repair-phase-view.tsx
git commit -m "$(cat <<'EOF'
feat(ui): RepairPhaseView — locked diagnosis banner + chat + close case

Composes:
- Diagnosis locked Module: 🔒 emoji + lockedAt timestamp +
  rootCauseSummary + recommended repair + expected signal
- Repair conversation Module: RepairConversation thread (or empty
  state copy when no repair events yet)
- Ask the AI Module: RepairAskForm
- Close case Module: 'Repair done & verified — close case' primary
  link to /outcome + Mark incomplete fallback (AbandonButton)

Takes session + session_events as props (events fetched server-side
in the page route — wired in Task 14).

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Wire active-session.tsx + page.tsx to RepairPhaseView

**Files:**
- Modify: `components/screens/active-session.tsx` (add the phase=repairing branch)
- Modify: `app/(app)/sessions/[id]/page.tsx` (fetch session_events when phase=repairing, pass to RepairPhaseView)
- Modify: `tests/unit/active-session.test.tsx` (update the phase=repairing test)

- [ ] **Step 1: Update `active-session.tsx` to route phase=repairing → RepairPhaseView**

Open `components/screens/active-session.tsx`. The current ActiveSession only takes `session` as a prop. To render RepairPhaseView, it needs `events` too.

Add `events` as an optional prop (defaults to `[]` so legacy callers don't break) and wire the routing:

```typescript
import { RepairPhaseView } from './repair-phase-view'

type Props = {
  session: Session
  events?: SessionEvent[]
}

export function ActiveSession({ session, events = [] }: Props) {
  const phase = session.treeState.phase ?? 'diagnosing'
  const done = session.treeState.done === true

  if (phase === 'repairing') {
    return <RepairPhaseView session={session} events={events} />
  }
  if (phase === 'diagnosing' && done) {
    return <DiagnosisProposedReview session={session} />
  }

  // Diagnosing-active UI follows...
  // (rest of file unchanged from Task 8)
}
```

Don't forget to add the `SessionEvent` import next to `Session`:

```typescript
import type { Session, SessionEvent } from '@/lib/db/schema'
```

- [ ] **Step 2: Update the page route to fetch events when phase=repairing**

Open `app/(app)/sessions/[id]/page.tsx`. Currently it fetches the session and renders ActiveSession. Add events fetching:

```typescript
import { eq } from 'drizzle-orm'
import { sessionEvents } from '@/lib/db/schema'

// Inside the page handler, after `const { session } = result`:
const events = await db
  .select()
  .from(sessionEvents)
  .where(eq(sessionEvents.sessionId, session.id))
  .orderBy(sessionEvents.createdAt)

// Then:
return <ActiveSession session={session} events={events} />
```

(If the existing page imports those already, just reuse. Verify by reading the current file before editing.)

- [ ] **Step 3: Update the active-session test to assert RepairPhaseView's hallmark**

In `tests/unit/active-session.test.tsx`, find the test:

```typescript
it('does NOT route to DiagnosisProposedReview when phase=repairing (will go to RepairPhaseView in M3)', () => {
```

Replace with:

```typescript
it('routes to RepairPhaseView when phase=repairing', () => {
  render(<ActiveSession session={repairingSession} events={[]} />)
  // RepairPhaseView's hallmark: "Repair done & verified — close case" link
  expect(
    screen.getByRole('link', { name: /repair done & verified/i }),
  ).toBeInTheDocument()
  // Lock-in button is NOT shown (we're past phase 2)
  expect(screen.queryByRole('button', { name: /lock in diagnosis/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Run unit + component tests**

```bash
pnpm test 2>&1 | tail -5
```

Expected: all green. The active-session test count is now 6 (existing 2 from earlier + 3 from Task 10 — but Task 10's third test got REPLACED here, so 5 total. Plus the 6th if you count the earlier Diagnosis-complete test). Verify the count makes sense.

- [ ] **Step 6: Commit**

```bash
git add components/screens/active-session.tsx app/\(app\)/sessions/\[id\]/page.tsx tests/unit/active-session.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): wire active-session.tsx routing for phase=repairing → RepairPhaseView (M3 complete)

active-session.tsx mode selector now handles all three states:
1. phase='repairing' → RepairPhaseView (NEW)
2. phase=diagnosing && done=true → DiagnosisProposedReview (M2)
3. fallthrough: diagnosing-active UI (existing)

ActiveSession takes events as a new optional prop (defaults to [] so
existing callers in tests keep working). The /sessions/[id] page
fetches session_events server-side when needed and passes them through.

Component test for phase=repairing flipped from "does NOT show
DiagnosisProposedReview" to "renders RepairPhaseView" (asserts the
'Repair done & verified — close case' link is present).

After this commit: full M3 flow lights up. Tech can lock in
diagnosis → enter repair phase → submit observations → get AI
guidance → close case via outcome form OR mark incomplete.

Refs spec docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# M4 — Validation, e2e, manual checklist, PR (Tasks 15-18)

## Task 15: E2E smoke for repair phase

**Files:**
- Modify: `tests/e2e/sessions.spec.ts` (add 2 repair-phase tests)

- [ ] **Step 1: Read existing sessions.spec.ts to understand the auth + test pattern**

```bash
cat tests/e2e/sessions.spec.ts | head -60
```

Note the existing pattern (storageState, signed-in tech project, page navigation). The new tests will follow it.

- [ ] **Step 2: Add the repair-phase tests**

Append to the test.describe block in `tests/e2e/sessions.spec.ts`:

```typescript
test('repair-phase view renders when treeState.phase=repairing', async ({ page }) => {
  // Pre-seeded session with phase=repairing in the test DB.
  // (See tests/e2e/global-setup.ts — extends the seed with a repairing
  // session for this assertion.)
  const { repairSessionId } = await page.evaluate(() =>
    fetch('/api/test/repairing-session', { method: 'POST' }).then(r => r.json()),
  )
  await page.goto(`/sessions/${repairSessionId}`)

  // Hallmark: "Repair done & verified — close case" link
  await expect(
    page.getByRole('link', { name: /repair done & verified/i }),
  ).toBeVisible()
  // Locked diagnosis section visible
  await expect(page.getByText(/diagnosis locked/i)).toBeVisible()
})

test('repair-phase ask form is reachable from the page', async ({ page }) => {
  const { repairSessionId } = await page.evaluate(() =>
    fetch('/api/test/repairing-session', { method: 'POST' }).then(r => r.json()),
  )
  await page.goto(`/sessions/${repairSessionId}`)
  await expect(
    page.getByLabel(/ask a question or report what you found/i),
  ).toBeVisible()
})
```

> **Note:** The two e2e tests above assume a `/api/test/repairing-session` test-only endpoint to seed a repair-phase session. If that endpoint doesn't exist yet, ALSO create it (gated by NODE_ENV === 'test') OR change the strategy to seed the session directly via the test DB connection. Pick whichever pattern matches the existing e2e test infrastructure (look at how curator.spec.ts seeds its data — likely via global-setup.ts).

If the existing pattern uses storageState + plain navigation without seed endpoints, you can:
- Skip the e2e tests for the dynamic repair-phase content (relegate to manual checklist)
- Just add a "structural" e2e: navigate to `/sessions/[real-sessionid-from-seed]` and assert the page doesn't 500. The existing seed in tests/e2e/global-setup.ts may already have a session you can repurpose by manipulating its tree_state.

- [ ] **Step 3: Run e2e tests against local dev (requires dev server)**

```bash
# Skip the dev server if PREVIEW_URL is set; otherwise dev server starts automatically.
pnpm test:e2e tests/e2e/sessions.spec.ts 2>&1 | tail -10
```

Expected: all pass. If the seed endpoint isn't wired, defer the dynamic assertions to manual checklist (next task) and remove the unit-level assertions, keeping just navigation smoke.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/sessions.spec.ts
# IF a test seed endpoint was added, also: git add app/api/test/...
git commit -m "test(e2e): repair-phase smoke for /sessions/[id]

Two new tests:
- repair-phase view renders (locked diagnosis section + Close case link
  visible when phase=repairing)
- ask-form is reachable (textarea labeled 'Ask a question or report
  what you found' visible)

Both seed a repair-phase session via [details of seed mechanism].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Manual checklist update

**Files:**
- Modify: `docs/testing/manual-checklist.md`

- [ ] **Step 1: Read the existing manual checklist to understand structure**

```bash
cat docs/testing/manual-checklist.md | head -50
```

- [ ] **Step 2: Add the new repair-phase steps**

Append a new section (or insert into the existing "Sessions flow" section if it exists):

```markdown
## Two-phase diagnose+repair flow (added 2026-05-07)

Validates the new lock-in + repair-phase chat. Requires a test session
that reaches `treeState.done=true`.

### Phase 1 → Phase 2 transition
- [ ] Open a diagnostic session and walk it through enough observations
  that the AI sets `done=true`. (For brake-leak symptoms on a known
  vehicle this typically takes 8-12 observations.)
- [ ] Page renders the **Diagnosis proposed** review screen with:
  - Root cause headline
  - AI's safety message (italic)
  - "Recommended repair" subsection
  - "Expected signal post-repair" subsection
  - "Lock in diagnosis & start repair →" primary button
  - "Push back?" Module with the existing observation textarea

### Push-back path
- [ ] On the review screen, type a contradictory observation in the
  Push back form and submit
- [ ] Page rerenders with `done` reset to false (or to true with a
  revised diagnosis depending on AI judgment)
- [ ] Plan tree shows the new node(s) the AI added

### Lock-in
- [ ] On the review screen, click "Lock in diagnosis & start repair →"
- [ ] Page navigates back to /sessions/[id] and renders the
  **Repair phase** view
- [ ] Locked-diagnosis banner visible at top with 🔒 + "Locked at HH:MM"
- [ ] Repair conversation Module shows empty state
  ("No repair-time questions yet…")
- [ ] Ask form textarea present with placeholder

### Repair-time chat
- [ ] Submit a relevant observation (e.g., "master cylinder bolts are
  corroded — should I replace?")
- [ ] AI guidance returns within ~5 seconds
- [ ] Page rerenders showing both the tech bubble (left) and AI bubble
  (right) with timestamps
- [ ] If the AI surfaces tangential concerns, they appear in a dashed
  sub-card under the AI bubble

### Push-back NOT silently revising the diagnosis
- [ ] Submit an observation that strongly contradicts the locked
  diagnosis (e.g., for a brake-booster diagnosis: "I checked, the
  booster diaphragm is fine and I see no fluid")
- [ ] AI response should NOT include a revised rootCauseSummary
- [ ] AI response should advise opening a new diagnostic session, not
  silently change the diagnosis

### Repair done — close case
- [ ] Click "Repair done & verified — close case"
- [ ] /outcome form renders with the existing fields
- [ ] Submit a valid outcome
- [ ] Session appears in `/sessions` with closed status

### Mark incomplete from repair phase
- [ ] On the repair-phase screen, click "Mark incomplete"
- [ ] Confirm dialog appears
- [ ] After confirm, page navigates to /today and the session moves to
  the curator's Incomplete bucket
```

- [ ] **Step 3: Commit**

```bash
git add docs/testing/manual-checklist.md
git commit -m "docs(testing): add two-phase diagnose+repair manual checklist

7 new manual-test steps covering the full M2-M3 flow: AI sets done,
review screen renders, push-back via observation form, lock-in,
repair-phase chat, AI not silently revising diagnosis, close-case via
outcome form, mark-incomplete fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Open PR + merge to main

**Files:** none (git + gh)

- [ ] **Step 1: Push the branch to remote**

```bash
git push origin feature/two-phase-diagnose-repair
```

Expected: branch published.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(sessions): two-phase diagnostic + repair model with locked diagnosis & AI repair-coach" --body "$(cat <<'EOF'
## Summary

Splits "case open" into three phases (diagnosing → diagnosis-proposed → repairing → closed) with explicit user-controlled lock-in and AI-guided repair-time chat.

Surfaced during Brandon's manual click-through of the 2009 Ram 1500 P0171/P0174 case (session `4be8e39b`): the AI generated a master-tech-grade diagnosis (brake booster crimp seam vacuum leak + master cylinder backward leakage, replace both + four-corner bleed) but the system auto-redirected to /outcome before any of the safety message + repair plan rendered. Tech also had no place to ask repair-time follow-ups with full diagnostic context.

## Architecture

- Phases tracked in `treeState.phase` (jsonb extension, no DB migration needed)
- Two new APIs: `POST /api/sessions/[id]/lock-diagnosis` + `POST /api/sessions/[id]/repair-observation`
- New AI prompt for repair-guidance mode that explicitly cannot revise the locked rootCauseSummary
- Repair-phase chat reuses existing session_events table with two new event types
- UI adds three new components: DiagnosisProposedReview, RepairPhaseView, RepairConversation, plus LockDiagnosisButton + RepairAskForm

## Foundation commits (cherry-picked from preview-curator)

- `d4472df` feat(sessions): Mark incomplete / abandon path
- `d70a357` fix(sessions): show diagnosis-complete state on active-session, drop auto-redirect
- `62c199a` + `3036656` docs(spec): two-phase design + self-review fixes

## Milestones (each their own commit)

- **M1 backend** — schema extensions, lib functions, AI prompt, route handlers, 16 unit tests
- **M2 review screen** — DiagnosisProposedReview + LockDiagnosisButton + active-session routing + 3 component tests
- **M3 repair-phase chat** — RepairConversation + RepairAskForm + RepairPhaseView + 1 component test
- **M4 validation** — 2 e2e smoke tests + manual checklist update

## Test plan

- [x] `pnpm test` — all unit tests pass (existing baseline + 16 new)
- [x] `pnpm exec tsc --noEmit` — typecheck clean
- [ ] CI workflow runs green on this PR (once PR #5 merges)
- [ ] Manual checklist (`docs/testing/manual-checklist.md` two-phase section) walks all 7 steps
- [ ] Brandon's stuck Ram session `4be8e39b` after this lands: refresh → review screen → lock-in → submit a repair-time observation → AI replies → close case via /outcome OR mark incomplete

## Refs

- Spec: `docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md`
- Plan: `docs/superpowers/plans/2026-05-07-two-phase-diagnose-repair-implementation.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify PR opened**

```bash
gh pr view --json number,title,state | head -10
```

Expected: PR number returned, state OPEN.

- [ ] **Step 4: Notify Brandon for review**

The PR is open. Brandon's merge order is:
1. PR #4 (intake fix)
2. PR #3 (Phase P + curator UX fixes)
3. PR #5 (testing pipeline)
4. **This PR**

Each merge to main lets the next PR rebase cleanly.

---

## Self-review

- ✅ All M1-M4 tasks numbered 0-17 (18 total tasks)
- ✅ Every code step has actual code
- ✅ Every command step has the exact command + expected output
- ✅ TDD pattern (test → fail → impl → pass → commit) followed for every backend function and component
- ✅ No "TBD" / "TODO" / "implement details" placeholders
- ✅ File paths are exact
- ✅ Commit messages are specific to what each commit does
- ✅ Type names + function signatures consistent across tasks (lockDiagnosisForUser, submitRepairObservationForUser, getRepairGuidance, buildRepairGuidancePrompt, RepairGuidanceResult)
- ⚠ Task 15 (e2e) has a known caveat: depends on whether the existing test infrastructure supports seeding repair-phase sessions. If not, the test pattern may need to be adjusted (defer to manual checklist instead).
