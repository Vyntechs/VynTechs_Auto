# HANDOFF — Diagnostics engine: P0-1 proof-of-fix writer shipped on-branch

**Last updated:** 2026-06-16
**Work branch:** `feat/system-data-ingest` · **Worktree:** `.claude/worktrees/system-data-ingest` (NOT `main`, NOT the `revert/pr-96` checkout). Prod/beta untouched all session.

## THE ONE THING TO KNOW NEXT SESSION
P0-1 (the proof-of-fix writer) is **built + verified + committed on the side branch** — 3 commits, **not pushed, not merged, no migration, no deploy**. The counter now HAS a writer, but it produces **0 in production until the symptom catalog is seeded** — seeding is the real next unlock (and a canonical seed was recently reverted; see below).

## WHAT SHIPPED THIS SESSION (verified, on `feat/system-data-ingest`)
- `326dff6` — cherry-picked 4 prompt-spec docs (`prompt-1..4a`) from `staging-interactive-diagnostics`. Docs only; no code/migrations.
- `15405fa` — **P0-1 honest proof-of-fix writer.** New `lib/diagnostics/record-diagnostic-session.ts`, wired into `closeSessionForUser` as a non-fatal injected hook + the `app/api/sessions/[id]/close` route. Records `finalVerdict='commit-allowed'` ONLY on a real repair action the tech verified resolved; `no_fix`/`referred`/`not-resolved`→non-allowed verdict; stays **silent** (writes nothing — no fabrication) when the complaint can't resolve to a *seeded* symptom or there's no vehicle.
- `8dbd6d3` — real linkage proof + doc tighten. E2E test drives the **real** `loadCachedDiagnostic.priorFixCount` 0→1 on a verified fix and 0 on a non-fix.
- Adversarial code-review pass run: one valid hit (a self-confirming test → replaced with the real e2e above); its bigger "writer files under the wrong slug" alarm was **disproved by grounding** — the counter's read path (`app/(app)/sessions/[id]/page.tsx:62`) and the writer both resolve via `resolveSymptomSlug({ complaintText })`, so they agree by construction.

**Verified by:** `tsc --noEmit` clean; `record-diagnostic-session` 9/9 (incl. the real `loadCachedDiagnostic` counter going 0→1) + `close-session-handler` 18/18; an isolated re-run of my files **plus 4 of the full-suite's flaky-failed files = 105/105**. The full suite ran 1386/0 green once earlier this session; later full runs hit a **pre-existing PGlite `createTestDb` hook-timeout flake under parallel load** (non-deterministic 24→94 fails on identical code, all rooted in `beforeEach` timeout — never an assertion). See lesson `full-suite-pglite-flake-under-load`. Re-confirm failed files in ISOLATION, not via one full run.

## GROUNDED REALITY — corrects the planning docs (memory: `diagnostics-engine-wiring-reality`)
- **Live tech flow = the legacy freetext wizard** (`/intake`, `/sessions/new` → `sessions` table). The normalized topology engine (`symptoms`/`platforms`/`diagnostic_sessions`/`cached-lookup`) is **read-only + curator-only**, and the `symptoms`/`platforms` **catalog tables are empty**.
- The proof-of-fix counter keys on `diagnostic_sessions.symptomId`, resolved from the freetext complaint via `resolveSymptomSlug` — the same path the new writer uses.
- So the planned P0 sequence assumes infra that doesn't exist yet: a **seeded symptom catalog**, sessions **tagged with a symptomId**, and a real **"fix verified"** event. The writer is the valve; it fills automatically once the catalog seeds.

## IMMEDIATE NEXT STEP (the real unlock)
The **empty symptom catalog** is the blocker. A canonical seed for it — PR #96 "cranks-no-start canonical seed" — was **recently reverted** (the main checkout is literally `revert/pr-96-...`). Seeding branches exist (`feat/diesel-platform-seeding`, `feat/6.0-psd-cranks-no-start-seed`).
**First action for a fresh agent:** investigate *why* PR #96 was reverted and what's reusable BEFORE re-seeding. Then seed ONE problem (`cranks-no-start`) end-to-end so `loadCachedDiagnostic` returns a real, non-zero number for a real vehicle+symptom.
⚠️ Seeding writes to a DB → **Brandon-gated: disposable/preview DB only, NEVER prod or the live-login DB.**

## SMALLER ALTERNATIVE NEXT BRICK (fully in-court; needs a migration)
Add a `sessionId` link (FK → `sessions.id`) + unique constraint on `diagnostic_sessions`, for auditability + dedupe of the count. (Adversarial-review MEDIUM; safe today via the close status-guard, but not auditable / not re-run-safe.)

## HARD CONSTRAINTS / WHAT ONLY BRANDON DOES
- Do NOT touch `main`/prod/the live-login DB. Build on `feat/system-data-ingest` behind a preview.
- Merge SDI → `main`: parked to ship-day, Brandon's explicit go only.
- Push `feat/system-data-ingest` to remote: **Brandon's call** (committed local-only this session; `origin/feat/system-data-ingest` exists).
- Any DB write (migration/seed/prove-from-empty): Brandon-gated, disposable DB only.

## Resume prompt
```
Read HANDOFF.md in full and tell me where we left off.
```
