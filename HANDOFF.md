# HANDOFF — Phase 1 beachhead: Step 1 + both gates DONE & verified; research pipeline FIXED & working; one citation gap left

**Last updated:** 2026-06-17
**Work branch:** `feat/system-data-ingest` · **Worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/system-data-ingest` (NOT `main`, NOT the `revert/pr-96` checkout).
**Plan:** `docs/superpowers/plans/2026-06-16-curator-flows-beachhead-to-topology-grail.md` (Phase 1 of 3).

---

## WHERE WE ARE
Phase 1 (beachhead = 2011–2016 F-250/350 6.7 PSD, emissions/DEF limp-mode). **Done & verified:** Step 1 (resolver), Gate A (interception), Gate B (AI honesty banner) — 123 unit/integration tests green, `tsc` clean, AND a live browser run on a throwaway Supabase DB (gate screenshots at `.design-shots/out-phase1/phase1-gate-sheet.png`). **Step 5 (author the sourced DEF flow):** the curator research pipeline now **works end-to-end** — I fixed 3 live-API bugs this session and a real research run produced an **18-step draft flow** with genuinely strong Ford specifics (NOx CSPs 21N02/21N05, FSA 21E01, DEF pump test P20E8/P204C, DEF heater CSP 21M01, anti-tamper TSB 14-0192, SCR dosing pinpoint RK7…). **The one remaining gap:** that draft has **0 citations** — the citations pass is too big for one call on an 18-step flow, so my graceful-degrade safety net correctly fell back to the uncited structure draft. Unsourced = not publishable under the trust doctrine. Code is committed to `feat/system-data-ingest`.

## IMMEDIATE NEXT STEP (exact, no-context-needed)
Make citations survive on large flows by **chunking the citations pass** in `lib/research/synthesis-runner.ts` (in the worktree):
1. Replace the single whole-flow citations call (`max_tokens: 32_000`) with a **per-step** (or small-batch) loop: for each step, ask the model (tool-use, `emit_citations` returning just that step's `Citation[]`) to cite only that step from the agents' findings. Each call stays tiny → no truncation. Reassemble into the flow. TDD it in `tests/unit/research-synthesis.test.ts` (add a "citations survive on a many-step flow" case). Keep the existing anti-fabrication strip (drops any citation URL no agent fetched).
2. Re-run the pipeline against the throwaway DB (commands below). Confirm the new draft flow_version has citations on its steps (query `flow_versions.body` → count step citations).
3. Review the draft (it's state='draft' — `getPublishedFlowFor` ignores drafts, so nothing serves it yet). Shape step 1 into the code-family branch if the model didn't. **Publishing is Brandon's call** (AI-as-tool). Present it; only publish on his go.
4. Re-run `phase1-gate-walk.mjs` to re-screenshot the now-sourced wizard.

**Re-run commands (from the worktree):**
```
set -a && . ./.env.development.local && set +a && PORT=3210 node_modules/.bin/next dev &   # wait for :3210
node phase1-research.mjs          # dispatches a fresh run, prints runId, polls (14 min)
RUN_ID=<id> node phase1-poll.mjs  # if synthesis still running when the first poll ends
```

## HARD CONSTRAINTS / WHAT ONLY BRANDON DOES
- **NEVER touch the live DB** — Supabase `ynmtszuybeenjbigxdyl` ("Vyntechs Auto"): real shops, 85 real sessions, Stripe customers. All Phase-1 work uses the **throwaway** `cojmftuuukcsaxvcntls` only (`.env.development.local`). Live `.env.local` is UNTOUCHED.
- **Throwaway DB is KEPT UP** (Brandon's call, ~$10/mo prorated). **Delete it only after Step 5 + Brandon signs off** (task #7): via Supabase MCP / dashboard.
- **Publishing the beachhead flow is Brandon's decision** (strong-domain bar; the pipeline only drafts — it never publishes).
- **Phase 2 (prod cutover)** — merge `feat/system-data-ingest` → `main` + apply migrations 0019/0020 to the live DB — is hard-gated on Brandon's explicit go.
- Never commit secrets. `.env.development.local` (throwaway creds incl. the DB password) is gitignored — keep it so.

## WHAT SHIPPED THIS SESSION (committed to `feat/system-data-ingest`)
- **Step 1 — resolver:** `lib/diagnostics/resolve-platform.ts` (new 2011–2016 6.7 branch → `ford-super-duty-3rd-gen-67-psd`; 6.7 branch now uses `normalizeFordSuperDutyModel` for messy-input parity). `lib/diagnostics/symptom-resolver.ts` (DEF/emissions `COMPLAINT_PATTERN` → `reduced-power-limp-mode-emissions-suspect`; deliberately NOT matching bare "check engine"). `lib/curator/slug-catalog.ts` (both slugs).
- **Gate B:** `components/screens/ai-unverified-banner.tsx` (NEW — "AI GUESS · NOT VERIFIED BY A REAL TECH", amber, WCAG-AA) mounted in `active-session.tsx`, `diagnosis-proposed-review.tsx`, `repair-phase-view.tsx`.
- **Gate A:** `lib/flows/interception.ts` (NEW — `resolveWizardInterception`, extracted from `app/(app)/sessions/[id]/page.tsx`, which now calls it).
- **Research pipeline — 3 bugs FIXED:** `lib/research/subagent-runner.ts` (`parseStructuredOutput` scans ALL text blocks — web_search puts findings JSON in an earlier block; 0→50+ findings). `lib/research/synthesis-runner.ts` (durable rewrite: **tool-use structured output** instead of regex-on-free-text, **graceful degradation** so a failed pass falls back instead of killing the run, raised `max_tokens`, and **defensive field access** for model-output findings missing `sources`/`visitedUrls`).
- **Tests:** `interception-beachhead.test.ts` (7), `subagent-parse.test.ts` (4), `research-synthesis.test.ts` (rewritten to tool-use + degrade, 6), plus resolver/symptom/catalog/active-session updates. 123 green in isolation.

## PENDING / DEFERRED
- **Step 5 citation chunking** (the immediate next step above) → re-run → review → publish (Brandon).
- **Phase 1 final verify** (full-suite isolation sweep) + written "Gate A ✓ / Gate B ✓".
- **PR** for the verified code (already committed on `feat/system-data-ingest`).
- **Cleanup after Step 5:** delete throwaway project `cojmftuuukcsaxvcntls`; remove untracked `phase1-*.mjs` + `.env.development.local` from the worktree.

## GOTCHAS / NON-OBVIOUS FACTS
- **The research pipeline was never run against the live API before this session** — it had 3 latent bugs that only the real Anthropic `web_search` + real volume exposed (all fixed). Expect the citation chunking to possibly surface a 4th; budget for iteration.
- **0 citations on the draft is the safety net WORKING, not a regression** — graceful degrade returned an uncited-but-usable flow instead of failing the run. Citations need the per-step chunk to fit under the token ceiling.
- **Throwaway DB facts** (`cojmftuuukcsaxvcntls`): full schema via `drizzle-kit migrate` (pgvector enabled in `public` first). Curator user `e2e@vyntechs.com` (pwd = `TEST_USER_PASSWORD` in `.env.development.local`), `profiles.is_curator=true` AND **`is_comp=true`** (REQUIRED — without `is_comp` the app shows a subscription paywall, not the diagnosing screens). user_id `57998050-5c33-4802-b470-4e0b357c5eda`, profile.id `16e15549-2f55-4a41-9d65-a836eedc90cf`. Flow slug `sd-67psd-2011-2016-def-limp`, flow_id `c0a2eae2-ec5f-4ded-bb9b-53633dbeb986`: v1 = published skeleton `e8dd7e4a-…`; v2 = the research **draft** `46c6d153-3551-4db5-a2f8-bfc4128d8038` (18 steps, 0 citations). Sessions: wizard `5b80b520-…` (intercepts), uncovered `bf726fef-…` (AI banner).
- **The app connects as the Postgres `postgres` superuser** (pooler) → bypasses RLS; no RLS policies needed for it to read/write.
- **Local browser verify** uses the bundled chromium headless-shell (Playwright MCP broken locally) — see `phase1-gate-walk.mjs` (Supabase signin → `sb-<ref>-auth-token` cookie). `next dev` prefers `.env.development.local` over `.env.local`, keeping the live DB untouched.
- **Reusable scripts in the worktree (untracked):** `phase1-db-check.mjs`, `phase1-seed.mjs`, `phase1-gate-walk.mjs`, `phase1-research.mjs`, `phase1-poll.mjs`. All load `.env.development.local`.
- **Running synthesis standalone via tsx is blocked** by `@/` path-alias resolution — drive the pipeline through the running app's `/api/curator/research-runs/start` route (what `phase1-research.mjs` does).

## RESUME PROMPT
```
Read /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/system-data-ingest/HANDOFF.md in full and tell me where we left off. We're on Phase 1 of the curator-flows beachhead; Step 1 + Gate A + Gate B are done/verified and the research pipeline now works end-to-end (it produced an 18-step draft). The one remaining task is making citations survive on large flows — chunk the citations pass per-step in lib/research/synthesis-runner.ts, re-run the pipeline against the throwaway DB (cojmftuuukcsaxvcntls, kept up), confirm the draft has citations, then hand me the draft to review before publishing. Do NOT touch the live DB (ynmtszuybeenjbigxdyl). Start by reading synthesis-runner.ts and proposing the per-step citation chunk.
```
