# Handoff — System-Data Ingest / PR2 done → PR3 (research mining)

**Date:** 2026-06-06 · **For:** next fresh session (continue this work) · **Owner:** Brandon (non-technical founder — plain English, no jargon in chat).

**Session-start paste (one line):** "Continue the system-data-ingest work — read `docs/superpowers/handoffs/2026-06-06-system-data-ingest-pr2-handoff.md` on branch `feat/system-data-ingest`."

> Supersedes `2026-06-06-system-data-ingest-handoff.md` (PR0+PR1). Read this one; the prior is kept only for the PR0 plan reference.

---

## The goal (the "marriage")
Vetted **DATA** → **code** draws the wiring diagram AND runs the deterministic walk → **AI is out of the tech-serving hot path** (cheaper, can't fabricate). AI's job is to BUILD the data once; a curator vets it; code serves it forever.

## Where things stand
- **Branch:** `feat/system-data-ingest`. Worktree: `.claude/worktrees/system-data-ingest`. node_modules + a working `.env.local` already present.
- **PR0 (`3f05fd8`)** — co-located the diagnostic schema (16 tables, migrations `0021`–`0023`), the loader/layout, `components/topology/*`, deps. Additive only; prod already has the tables.
- **PR1 (`3d0ceb2`)** — `app/curator/topology` read-only route: the 6.7L fuel map **draws itself from the DB**. Verified live (221 nodes, desktop + mobile).
- **PR2 (this session — see commit at bottom)** — **the write path.** Before PR2, a repo-wide grep found ZERO inserts into any system-data table: the app could draw a map but never save one. PR2 adds the only save path, approval-gated.
  - New: `lib/diagnostics/promote-system-data.ts` — the `SystemDataDraft` type + `promoteSystemDataDraft(db, draft)`.
  - New: `tests/unit/promote-system-data.test.ts` — 22 tests (TDD, all green; tsc clean).
  - Reviewed by a 4-lens adversarial workflow; 6 real findings fixed (see "What PR2 guarantees").

## What PR2 guarantees (the contract)
`promoteSystemDataDraft(db, draft)` is the **ONLY** write path into the system-data tables. It:
1. **Refuses anything not curator-approved** (`status==='approved'` + a non-empty `approvedBy`) — writes nothing otherwise.
2. **Refuses structurally bad drafts up front** (invalid enum values, duplicate slugs within a draft, duplicate `(from,to,kind)` connections, self-loops) — clean errors, no partial writes. Enum allow-lists are read from the schema's own `.enumValues` (no duplicated lists, no drift).
3. **Persists GAPs verbatim** — a `sourceProvenance:'GAP'` row is saved and flagged, never dropped, never turned into a fake value. Carries `inferenceClass` (LAW/LOGIC/PATTERN) so PR3's *inferred* facts keep their justification.
4. **Merges by the DB's real identity, idempotently** — components & observable-properties by **active global `slug`**, connections by `(from,to,kind)`. Re-promoting changes nothing; a corrected draft updates in place. A slug already owned by a different platform/component is **refused cleanly** (not silently repointed, not a raw SQL error).
5. **Additive / non-destructive** — an item omitted from a later draft is left untouched. To retire a row, include it with `isRetired:true`.
6. **Atomic** — all writes in one transaction; any error rolls everything back. Never creates platforms (must pre-exist); never touches prod.

**Scope is deliberately the 3 entities the program named: components, connections, observable-properties.** Pins / test_actions / branch_logic / scenarios are out of PR2 — additive later (the draft type extends).

## ⚠️ Load-bearing gotcha discovered this session (READ before any write/identity work)
**The system-data tables' identity is GLOBAL slug, and it lives ONLY in the migration SQL — not in `schema.ts`.** Migration `0021` (lines 377–404) creates partial unique indexes:
- `components (slug) WHERE is_retired=false` — slug is globally unique, **NOT** `(platform_id, slug)`.
- `observable_properties (slug) WHERE is_retired=false` — globally unique, **NOT** `(component_id, slug)`.
- `component_connections (from, to, connection_kind) WHERE is_retired=false`; `symptom_test_implications (symptom_id, test_action_id)`; `platform_equivalents (a, b, system)`.

`schema.ts`'s `pgTable` defs do **not** declare these indexes (hand-written migration). The PGlite test DB is built from the **migrations**, so it enforces them; grepping `schema.ts` will mislead you (it did me — first draft keyed dedupe on `(platform_id, slug)` and would have thrown on the second platform). **Any future writer/identity logic for these tables must key on global active slug.** Seeds must therefore use platform-distinct slugs.

## Next work — PR3+ (dependency-ordered)
- **PR3 — mine the already-paid research run into a `SystemDataDraft` (DRAFT only, AI's first step).** A synthesis pass (sibling to `runSynthesis` in `lib/research/`, reusing `lib/ai/client.ts` + the URL-set anti-fabrication check) that reads a completed `research_run`'s `agentOutputs` and emits a `SystemDataDraft` — everything the data supports, each item tagged confirmed/inferred/GAP. **It must NOT approve or write** (status stays `'draft'`; only PR4 flips to approved → calls PR2's writer). **Test the parser against the REAL stored corpus FIRST** — the 3 personas were prompted for diagnostic TESTS, not topology, so the corpus may be thin (decide fallback AFTER that test; prefer tweaking persona prompts — still ONE paid run). NOTE: `research_runs` is empty in prod, so a run may be needed (≈$2–3, Brandon's deliberate call — see memory `research-run-cost`).
- **PR4 — curator vet/correct/approve screen (THE trust gate).** Draft rows shown as plain-English editable rows with provenance badges; Brandon edits/flips/retires/fills-gap; **Approve** sets `status:'approved'`+`approvedBy` and calls PR2's `promoteSystemDataDraft`; the PR1 viewer redraws. Mobile (375–414px) must pass. Nothing serves to a tech until approved. (Answers the same trust gap that parked N4.)
- **PR5 — the button + reuse-first guard.** "Draft the map for this case" on the curator surface; runs against the most recent completed run (free); platform-scoped reuse lookup (map is per-platform, symptom-independent); reuse the 2s-poll progress UX.
- **PR6 (defer) — cross-family spread** (`platform_equivalents`) so one vetted 6.7 map covers sibling platforms.

## Open decisions for Brandon (resolve when relevant)
- **First cold-start case:** 4x4 (2011–16 F-250/350, zero data) vs continue fuel. Brandon wants BOTH validated for robustness; never draw a fabricated 4x4 diagram (PR2 already refuses to fabricate; PR3 must tag the gaps honestly).
- **PR3 fallback if the stored corpus is too thin for topology** — decide only after testing the parser on the real run.

## NOT in this lane (hand off separately)
- **Polishing the diagram to match the Figma's premium look = Claude Design.** Current renderer is the default react-flow look. Figma: https://www.figma.com/design/2yV1UfK9asjRnMoJds0eNG?node-id=2-2
- **The "measured value vs target band" gauge** = the stashed band-primitive on `feat/wizard-band-primitive` (`git stash@{0}` in `.claude/worktrees/feat-curator-pr-n4-flow-walker`).

## How to run + visually validate (this setup works)
- Dev server: from the worktree, `PORT=3210 pnpm dev`. `.env.local` already present (`DATABASE_URL_DIRECT` commented out — required or every authed page 500s).
- Auth for screenshots: mirror `tests/e2e/global-setup.ts` (`signInWithPassword` in node → build `sb-<ref>-auth-token` cookie → drive Playwright). Route: `/curator/topology?symptom=<slug>`.

## Gotchas (carried + new)
- **Global-slug identity** — see the ⚠️ section above. The #1 thing to know before writing to these tables.
- **schema.ts ≠ test DB** — the test DB is built from `drizzle/migrations/*.sql` via `migrate()`. To know a table's real constraints, read the migration SQL, not `schema.ts`.
- **Drizzle union-type quirk** — functions take `db: AppDb` (a union of Postgres + PGlite). Inside a `db.transaction`, projected `.returning({...})` fails to typecheck; use no-arg `.returning()` and read fields off the row. (`queue-actions.ts` / `drift-resolution.ts` are the working precedents.)
- **Migrations:** drizzle-kit is broken — hand-write; `--> statement-breakpoint` markers REQUIRED. Prod already has the diagnostic tables — do NOT re-apply 0021–0023 to prod.
- **Do NOT** add an FK from a curator/core table (flows/research_runs/sessions) to platforms/symptoms — breaks the PGlite suite (see the SLUG REALIGNMENT comment in `schema.ts`).
- **Test suite ~6 min;** a cold-cache "PGlite is closed" / 5s-timeout flake on the first full run is known (resource contention, not logic) — rerun the named file in isolation before treating as a regression.
- **Base:** stack everything on `feat/system-data-ingest`. This whole line heads toward the staging-curator / V2 line, not prod, for a long time.

## Validation checklist for next session
- [ ] Work in `.claude/worktrees/system-data-ingest` on `feat/system-data-ingest`.
- [ ] Read this handoff. `pnpm test` green → `pnpm exec tsc --noEmit` clean.
- [ ] Start PR3: FIRST inspect a real completed `research_run.agentOutputs` corpus and test how much topology it can yield, BEFORE writing the synthesis pass. Emit a `SystemDataDraft` (status `'draft'`), reusing the existing draft type in `lib/diagnostics/promote-system-data.ts`.
- [ ] PR3 must never write/approve — that's PR4's gate calling PR2's `promoteSystemDataDraft`.
