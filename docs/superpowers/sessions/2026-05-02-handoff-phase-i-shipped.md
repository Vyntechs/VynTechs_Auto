# Vyntechs MVP — Handoff (2026-05-02, Phase I shipped)

Supersedes `2026-05-02-handoff-walkthrough-whatwouldclose.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if the chosen task has UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit`. Expect **195/195**, exit 0.
4. **Pick next phase per "Next session" below.** Recommended: **N → J → K → L** (G/Stripe deferred until ship-ready).

## State

- Branch `feature/mvp-implementation`, **66 commits ahead of `main`**, no uncommitted changes.
- Tests **195/195**, tsc clean, build untested.
- Supabase project `ynmtszuybeenjbigxdyl` ("Vyntechs Auto") us-east-1 ACTIVE_HEALTHY. Migrations 0000–0007 applied (0007 = Phase I `artifacts` table). RLS auto-enabled on `artifacts`. Storage bucket `artifacts` (private) created via MCP; bootstrap SQL committed at `supabase/storage-setup.sql` for fresh-project reproducibility.
- Dev user `brandon@vyntechs.com` / `Benny0812` (force-confirmed). Same shop / profile as prior session.
- 19 commits this session — Phase I in 10 task-pairs (impl + fix-after-review per task) plus the opening walkthrough commit.

## What shipped this session

**Phase I — Multi-Modal Capture Pipeline (all 10 tasks):**

- **I1 — `artifacts` table.** 12 columns (FK→sessions onDelete cascade, jsonb `extraction`, `extractionStatus` + `storageTier` enums). RLS auto-enabled. Migration `0007_phase_i_artifacts`.
- **I2 — Storage layer.** `lib/storage/client.ts` with `uploadArtifact` / `signedUrl` / `downloadArtifact`. Codec-stripping fix (`audio/webm;codecs=opus` → `audio/webm`) before EXTENSION lookup. `supabase/storage-setup.sql` for bucket bootstrap.
- **I3 — Capture upload route.** `POST /api/sessions/[id]/capture`. Handler in `lib/sessions.ts` (`captureArtifact`), thin route shim. 17 new tests including direct PGlite coverage for the 4 artifact queries (deferred from I1 review).
- **I4 — PhotoCapture component.** `components/session/photo-capture.tsx`. File input + `capture="environment"`. Per-kind default labels for a11y. Busy-guard on onChange. Plain CSS via `btn btn-secondary`.
- **I5 — AudioCapture component.** MediaRecorder webm/opus. Live elapsed counter. Stream + timer cleanup on unmount + onerror (was leaking mic indicator). Codec-aware upload mime. `useId()` for prompt linkage. Idempotent stop.
- **I6 — VideoCapture component.** File input video. 25 MB client-side gate using shared `MAX_CAPTURE_BYTES` exported from `lib/sessions.ts` (was duplicated). Advisory `maxSeconds` caption.
- **I7 — Vision OCR.** `lib/ai/vision.ts` with `extractScanScreen` + `extractWiringDiagram`. Two new system prompts in `prompts.ts`. Hardening: `withRetry` + skip-retry on `BadRequestError`/`UnprocessableEntityError`, MIME gate, runtime shape validation, `stop_reason='max_tokens'` explicit error, `console.warn` on parseJson recovery, prompt tightened to forbid prose preamble.
- **I8 — Audio transcription stub.** `transcribeAudio` shipped as a stable interface for I9 to call against. **Anthropic SDK v0.92.0 has no audio content block; no `OPENAI_API_KEY` in env.** Uses plain `{type:'document'} as any` cast — will throw at runtime against the live API. Mock-based tests pass; `TODO(I8)` comments in vision.ts. Real audio transport is a Phase L precondition.
- **I9 — Background extraction worker.** `lib/ai/extraction-worker.ts` with `processArtifactExtraction(db, id)`. Kind-switch dispatch with exhaustive `never` guard. Inline auto-trigger from `captureArtifact` for `HIGH_SIGNAL_KINDS = {scan_screen, wiring_diagram, audio}` (extracted to pure `lib/ai/artifact-kinds.ts` to avoid Supabase init at import time). Capture response now includes `extractionStatus: 'pending' | 'done' | 'failed'`. Deferred I1 fix applied: `setArtifactExtraction` uses `.returning()` and throws on empty result. On-demand `POST /api/artifacts/[id]/extract` route (sanitized error response).
- **I10 — Multi-modal advance.** `TreeState` collapsed: canonical in `lib/ai/tree-engine.ts`, `lib/db/schema.ts` re-exports via `import type` (no circular dep). DESCRIBE-FIRST POLICY block added to `TREE_ENGINE_SYSTEM`. `updateTree` accepts `artifacts?: Array<{kind, summary?, structured?, text?}>` and weaves them into the user message. `advanceSession` fetches done-status artifacts for current node and passes through. `components/screens/active-step-form.tsx` renders the appropriate capture component when `requestedArtifact` is set; `components/screens/active-session.tsx` threads it through.

