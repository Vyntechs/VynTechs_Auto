# Spec: Two-phase diagnostic + repair model

**Date:** 2026-05-07
**Status:** Design approved by Brandon (implementation plan pending)

## Motivation

Surfaced during manual click-through of Brandon's 2009 Ram 1500 P0171/P0174 case (session `4be8e39b`). The current state machine collapses two distinct user phases into one transition:

1. **Diagnostic phase** — AI builds a tree of investigation steps, tech submits observations, AI converges on a root cause.
2. **Repair phase** — tech executes the recommended repair, may discover related issues, needs continued AI guidance.

Today, the moment the AI sets `treeState.done = true`, the active-session view (after `d70a357`) renders the diagnosis but offers only one terminal action: "Close case → outcome form." This forces the tech to commit before doing the repair, and there is no place for repair-time discoveries ("master cyl bolts are corroded — should I replace?") to land or get AI guidance with full diagnostic context.

## Goal

Split "case open" into three explicit phases. Insert a "diagnosis proposed → tech reviews → tech locks in" event between diagnostic completion and case close, and support AI-guided execution during repair.

## Non-goals (v1)

- Reverting from `repairing` back to `diagnosing` mid-session (one-way commit; mark incomplete + new session is the workaround)
- Multi-tech handoff during a single session
- Customer-facing repair quote generation
- Photo/scan artifacts during repair phase (existing capture infra would handle, but no new UX entry point)
- Auto-detected repair completion via observations (no AI-confirmed verification — tech self-attests)
- Voice/audio input for repair-time chat
- Reverting the lock once set

## Architecture

### State machine

```
[open + diagnosing]
        |
        | tech submits observations; AI builds tree
        v
[open + diagnosing + done=true] ← Diagnosis-proposed review screen renders
        |
        +→ tech submits another observation → AI may unset done; tree continues
        |   (push-back built into the existing ActiveStepForm — no new UI)
        |
        +→ tech clicks "Lock in diagnosis & start repair"
        |   phase: 'diagnosing' → 'repairing'
        |   diagnosisLockedAt: now()
        v
[open + repairing]
        |
        | tech submits repair observations; AI replies in repair-guidance mode
        | session_events accumulate (audit trail)
        v
        +→ tech clicks "Repair done — close case"
        |   → /sessions/[id]/outcome (existing OutcomeCapture flow)
        |   status: 'open' → 'closed'
        |
        +→ tech clicks "Mark incomplete" (existing AbandonButton)
            status: 'open' → 'deferred'
```

Phases are tracked in `treeState.phase`, NOT `session.status`. The session remains `status='open'` throughout phases 1–3; only close-case or mark-incomplete actions change `status`. This keeps the existing session lifecycle intact and avoids a new enum value or DB migration.

### Phase definitions

| Phase | Trigger | UI mode | AI behavior |
|---|---|---|---|
| `diagnosing` (in progress) | Default for new sessions | Active step Module + ActiveStepForm | tree-engine prompt; may set `done=true` |
| `diagnosing` (done) | AI sets `treeState.done=true` | Diagnosis-proposed review screen + Lock-in button + ActiveStepForm | tree-engine prompt; further observations may unset `done` |
| `repairing` | Tech clicks "Lock in diagnosis" | Repair-phase chat UI | repair-guidance prompt; cannot modify rootCauseSummary |

## Data model

### Schema changes

`treeState` (jsonb on `sessions.tree_state`) gains two optional fields:

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
  // NEW:
  phase?: 'diagnosing' | 'repairing'  // undefined → treated as 'diagnosing'
  diagnosisLockedAt?: string           // ISO timestamp, set when phase flips to 'repairing'
}
```

No DB migration needed — `tree_state` is jsonb. Existing in-flight sessions implicitly have `phase=undefined`, treated as `'diagnosing'` by all consumers.

### New session_events types

The `eventType` enum on `session_events` extends to:

```typescript
eventType: 'advance' | 'observation' | 'tree_update' | 'close'
  | 'repair_observation'  // NEW: tech-submitted text during repair phase
  | 'repair_guidance'     // NEW: AI reply during repair phase
