# HANDOFF — Topology gate now FIRES: interactive diagnostic shipped to prod (PR #110); awaiting Brandon's visual confirm

**Last updated:** 2026-06-20
**Work branch:** `fix/topology-symptom-reconcile` (MERGED to `main` via PR #110, `600b4e4`; remote branch deleted). Local checkout still on this branch.
**Prod:** deployed and **Ready** on `vyntechs.dev` (Vercel prod deployment `vyntechs-ad2y4f3rc`).

---

## WHERE WE ARE
The interactive **topology diagnostic** (live wiring diagram) had **never once fired for a real session** — every intake fell back to the legacy AI step-plan. Brandon hit the legacy screen 3× on combos that should have shown the diagram. Root cause (proven against the live DB, not guessed): `resolveSymptomSlug` emits a **bare DTC code** (`p0087`) but the seeded `symptoms` row is **descriptive** (`p0087-fuel-rail-pressure-too-low`), so `loadSystemTopology` always missed. Two sibling mismatches (crank-prose slug `cranks-no-start` not seeded; engine-string strictness) compounded it. **Fix is built, verified, merged, and deployed.**

## IMMEDIATE NEXT STEP (exact, no-context-needed)
1. **Brandon's visual confirm is the only thing open.** Have him reload session **`1795E2D2`** (his 2018 F-250 + P0087) on `vyntechs.dev` — it should now render the interactive diagram (25-component fuel graph), NOT the "AI GUESS" step list. Existing sessions upgrade automatically (the gate recomputes at render). If it does NOT render, the first thing to check is whether prod (`ynmtszuybeenjbigxdyl`) seeds the same 3 reachable slugs this fix assumes (see verify recipe below).
2. If confirmed → the gate-reachability work is **done**. Next candidate work (all Brandon-gated, NOT started): (a) platform engine/model **widening** so a bare "6.7"/"Super Duty"/"250" resolves; (b) **DEF/emissions** topology seeding (currently correctly falls to AI); (c) **2011–2016 3rd-gen 6.7** beachhead seeding.

## WHAT SHIPPED THIS SESSION (on `main`, deployed)
- **`lib/diagnostics/reconcile-seeded-symptom.ts`** (NEW) — DB-aware, **reachability-gated** reconciliation. Maps the resolver's candidate → an actually-seeded slug: exact-match → first-DTC prefix (separator-tolerant for `P 0087`/`P-0087`) → crank/no-start prose → rail-pressure prose → null. Pure decision fn `pickSeededSymptom` + thin `loadReachableSymptomSlugs` query (mirrors `loadSystemTopology`'s gate exactly) + wired `reconcileSeededSymptom`.
- **Wired BOTH topology call sites** with the one shared helper so intake↔render can't drift: `app/api/intake/submit/route.ts` and `app/(app)/sessions/[id]/page.tsx` (render also reuses the reconciled slug for the diagram's label + active-symptom props, not just the load).
- **27 new unit tests** (`tests/unit/reconcile-seeded-symptom.test.ts`) covering the full misroute/coverage matrix. Lesson added: `slug-contract-must-match-seeded-data-not-just-compile`.
- **Untouched (deliberate):** the pure `resolveSymptomSlug`, `extractDtcCodes`, `COMPLAINT_PATTERNS`, and the curator-flow gate `interception.ts` — no re-key, pinned tests stay green.

## DESIGN DECISION (Brandon-stated, encode it)
**Entered DTC wins.** A complaint carrying a seeded code routes to that code's graph even with crank/no-start language ("I typed P0087 → show me P0087"). Prose fallbacks (crank→no-start, rail-pressure→p0087/p0088) only fire when there is NO seeded DTC. NOT the "crank-aware override" the red-team floated — simpler and predictable for techs.

## HARD CONSTRAINTS / WHAT ONLY BRANDON DOES
- **Live/prod DB = `ynmtszuybeenjbigxdyl`** ("Vyntechs Auto"): real shops, ~89 sessions, Stripe customers. This session used it **read-only** (SELECTs) for diagnosis + the live e2e check — fine. Never write to it without Brandon.
- **Seeding** (DEF/emissions, 2011–2016 3rd-gen) and **platform widening** are Brandon's calls — do NOT bundle them into a "fix."
- Per `pr-merge-ownership` memory, Claude MAY merge/deploy but ONLY through a hard verify-everything gate (done here under his explicit "ship it").

## PENDING / DEFERRED
- **Brandon's visual confirm** on `1795E2D2` (the one open item).
- **Sentinel-degradation guard** — intentionally skipped: only triggers if topology data is retired mid-session (rare), and its "fix" (route to tree-generating) could hang a sentinel session that has no real AI tree. Noted, not built.
- Platform engine/model widening; DEF seeding; 2011–2016 3rd-gen seeding (all gated).
- The older `feat/system-data-ingest` beachhead/citation track is a SEPARATE work stream (see git history) — not touched this session.

## GOTCHAS / NON-OBVIOUS FACTS
- **Seeded reachable set (prod DB), verified this session:** ONLY platform `ford-super-duty-4th-gen-67-psd` (2017–2022 6.7 PSD), 3 symptoms, all `system='fuel'`, 25 non-retired components each: `p0087-fuel-rail-pressure-too-low`, `p0088-fuel-rail-pressure-too-high`, `no-start-cranks-normally-fuel-system-suspect`. The whole fix makes exactly these reachable from natural prose/DTC intake.
- **Live e2e verify recipe** (drives the REAL chain, not a mirror): a tsx script importing `resolvePlatformSlug` + `resolveSymptomSlug`/`extractDtcCodes` + `reconcileSeededSymptom` + `loadSystemTopology` + `@/lib/db/client`, run with `npx tsx --env-file=.env.local <script>`. `.env.local` points `@/lib/db/client` at the prod DB. (Script was a one-off, deleted; recreate from this recipe.) Confirmed: Brandon's exact input → renders 25-component fuel topology; DEF + P2002 → AI.
- **Vitest full-suite is FLAKY under load** (PGlite teardown races) — verify via affected files in isolation + `tsc`, never a single full-suite count. (Memory: `full-suite-flaky-db-tests`.)
- **Vercel:** `main` auto-deploys to prod (`vyntechs.dev`). MCP `Vercel` 403s on this team scope — use the linked `vercel` CLI (`vercel ls --yes`). zsh gotcha: `$status` is read-only; the `app/(app)/...` path needs single-quoting to dodge zsh globbing.
- **How the fix was built:** 10-agent Workflow `wp6nkmvyt` (5-agent edge-case map → synthesize → 3-agent adversarial red-team) produced the spec; the red-team killed a multi-DTC misroute and a render-label mismatch before any code. Then TDD for the implementation.

## RESUME PROMPT
```
Read HANDOFF.md in full and tell me where we left off. The topology-gate fix shipped to prod this session (PR #110 merged to main, deployed to vyntechs.dev). The only open item is Brandon's visual confirm that reloading session 1795E2D2 now shows the interactive diagnostic instead of the AI step-plan. If he confirms it works, the gate-reachability work is done; the next candidate work (all Brandon-gated) is platform engine/model widening, DEF/emissions seeding, and 2011-2016 3rd-gen seeding. Do NOT write to the prod DB (ynmtszuybeenjbigxdyl) or bundle seeding into a fix without his go.
```