Each task's review iteration is captured in commit pairs (`feat(...)` then `fix(...)` per task) — see `git log main..HEAD`.

## Carryovers (track or address next session)

- **I8 audio transport API-pending.** `transcribeAudio` will throw `BadRequestError` against the live Anthropic API until either (a) Anthropic SDK gains an audio content block, or (b) Whisper is wired (no `OPENAI_API_KEY` currently). Worker catches and sets `extractionStatus='failed'`. Tech can retry via `/extract` once transport is wired. **Real product gap; tracked as Phase L precondition.**
- **`requestedArtifact` clearing trusts Sonnet entirely.** No server-side clear after artifact upload. If Sonnet forgets to unset the field, the capture button persists indefinitely. MVP-acceptable; mitigation idea is a "captured" UI indicator using the `artifactId` already passed to `onUploaded`. **Track for first-field-test follow-up.**
- **Local `RequestedArtifact` type in `active-step-form.tsx`** duplicates the canonical type in `tree-engine.ts`. Two-line import fix; reviewer flagged for "Phase J cleanup pass."
- **Inline auto-trigger blocks the HTTP response** for high-signal kinds (5–15s for scan_screen, 10–20s for audio). Spec gap, not implementation. Future: fire-and-poll with SSE or 202+status endpoint.
- **`router.refresh()` on artifact upload** triggers two server fetches per step (one upload, one advance). Acceptable on phone at MVP scale; revisit if flicker is noticeable in field testing.
- **Pooler `DATABASE_URL` still broken** — unchanged from prior handoff. `lib/db/client.ts` prefers `DATABASE_URL_DIRECT` in dev. **Vercel deploy will fail until pooler URL is fixed** before Phase S.
- **NewSessionForm swallows fetch errors silently** + no loading state during ~30s AI call — unchanged from prior handoff.
- **Sign-up + sign-in pages still unstyled** — unchanged from prior handoff.
- **Phase F a11y** — 2 unlabeled fields in `OutcomeCapture` — unchanged from prior handoff.
- **Custom SMTP for `support@vyntechs.com`** — unchanged from prior handoff.
- **`createProfile` in `lib/db/queries.ts`** is dead code — unchanged from prior handoff.
- **Rung-2 kind set** is hardcoded inline in `lib/sessions.ts` (`kind === 'wiring_diagram' || kind === 'scan_screen'`); could become `RUNG_2_KINDS` in `artifact-kinds.ts` for consistency with `HIGH_SIGNAL_KINDS`. Drift risk if a future kind needs the same treatment.
- **`audio/m4a`** in `TRANSCRIBE_MIME_TYPES` is a Safari/iOS shorthand, not a registered IANA type. Tracked.
- **No bucket-level RLS policies on `storage.objects` for the `artifacts` bucket.** Service-role key in `lib/storage/client.ts` bypasses RLS by design; the security perimeter is auth+ownership in `captureArtifact`. **Document explicitly before Phase P.**
- **Apply withRetry-skip-terminal-errors fix to `lib/ai/tree-engine.ts`.** Same pattern as I7's vision fix. Lower blast radius (no raw image bytes), but still wasted spend on 400/422.

## Next session — likely focus

Per the plan, recommended order: **N → J → K → L**. (Phase G/Stripe deferred — Brandon says no payment surface until ready to ship.)

- **Phase N — Tablet Layout + Realtime Sync (6 tasks):** desktop dashboard view. Now interesting because Phase I makes artifact-rich sessions worth viewing on a bigger screen.
- **Phase J — Photo Storage Tiering (6 tasks):** cost discipline now that I1's `storageTier` column is in place. Hot → warm → cold.
- **Phase K — Cross-Shop Corpus.** Was blocked behind I9 (extracted artifact data is the corpus input).
- **Phase L — Bounded Internet Retrieval.** Closes the loop on `whatWouldClose` (Sonnet does its own research first, then asks the tech for the smallest delta). Also unblocks the I8 audio path if Whisper is wired here.

Recommend Brandon `/clear` before starting the next phase and resume from this handoff in a fresh session.