```

Both new types reuse existing columns:
- `observation_text` for the text payload
- `ai_response` JSONB for AI reply structure
- `node_id` references the active node at time of event (`replace-brake-booster` etc.)

The `aiResponse` $type extends with:

```typescript
repairGuidance?: {
  text: string                    // markdown-ish guidance content
  tangentialConcerns?: string[]   // optional list of side-issues AI flagged
}
```

## API surface

### NEW: `POST /api/sessions/[id]/lock-diagnosis`

**Auth:** Owning tech only (mirrors the close + abandon endpoint pattern).

**Preconditions:**
- `session.status === 'open'`
- `treeState.phase` is undefined or `'diagnosing'`
- `treeState.done === true` (cannot lock a tree without a root cause)

**Effect:**
- Sets `treeState.phase = 'repairing'`
- Sets `treeState.diagnosisLockedAt = new Date().toISOString()`
- Persists via `updateSessionTreeState`
- Appends a `session_event` of type `tree_update` (timestamp marker; no aiResponse payload — the phase + diagnosisLockedAt mutation on tree_state is the primary record)

**Response:** `{ ok: true }` or appropriate 4xx (`{ error: 'not done' | 'not owning tech' | 'already locked' }`).

### NEW: `POST /api/sessions/[id]/repair-observation`

**Auth:** Owning tech only.

**Preconditions:**
- `session.status === 'open'`
- `treeState.phase === 'repairing'`

**Body:**
```typescript
{ observation: string }   // 1..2000 chars
```

**Effect:**
1. Append `session_event { eventType: 'repair_observation', observationText: observation }`
2. Build repair-guidance AI prompt (see below) with locked diagnosis + last 10 repair events as context + new observation
3. Call Anthropic; parse repair-guidance response
4. Append `session_event { eventType: 'repair_guidance', aiResponse: { repairGuidance: {...} } }`

**Response:** `{ ok: true; guidance: { text: string; tangentialConcerns?: string[] } }`

If the AI call fails (network / parse / rate-limit): the observation event IS persisted, the guidance event is NOT, and the API returns 502 with the observation event id so the UI can show "AI unavailable, retry?" without losing the tech's input.

### Existing: `POST /api/sessions/[id]/close`

No signature change. Still gated by `session.status === 'open'`. UI link to `/outcome` is now reachable from RepairPhaseView. Legacy compatibility: pre-this-change sessions with `done=true` and `phase=undefined` can still close (no migration backfill required).

### Existing: `POST /api/sessions/[id]/advance` (diagnostic path)

No signature change. Implicitly gated to `phase !== 'repairing'`. If a request arrives while `phase === 'repairing'`, return 400 (`"session is in repair phase; submit via /repair-observation"`).

## AI prompt — repair-guidance mode

New system prompt for the repair-phase Anthropic call. Replaces the `TREE_ENGINE_SYSTEM` prompt for these calls. Lives in `lib/ai/repair-guidance.ts`.

System prompt (skeleton):

```
You are an automotive master tech assistant in REPAIR PHASE.

The diagnosis is COMPLETE and LOCKED:
- Root cause: <treeState.rootCauseSummary>
- Recommended repair: <treeState.proposedAction.description>
- Expected post-repair signal: <treeState.proposedAction.expectedSignal>

