# Handoff — System-Data Ingest / Auto-Draw Spine

**Date:** 2026-06-06 · **For:** next fresh session (continue this work) · **Owner:** Brandon (non-technical founder — plain English, no jargon in chat).

**Session-start paste (one line):** "Continue the system-data-ingest work — read `docs/superpowers/handoffs/2026-06-06-system-data-ingest-handoff.md` on branch `feat/system-data-ingest`."

---

## The goal (the "marriage")
Vetted **DATA** → **code** draws the wiring diagram AND runs the deterministic walk → **AI is out of the tech-serving hot path** (cheaper, can't fabricate). AI's job is to BUILD the data once; a curator vets it; code serves it forever.

## Where things stand
- **Branch:** `feat/system-data-ingest`, cut off the curator/N4 line (`feat/wizard-band-primitive`). Worktree: `.claude/worktrees/system-data-ingest`. node_modules + a working `.env.local` are already in the worktree.
- **PR0 (committed `3f05fd8`)** — co-located the two halves: ported the diagnostic schema (16 tables, 7 enums), 3 migrations (`0021`–`0023`, DDL-only, breakpoints intact), the loader/layout (`lib/diagnostics/load-system-topology.ts`, `topology-layout.ts`), `components/topology/*`, and deps (`@dagrejs/dagre`, `@xyflow/react`) onto the curator branch. **Additive only, no live-DB change** (prod already has the tables). 1062 unit tests green; tsc + build clean; independently reviewed.
- **PR1 (committed `3d0ceb2`)** — `app/curator/topology` read-only curator route: the **6.7L fuel map draws itself from the database**. Reuses `components/screens/topology-diagnostic.tsx`. **Verified live** on the authed curator page (221 nodes, 0 JS errors, desktop + mobile, all 3 fuel cases switch). Screenshots: `/tmp/pr1-*.png`.

## Locked decisions (Brandon, 2026-06-06)
1. **Spine, not a one-truck demo.** Build the repeatable ingest → vet → auto-draw path.
2. **Validate across cases, not one.** Prove on the data-rich case (6.7 fuel) AND a cold-start case — where the only acceptable result is honest **GAPs**, never a fabricated wire/number.
3. **Build everything the data supports — accuracy is the gate, not scope.** AI drafts parts/wiring/tests/flow/verdict only where logic from the data supports it; stop at a marked GAP where it runs out. (See memory `vyntechs-product-thesis`.)

## Data reality (prod project `ynmtszuybeenjbigxdyl`, READ-ONLY checked)
- **1 platform:** `ford-super-duty-4th-gen-67-psd` (2017–2022 6.7 Power Stroke). **NOT the 6.0** — the "6.0 cranks-no-start" seed (`feat/6.0-psd-cranks-no-start-seed`) is a separate thing that is **not in prod**; do not conflate.
- **3 symptoms, all `system='fuel'`:** `p0087-fuel-rail-pressure-too-low` (the Figma case), `p0088-fuel-rail-pressure-too-high`, `no-start-cranks-normally-fuel-system-suspect`.
- **Rich data:** 25 fuel components, 194 connections, 188 observable properties, 28 test actions, 83 branch-logic rows, 8 scenarios, 44 symptom-test implications. `platform_equivalents` = **0** (no cross-vehicle spread yet). `research_runs` = **0** rows.

## Next work — PR2+ (the real meat: AI pre-fill / ingestion + the vet gate)
Dependency-ordered (from the planning workflow + Brandon's refinements):
- **PR2 — system-DATA write contract + deterministic promoter (no AI).** A `SystemDataDraft` type (components/connections/observableProperties, each with `source_provenance` TRAINING-CONFIRMED|TRAINING-INFERRED|FIELD-VERIFIED|GAP) + an `.insert()` layer that promotes an APPROVED draft into the slug-keyed tables (merge/dedupe by slug; unapproved can never be written). Unit-test against the 6.7 fixture. *(Repo-wide grep finds ZERO inserts into any system-data table today — the write path is the actual hole.)*
- **PR3 — mine the already-paid research run to draft DATA (free).** One synthesis pass (sibling to `runSynthesis`, reuse `lib/ai/client.ts` + the URL-set anti-fabrication check) that reads an existing completed `research_run`'s `agentOutputs` and emits a `SystemDataDraft` — everything the data supports, each item tagged confirmed/typical/GAP. DRAFT only. **Test the parser against the real stored corpus FIRST** — the 3 personas were prompted for diagnostic TESTS, not topology, so the corpus may be thin (decide fallback AFTER this test; prefer tweaking persona prompts — still ONE paid run). NOTE: `research_runs` is currently empty in prod, so a run may be needed.
- **PR4 — curator vet/correct/approve screen (THE trust gate).** AI-drafted rows shown as plain-English editable rows with provenance badges; Brandon edits/flips/retires/fills-gap; Approve calls PR2's writer; the PR1 viewer redraws. Mobile (375–414px) must pass. **Nothing serves to a tech until approved.** (Directly answers the same trust gap that parked N4.)
- **PR5 — the button + reuse-first guard.** "Draft the map for this case" on the curator surface; runs against the most recent completed run (free); platform-scoped reuse lookup (the map is per-platform, symptom-independent — unlike the flow's per-pair key); reuse the existing 2s-poll progress UX.
- **PR6 (defer until PR1–5 prove out) — cross-family spread** (Prompt 4A → `platform_equivalents`) so one vetted 6.7 map covers sibling platforms.

## Open decisions for Brandon (resolve when relevant)
- **First cold-start case:** 4x4 (2011–16 F-250/350, zero data) vs continue fuel. Brandon wants BOTH validated for robustness; never draw a fabricated 4x4 diagram.
- **What the pre-fill generates:** DATA vs FLOW vs both — lean DATA-first by EXTENDING the N3 research pipeline (one mining pass), not forking it, no second paid run.

## NOT in this lane (hand off separately)
- **Polishing the diagram to match the Figma's premium look = Claude Design**, not freelance. The current renderer is the existing topology UI (default react-flow/dotted-grid look). Figma: https://www.figma.com/design/2yV1UfK9asjRnMoJds0eNG?node-id=2-2
- **The "measured value vs target band" gauge** (Figma's 38 psi vs 50–65) = the **stashed band-primitive** on `feat/wizard-band-primitive` (`git stash@{0}` in `.claude/worktrees/feat-curator-pr-n4-flow-walker`). Wire it into the wizard/finding in a later PR.

## How to run + visually validate (this setup works)
- Dev server: from the worktree, `PORT=3210 pnpm dev`.
- `.env.local` is already in the worktree (copied from main; `DATABASE_URL_DIRECT` commented out — required or every authed page 500s).
- Auth for screenshots: the curator e2e signs in as `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` (a curator). Mirror `tests/e2e/global-setup.ts`: `signInWithPassword` in **node** → build the `sb-<ref>-auth-token` cookie → drive Playwright. The Playwright **MCP** browser sandbox blocks `require`/`import`/`process`, so use a node script run from inside the worktree (keeps the password out of chat).
- Route: `/curator/topology?symptom=<slug>`.

## Gotchas (learned this session)
- Migrations: drizzle-kit is broken — hand-write; `--> statement-breakpoint` markers are REQUIRED or the PGlite suite breaks; journal `idx` is a monotonic entry counter, NOT the filename number. Prod already has the diagnostic tables — do NOT re-apply these migrations to prod.
- Do NOT add an FK from a curator/core table (flows/flow_versions/research_runs/sessions) to platforms/symptoms — it breaks the PGlite test suite (see the SLUG REALIGNMENT comment in `lib/db/schema.ts`).
- `SendUserFile` and `ExitWorktree` are disabled while the session runs *inside* this worktree (harness quirk) — used `open <png>` to show screenshots.
- Test suite ~6 min; a cold-cache "PGlite is closed" flake on the first run is known — rerun once before treating as a regression.
- Base: stack everything on `feat/system-data-ingest` (NOT main, NOT the seed branch). This whole line heads toward the staging-curator / V2 line, not prod, for a long time.

## Validation checklist for next session
- [ ] Work in the worktree `.claude/worktrees/system-data-ingest` on `feat/system-data-ingest`.
- [ ] Read this handoff + the PR0 plan (`docs/superpowers/plans/2026-06-06-pr0-colocate-diagnostic-data.md`).
- [ ] `pnpm install` → `pnpm test` green → `pnpm exec tsc --noEmit` clean.
- [ ] Start at PR2 (system-data write contract + deterministic promoter), TDD against the 6.7 fixture.
