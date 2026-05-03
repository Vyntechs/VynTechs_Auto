# Vyntechs MVP — Handoff (2026-05-03, Phase I verified + cleanup)

Supersedes `2026-05-03-handoff-phase-g-shipped.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if next phase has UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **293/293 tests**, exit 0, build clean.
4. Apply migration `drizzle/migrations/0007_chief_bushwacker.sql` to live Supabase if not yet done (manual or via repo deploy workflow).
5. Pick next phase per "Next session" below. Recommended: **Phase O — Desktop Intake** (front-counter screen for starting a session, 5 tasks).

## State

- Branch `feature/mvp-implementation`, **103 commits ahead of `main`**, working tree clean.
- Tests **293/293**, tsc clean, `pnpm build` clean.
- Phase I (Multi-Modal Capture) **verified shipped** — 9/10 fully shipped, 1 (I8 audio transcription) shipped with transport stub. See carveout below.

## What this session covered

This was an **audit + cleanup** session. The previous handoff indicated Phase I was unstarted; a repo audit found 9/10 Phase I tasks already shipped in earlier commits. This session:

- **I2 refactor** (commit `a8b2f87`, "refactor(storage): lazy-Proxy client + DI-friendly upload/signed/download"). Rewrote `lib/storage/client.ts` to use the lazy-Proxy + DI pattern established by `lib/stripe.ts` (G1/G2). Pre-existing storage helper had eager module-load `createClient` and no DI overrides — violated stated constraints. Net +11 tests (replaced 2 with 13 DI-driven ones). No behavior change for callers.
- **Artifacts FK index** (commit `2d65a9d`, migration `0007_chief_bushwacker.sql`, "perf(db): index artifacts.session_id for FK lookups + cascade"). `CREATE INDEX artifacts_session_id_idx ON artifacts (session_id)`. Postgres doesn't auto-index FK columns; flagged by `supabase-postgres-best-practices` skill as 10-100× perf for `listArtifactsForSession` and cascade-delete on session removal. Migration not yet applied to live DB.

## Phase I task ledger (verified shipped)

| Task | Status | Commit |
|------|--------|--------|
| I1 artifacts table + typed queries | shipped | `3558079` |
| I2 storage helper | shipped (refactored this session) | `a8b2f87` |
| I3 capture upload route | shipped | `0f9518d` |
| I4 PhotoCapture component | shipped | `5cab8ad` |
| I5 AudioCapture component | shipped | `fc632a6` |
| I6 VideoCapture component | shipped | `97317be` |
| I7 vision OCR (scan-tool / wiring) | shipped | `287b329` |
| I8 audio transcription | shipped with transport stub | `51cf251` |
| I9 extraction worker + extract route | shipped | `598f349` |
| I10 tree-engine multi-modal update | shipped | `481005a` |

## I8 audio transport carveout

`transcribeAudio` in `lib/ai/vision.ts` has full validation/error/retry plumbing and tests, but the actual Anthropic API call uses a `document` block with an `as any` cast — Anthropic SDK lacks native audio support, **will fail at runtime**. Audio captures still **save to storage fine**; AI auto-transcription is the missing piece. Two paths:

- (a) Wire OpenAI Whisper (~$0.006/min, second vendor + API key)
- (b) Wait for Anthropic native audio block in a future SDK (one-line swap when shipped)

Decision deferred per Brandon (2026-05-03). Tracked as backlog.

## Carryovers

- **Migration `0007_chief_bushwacker.sql` not yet applied** to live Supabase. Apply manually via dashboard or repo deploy workflow before next deploy.
- **Storage RLS policies missing.** `supabase/storage-setup.sql` only creates the private bucket. Storage code currently uses the service-role key (bypasses RLS). Once tech/customer auth flows touch storage with anon/authenticated keys, INSERT+SELECT+UPDATE policies must be added for the `artifacts` bucket. Flagged by `supabase` skill security checklist. Not blocking I3–I9 (service-role path).
- **TypeScript-only enums on artifacts.kind / extractionStatus / storageTier**, no Postgres CHECK constraints. Matches sessions table convention. Not a bug, weaker than possible.
- **Indexes missing on artifacts.extraction_status and storage_tier.** Only matters when Phase J (storage tiering cron) ships — J is on the STOP-AND-ASK list, so this is future-J's problem.
- **All earlier carryovers from `2026-05-03-handoff-phase-g-shipped.md`** still apply (Stripe webhook idempotency / event.id tracking, billing a11y audit, latency stack-up, observability hook missing, comeback workflow not wired, broader RLS policies, test mode product not yet created, webhook endpoint not yet registered, etc.).
- **Existing `0006_known_maximus.sql` is hand-edited.** `corpus_entries.embedding` is `vector(1536)` in SQL but `jsonb` in `lib/db/schema.ts` — intentional drift per comment at `lib/db/schema.ts:209`. Four corpus indexes (HNSW, vehicle, GIN dtcs, GIN symptom_tags) live in SQL only. Don't regenerate this migration.

## Next session — likely focus

Ask Brandon; don't pick. Active queue (Phase I removed from queue, now verified):

1. **Phase O — Desktop Intake** (5 tasks). Front-counter screen for starting a session. *(Recommended.)*
2. **Phase P — Curator Console** (7 tasks).
3. **Phase Q — Calibration Engine** (5 tasks).
4. **Phase R — Comeback Follow-Up Automation** (5 tasks).

Backlog (post-active-queue):
- Wire I8 audio transport (Whisper or Anthropic native).

## STOP-AND-ASK phases (deferred, decided 2026-05-03)

**Do not start Phases J, N, or S without explicit go-ahead from Brandon.**

- **Phase J — Photo Storage Tiering** (6 tasks). AWS cost-surprise concerns.
- **Phase N — Tablet Layout + Real-Time Sync** (6 tasks). Phone-first, tablet later.
- **Phase S — End-to-End + Production Deploy** (4 tasks). Don't deploy production without Brandon.

Recommend `/clear` before starting next phase.