Your job:
1. Help the tech execute the locked repair safely and correctly.
2. Answer concrete in-the-moment questions ("master cyl bolts are
   corroded, should I replace?").
3. Surface tangentially-related concerns the new observation suggests
   (e.g., "if you're already pulling the master cyl, also check the
   proportioning valve").
4. Refuse to revise the root cause. Do not modify, contradict, or
   alter the diagnosis.

If the tech surfaces a NEW concern that suggests the original
diagnosis was wrong, do NOT silently change the diagnosis. Tell them:
"This observation suggests the original diagnosis may be incomplete.
Consider marking this case incomplete and opening a new diagnostic
session to investigate."

Output JSON only — { text: string, tangentialConcerns?: string[] } —
no prose, no fences.
```

User message at each turn:

```
Locked diagnosis:
- rootCauseSummary: <...>
- recommendedRepair: <...>
- expectedSignal: <...>

Recent repair conversation (last 10 events):
[chronological list of {role: 'tech'|'ai', text: ...}]

Tech's new observation:
<observation>
```

Server-side guard: parse the response and DROP any field other than `text` and `tangentialConcerns`. The schema doesn't accept `rootCauseSummary` or `done`. This prevents prompt-injection-style attacks where the model tries to override the diagnosis.

`N=10` for context window: balances coherence with token cost. Older events stay in DB for audit but don't go to the model. If a session has fewer than 10 repair events, all are included.

## UI states

### `active-session.tsx` mode selection

```typescript
const phase = session.treeState.phase ?? 'diagnosing'
const done = session.treeState.done === true

if (phase === 'repairing') return <RepairPhaseView session={session} />
if (phase === 'diagnosing' && done) return <DiagnosisProposedReview session={session} />
// fallthrough: existing diagnosing-active UI (in-progress tree)
```

Three rendered components:

#### Component 1: existing diagnosing-active UI

No change from `d70a357`. Active step Module, ActiveStepForm, etc.

#### Component 2: `DiagnosisProposedReview` (new)

Replaces the current done-state UI in `active-session.tsx` (the diagnosis-complete Module added in `d70a357`).

Layout:
- **Diagnosis Module** — rootCauseSummary headline, treeState.message paragraph, recommended repair, expected signal (same content as today's done-state Module).
- **Push back? Module** — the existing ActiveStepForm with copy: "Disagree with the diagnosis? Submit another observation and the AI will revise."
- **Confidence Module** — existing, if proposedAction.confidence is set.
- **Plan Module** — existing tree rail.
- **Lock in & repair Module** — copy: "When you've reviewed the diagnosis and you're ready to do the repair, lock it in. AI will switch to repair-coach mode." Primary button: "Lock in diagnosis & start repair →" (calls `/lock-diagnosis`). Sub-text: "Started by mistake or testing?" → AbandonButton (existing).

#### Component 3: `RepairPhaseView` (new)

Layout:
- **Locked diagnosis Module** — sticky/pinned visual treatment. Shows rootCauseSummary, proposedAction.description, proposedAction.expectedSignal, plus a small "Diagnosis locked at HH:MM" timestamp from `diagnosisLockedAt`.
- **Conversation Module (`RepairConversation`)** — renders session_events filtered to types `['repair_observation', 'repair_guidance']` in chronological order. Chat-bubble layout with role labels (Tech / AI).
- **Ask Module** — textarea for the next observation. Submit button calls `/repair-observation`. While in flight: spinner state. On success: append the new pair (observation + guidance) to the thread. On AI failure: show inline error with retry, observation already persisted.
- **Close case Module** — copy: "Repair done? Verified the fix? Close the case to record the outcome." Primary button → link to `/sessions/[id]/outcome` (existing OutcomeCapture). AbandonButton (existing) as fallback.

## Migration / legacy handling

Sessions created before this ships have `treeState.phase === undefined`. Routing treats undefined as `'diagnosing'`. They can still:
- Continue diagnosing (existing flow)
- Reach `done=true` (existing behavior)
- Lock in to repair phase (new button on the review screen)

Brandon's stuck session `4be8e39b` is one such legacy session. After this ships:
1. Refresh `/sessions/4be8e39b...`
2. Lands on DiagnosisProposedReview (new) with the existing rootCauseSummary, message, repair plan rendered.
3. Click "Lock in diagnosis & start repair" → enters repair phase.
4. Submit a real follow-up to validate the repair-guidance flow.
5. Close case via outcome form OR mark incomplete.

No data migration script needed.

## Edge cases

| Case | Handling |
|---|---|
| Tech clicks Lock-in when `done=false` | Button hidden in UI; API also rejects (400) |
| Repair observation submitted while `phase='diagnosing'` | API returns 400; UI route prevents it |
| AI repair-guidance call fails (network/Anthropic/parse) | Observation event persisted; guidance event not. API returns 502. UI shows error inline with retry button. |
| AI tries to set `rootCauseSummary` in repair-guidance response | Server-side parser drops the field. Schema doesn't accept it. |
| Tech wants to re-diagnose after locking | v1: not supported. Mark incomplete + open new diagnostic session. |
| Two browser tabs interact with same session | Last-write-wins on tree_state; chat events append independently. Acceptable. |
| Decline-or-defer mid-diagnosing (gate.allow=false) | Existing flow unchanged. Phase 1 only. |
| Tech submits 0-character observation | API 400 (zod validation, min=1). |
| Tech submits >2000-char observation | API 400 (zod validation, max=2000). |
| Repair-guidance response contains content longer than expected | Truncate display at ~5000 chars in UI; full content stored in DB. |

## Test plan

### Unit (vitest, PGlite)

- **`lockDiagnosisForUser`**:
  - Happy path: open + diagnosing + done → flips phase to 'repairing', sets diagnosisLockedAt, appends tree_update event
  - Rejects when phase already 'repairing' (400)
  - Rejects when treeState.done is false (400)
  - Rejects when status is not 'open' (400)
  - Rejects non-owner tech (404)

- **`submitRepairObservationForUser`**:
  - Happy path: appends observation, calls AI, appends guidance, returns guidance text + tangentialConcerns
  - AI failure: observation persisted, guidance NOT persisted, returns 502
  - Rejects when phase is not 'repairing' (400)
  - Rejects empty observation (400)
  - Rejects non-owner tech (404)
  - AI response with rootCauseSummary field gets stripped before persisting

- **`buildRepairGuidancePrompt`**:
  - Includes locked rootCauseSummary, proposedAction.description, expectedSignal
  - Includes last 10 repair events for context
  - Truncates context when more than 10 events exist (FIFO drop oldest)
  - Does not include diagnostic tree nodes

### Component (jsdom + @testing-library/react)

- `ActiveSession` renders `DiagnosisProposedReview` when `phase=undefined && done=true` AND when `phase='diagnosing' && done=true`
- `ActiveSession` renders `RepairPhaseView` when `phase='repairing'`
- `RepairPhaseView` renders chat thread from session_events in correct order
- Lock-in button only visible when `done=true`
- AbandonButton present in all phases

### E2E (Playwright)

- Seed: a session in phase='repairing' with sample chat events
- Tech navigates to `/sessions/[id]` → RepairPhaseView visible (locked diagnosis + conversation + ask form)
- Tech submits observation → guidance appears in thread (mocking Anthropic for determinism)
- Tech clicks Close case → reaches /outcome

### Manual checklist update

Add to `docs/testing/manual-checklist.md`:
- Open a diagnostic session, take it to `done=true`
- On the review screen, push back with a new observation; verify AI revises
- Click Lock-in; verify enters repair phase
- Submit a repair observation; verify guidance returns
- Submit a question that suggests the diagnosis was wrong; verify AI advises marking incomplete (does NOT silently revise)
- Close case → outcome form → submit

## Open questions

1. **Repair-guidance prompt cost / latency.** Each repair observation = one Anthropic call. Long repair sessions add up. Acceptable for v1 (matches the diagnostic pattern). Cost monitoring deferred.

2. **Unlock-after-lock support.** v1: not supported. If demand emerges, add `POST /api/sessions/[id]/unlock-diagnosis` later.

3. **Customer-facing repair plan output.** Locked diagnosis is internal-tech-facing. Customer-facing summary generation (printable / Stripe-attached) deferred.

4. **AI-confirmed verification.** v1 trusts the tech's self-attest "verified" at close-case. A future version could have AI ask probing questions before allowing close. Out of scope.

## Files affected

| File | Change | Net lines |
|---|---|---|
| `lib/db/schema.ts` | Extend `treeState` $type with `phase` + `diagnosisLockedAt`; add new event types to `eventType` enum; extend `aiResponse` $type with `repairGuidance` | ~10 |
| `lib/sessions.ts` | Add `lockDiagnosisForUser`, `submitRepairObservationForUser` | ~120 |
| `lib/ai/repair-guidance.ts` | New file: `getRepairGuidance(input)` calls Anthropic with the new prompt | ~100 |
| `app/api/sessions/[id]/lock-diagnosis/route.ts` | New | ~30 |
| `app/api/sessions/[id]/repair-observation/route.ts` | New | ~50 |
| `lib/session-routing.ts` | No change (handled via active-session branching) | 0 |
| `components/screens/active-session.tsx` | Branch on `phase` + `done`; route to one of three components | ~30 (mostly removal of inline done-state JSX, now in DiagnosisProposedReview) |
| `components/screens/diagnosis-proposed-review.tsx` | New (extracted from current done-state inline JSX + Lock-in Module) | ~150 |
| `components/screens/repair-phase-view.tsx` | New | ~120 |
| `components/screens/repair-conversation.tsx` | New (chat thread renderer) | ~80 |
| `components/screens/lock-diagnosis-button.tsx` | New (client component for the lock-in action) | ~60 |
| `components/screens/repair-ask-form.tsx` | New (textarea + submit + retry) | ~80 |
| `tests/unit/lock-diagnosis.test.ts` | New | ~150 |
| `tests/unit/repair-observation.test.ts` | New | ~180 |
| `tests/unit/repair-guidance-prompt.test.ts` | New | ~100 |
| `tests/unit/active-session.test.tsx` | Extend with phase-mode rendering tests | ~60 added |
| `tests/e2e/sessions.spec.ts` | Add repair-phase smoke + observation-submit smoke | ~40 added |
| `docs/testing/manual-checklist.md` | Add the lock-in + repair-phase steps | ~10 added |

Approximate total: **~1300-1400 net lines added** across 14 files (mostly new files; existing-file edits are small).
