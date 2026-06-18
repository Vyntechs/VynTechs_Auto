# HANDOFF — Citation chunking DONE & verified (unit + real-API: 0→162 citations); PR drafted-not-opened; prod-safety analysis is the next gate

**Last updated:** 2026-06-18
**Work branch:** `feat/system-data-ingest` · **Worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/system-data-ingest` (NOT `main`, NOT the `revert/pr-96` checkout).
**Plan:** `docs/superpowers/plans/2026-06-16-curator-flows-beachhead-to-topology-grail.md` (Phase 1 of 3).

---

## WHERE WE ARE
Phase 1 beachhead (2011–2016 F-250/350 6.7 PSD, DEF/emissions limp-mode). **The citation gap is CLOSED.** The synthesis citations pass was rewritten from a single whole-flow call (which truncated on big flows → 0 citations) to **per-step chunking** — one tiny `emit_citations` call per step, reattached to the structure draft, findings cached, bounded-parallel, per-step degrade. **Verified at three levels:** 7/7 synthesis unit tests (incl. a new "citations survive on a many-step flow" RED→GREEN case), `tsc` clean, full suite green on a clean run; AND a **real-API synthesis-only re-run** produced **162 citations across all 23 steps** (125 confirmed / 37 plausible) + 6 conflicts — vs the prior 0/18. Code committed to `feat/system-data-ingest`.

## IMMEDIATE NEXT STEP (exact, no-context-needed)
Brandon was deciding **how to open the PR** when we paused; he asked **"will merging break prod?"** — that's the live question. Resume here:
1. **Open the PR (Brandon's pending choice).** A DRAFT PR `feat/system-data-ingest → main` is recommended (brief: `tasks/todo.md`, last block). **Opening a draft PR touches NOTHING in prod** — it's a review page. Options offered: (a) draft PR → main [recommended], (b) commit+push only / hold PR, (c) different base. He has not picked.
2. **Run the prod-breakage risk gate (the real answer to his question) — do this on the PR diff, do NOT merge.** Proportional to "live money + data":
   - Diff THIS branch's migrations vs what's actually applied on the **prod** DB `ynmtszuybeenjbigxdyl` (the real collision check — memory says the forked engines have COLLIDING migrations; verify, don't trust memory). Live DB has real shops, ~85 sessions, Stripe customers.
   - Map every change to the live user path (intake routing / engine swap) + confirm whether a feature flag can ship it dark. `main → prod` auto-deploys on Vercel, so **merge = instant live**.
   - Confirm the prod flows catalog isn't empty for the engine we'd switch to (else users hit empty diagnostics).
   - Dry-run on a prod-like copy. Then bring Brandon a grounded yes/no.
3. **Publish the beachhead flow** — still Brandon's call (strong-domain bar; AI-as-tool). The sourced draft exists (see below); present it, publish only on his go.

## HARD CONSTRAINTS / WHAT ONLY BRANDON DOES
- **NEVER touch the live DB** — Supabase `ynmtszuybeenjbigxdyl` ("Vyntechs Auto"): real shops, 85 real sessions, Stripe customers. All Phase-1 work uses the **throwaway** `cojmftuuukcsaxvcntls` (`.env.development.local`). Live `.env.local` UNTOUCHED.
- **Do NOT merge `feat/system-data-ingest` → `main`** (the Phase-2 prod cutover) without the risk gate above AND Brandon's explicit go. `main` auto-deploys. Per `pr-merge-ownership` memory, Claude MAY merge/deploy but ONLY through a hard verify-everything gate.
- **Publishing the beachhead flow is Brandon's decision.**
- **API cost reality (Brandon flagged):** the app's Anthropic calls bill the **API key**, NOT his Claude Code subscription — there is no supported way to route app calls through the subscription. To test synthesis cheaply, **never re-run the research phase** (the 2M-token web_search fan-out); re-run **synthesis-only against the saved `research_runs.agent_outputs`** (see below). Pennies, not dollars.
- Never commit secrets. `.env.development.local` (throwaway creds) is gitignored — keep it so.

## WHAT SHIPPED THIS SESSION (committed to `feat/system-data-ingest`)
- **Per-step citation chunking** — `lib/research/synthesis-runner.ts`: new `EMIT_CITATIONS_TOOL` + `runCitationsPass(draftBody, findingsJson, addUsage)` replaces the single whole-flow citations call. One `emit_citations` call per step (returns just that step's `Citation[]`), findings JSON sent in a `cache_control: ephemeral` system block, bounded concurrency (`CITATION_CONCURRENCY=4`), per-step try/catch (one step failing leaves only that step uncited), reassembled onto the structure draft. Anti-fabrication strip unchanged. `callTool` (structure + conflicts passes) untouched.
- **Tests** — `tests/unit/research-synthesis.test.ts`: new many-step RED→GREEN case, 1-step tests updated to `emit_citations`, the old "no-steps body" test reworked into a per-step-isolation test. 7/7 green.

## PENDING / DEFERRED
- **Open the PR** (Brandon's base/scope choice) → **prod-breakage risk gate** → his go/no-go on cutover. Brief in `tasks/todo.md`.
- **Publish** the sourced beachhead draft (Brandon).
- **Speed:** synthesis wall-clock ~6.4 min (structure pass generates a ~23-step flow + 18-ish per-step citation calls). Acceptable for a back-office curator action; can ~halve it by bumping `CITATION_CONCURRENCY`.
- **Draft quality nit:** the model set step `of` = 20 but emitted 23 steps (cosmetic count mismatch — curator/cleanup fix).
- **Cleanup after publish:** delete throwaway project `cojmftuuukcsaxvcntls`; remove untracked `phase1-*.mjs` + `.env.development.local`.

## GOTCHAS / NON-OBVIOUS FACTS
- **The sourced draft is in `/tmp` (EPHEMERAL), not the DB:** `/tmp/draft-review.md` (readable walk-through) + `/tmp/resynth-draft.json` (raw 23-step flow + 162 citations + 6 conflicts). NOT persisted as a flow_version. Reproducible by re-running synthesis-only (below). If you want Brandon to walk it in the UI, persist it as a `draft` flow_version in the **throwaway** DB (his call).
- **Cheap synthesis-only re-run (THE pattern):** the orchestrator persists agents' findings to `research_runs.agent_outputs` BEFORE synthesis (`lib/research/orchestrator.ts:128`). The most recent COMPLETED throwaway run is **`f92e438e-f009-488a-adfa-8c67bb30da4a`** (3 agents, 53 findings, 200 URLs). Re-run synthesis against those saved findings — NO web_search, NO research re-run. Mechanism used this session: a temp vitest harness (`// @vitest-environment node`) importing `@/lib/db/client` + `runSynthesis`, run with `set -a && . ./.env.development.local && set +a && vitest run <harness>` (vitest resolves the `@/` alias the handoff said blocks `tsx`; the un-mocked real client + env key make the cheap calls). The harness was deleted after use — recreate from this recipe.
- **Full vitest suite is FLAKY under load** — saw 84 / 12 / 0 failures on the SAME code across three runs (DB-teardown races like `close is not a function`). Verify changes via the affected files in isolation + `tsc`, NOT a single full-suite count. (Memory: `full-suite-flaky-db-tests`.)
- **Throwaway DB facts** (`cojmftuuukcsaxvcntls`): curator `e2e@vyntechs.com` (pwd = `TEST_USER_PASSWORD` in `.env.development.local`), `is_curator=true` AND `is_comp=true` (without `is_comp` the app shows a paywall, not the diagnosing screens). Flow slug `sd-67psd-2011-2016-def-limp`. The app connects as the Postgres `postgres` superuser (pooler) → bypasses RLS.
- **`@/lib/db/client`** = plain postgres-js to `DATABASE_URL_DIRECT` (dev) / `DATABASE_URL` — no PGlite swap; loading `.env.development.local` points it at the throwaway DB. `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` (sonnet-4-6) are in that same env file.
- **Reusable untracked scripts in the worktree:** `phase1-db-check.mjs`, `phase1-seed.mjs`, `phase1-gate-walk.mjs`, `phase1-research.mjs`, `phase1-poll.mjs`.

## RESUME PROMPT
```
Read HANDOFF.md in full and tell me where we left off. We're on Phase 1 of the curator-flows beachhead. The citation-chunking fix is DONE and verified (unit + a real-API synthesis-only re-run produced 162 citations across all 23 steps). The code is committed to feat/system-data-ingest and pushed. We paused on opening the PR: I asked whether merging this branch to main would break prod. Next: confirm how to open the PR (draft → main recommended; brief in tasks/todo.md), then run the prod-breakage risk gate ON THE DIFF (migrations vs the live DB, user-path/routing changes, feature-flag, prod catalog) and bring me a grounded yes/no BEFORE anyone says "merge." Do NOT touch the live DB (ynmtszuybeenjbigxdyl) and do NOT merge to main.
```
