# HANDOFF — Decision locked + phased plan written: ship curator-flows as a safety beachhead, then build the topology grail

**Last updated:** 2026-06-16
**Branch (this session):** `revert/pr-96-6.0-psd-canonical-seed` (read-only investigation + planning; NO code/prod/DB touched). Build branch for execution is `feat/system-data-ingest`.

## THE ONE THING TO KNOW NEXT SESSION
The strategy is decided and the formal phased plan is written:
**`docs/superpowers/plans/2026-06-16-curator-flows-beachhead-to-topology-grail.md`** — read it first. This session was investigation → decision → plan. No code shipped, nothing on prod/DB. Next session executes **Phase 1** (on a preview, zero prod touch) after Brandon's review.

## THE DECISION (Brandon, this session) — "Beachhead → Committed Grail"
1. **Ship curator-flows to prod as a safety fix**, not a detour — the fabricating AI wizard is live; curator-flows is the ready, sourced, anti-fabrication replacement (it's `main` +1).
2. **Hard-cap the flow treadmill** (1–3 flows) — author only enough to be safely live + win first shops. Don't become the one-flow-at-a-time author.
3. **Topology is the committed NEXT build**, not "someday parallel." Flow citations/validated content become research fuel for the graph.
4. **Skip the unified-authoring option** (perfectionist infra trap for now).

## VERIFIED GROUND TRUTH (grounded in real code + Vercel, 2026-06-16 — corrects "one engine / empty catalog")
- **Prod = `main` = legacy AI wizard.** `vyntechs.dev` AND `vyntechs.com` alias to the `vyntechs-dev` project's `main`-branch production deployment (confirmed via the `…-git-main-…` alias). `origin/main` renders only `ActiveSession`; migrations to `0018`; no flows/diagnostics/topology. Neither new engine is live. (Note: local `main` was STALE — used `origin/main`.)
- **Three forked lineages, colliding `0017-0020` migrations:** `main`=legacy wizard; `feat/system-data-ingest` (1 behind / 87 ahead of main) = **curator-flows** engine (the main-line heir); `staging-interactive-diagnostics` / `feat/6.0-psd-cranks-no-start-seed` (~12 behind main) = **topology** engine (the holy grail, parked — #96's seed lives here).
- **#96 was reverted for PLACEMENT, not defects** (it landed on far-future staging). Seed is correct + preserved on `feat/6.0-psd-cranks-no-start-seed`.
- **Harvest is two roads:** flow→graph = a rebuild (re-extraction from prose; the flow type has no structured component/test/verdict/priority fields). graph→flow = clean. Flow citations + content carry as *research input*, not graph rows.
- **#98 (on prod) swept fake UI chrome** (the 73/100 dial, fake "where I looked" ledger, fake VIN scan) — NOT the AI diagnostic content. The AI path has **no honest "unverified" label** (Phase-1 must add one).
- **Zero flows authored** → merging curator-flows changes nothing user-facing until a flow is authored+published.
- **First shops run 2011–2016 F-250/350 6.7 PSD** → beachhead target. The resolver recognizes 6.7 ONLY for 2017–2022, so 2011–2016 resolves null (Phase-1 adds a new resolver branch). Beachhead symptom = **DEF/emissions limp-mode** — DTC-driven; handled via a free-text complaint pattern + in-flow "tap your code family" branching (no intake rebuild).

## IMMEDIATE NEXT STEP (exact first action for a fresh agent)
Open the plan doc and execute **Phase 1 OF 3 — Beachhead on PREVIEW (zero prod touch)**. First concrete actions: (a) add the 2011–2016 6.7 resolver branch + messy-input fix + one emissions complaint pattern to `lib/diagnostics/resolve-platform.ts` / `symptom-resolver.ts` on `feat/system-data-ingest`; (b) prove both Phase-1 gates on a preview (legacy-path interception fires; AI fallback honestly labels "not verified"); (c) author+publish the one DEF flow. All on a disposable, prod-shaped DB — NEVER prod or the live-login DB.

## HARD CONSTRAINTS / WHAT ONLY BRANDON DOES
- **Phase 2 (prod cutover) is hard-gated:** merging `feat/system-data-ingest` (~87 commits) to `main` + applying migrations `0019`/`0020` to the prod DB happens ONLY after rehearsal on a disposable prod-shaped DB, full verify, written rollback, and **Brandon's explicit go**. Nothing touches prod or the live-login DB without it.
- Rehearse migrations on a disposable DB cloned to prod's real state (`main`→`0018`) — the dev/live-login DB is NOT prod-shaped (carries topology seed prod lacks).
- Brandon reviews the plan before Phase 1 runs.

## WHAT SHIPPED THIS SESSION (verified)
- The plan doc (above) — 3 phases, each a pasteable brief, all 4 non-negotiables + both gates baked in.
- Memory updated: `diagnostics-engine-wiring-reality` (corrected to the 3-lineage map + prod-verified + harvest), new `first-shop-beachhead-trucks` (2011–2016 6.7 + DEF + DTC-wiring reality).
- `tasks/lessons.md`: `diagnostics-engine-is-forked-not-singular`, `spot-check-which-branch-an-agent-read`.
- No code, no prod, no DB writes.

## Resume prompt
```
Read HANDOFF.md in full and tell me where we left off.
```
