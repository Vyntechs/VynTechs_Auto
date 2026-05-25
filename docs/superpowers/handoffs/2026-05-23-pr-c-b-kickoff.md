# PR-C/B Kickoff — Interactive Electrical Topology UI (baseline)

**Date:** 2026-05-23 (evening)
**Branch:** `feat/topology-interactive-ui` (cut from `origin/staging-interactive-diagnostics` after PR-C/A #90 merged)
**Predecessor:** PR-C/A #90 — schema + seed + loader, merged 2026-05-23 PM
**Status:** Branch + kickoff seeded; **no plan exists yet** — fresh session drafts it first

**Brandon's one-line paste to start the fresh session:**

```
Read docs/superpowers/handoffs/2026-05-23-pr-c-b-kickoff.md and continue. You should be on branch feat/topology-interactive-ui; if not, git fetch && git switch feat/topology-interactive-ui.
```

---

## Where we are in the larger feature

The Interactive Electrical Topology feature is shipping as a stacked-PR series into `staging-interactive-diagnostics`:

| PR | Scope | Status |
|---|---|---|
| PR-A #87 | Data foundation (initial wiring schema) | ✅ merged |
| PR-B #88 | Browse-only topology diagram UI | ✅ merged |
| #89 | Fast-follow validation fixes for PR-B | ✅ merged |
| **PR-C/A #90** | Schema + seed + loader for the interactive instrument (new tables, prose columns, scenarios, pins) | ✅ merged 2026-05-23 PM |
| **PR-C/B (this one)** | **The interactive UI baseline** — scenario simulator, animated wires, click-pin-to-isolate, side panel, captured/missing footer, scenario persistence | **next** |
| PR-C/C (later) | Claude Design polish pass (mobile bottom-sheet, motion choreography, materiality details) | deferred per D18 |

PR-C/B's job is to turn the browse-only diagram into a **live electrical instrument** the tech can probe against. The data is already loaded by the PR-C/A loader; this PR is mostly UI + state + persistence.

---

## Workflow for the fresh session

The first phase is **drafting the plan**, NOT executing code. The spec is comprehensive (18 decisions locked) — no brainstorming round needed. Recommended sequence:

1. **Read the spec end-to-end** — `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`. Especially §3 (the user-flow narrative), §4 (the component-by-component design), §5 (the new compositional scenario picker per D13), §6 (states), §7 (data shapes — already implemented in PR-C/A), §8 (persistence — `sessions.last_scenario_slug`), §9 (empty/error states), §10 (test plan).
2. **Read the prototype** — `mockups/topology-guidance/round-3-opus/topology.html` is the visual + interaction reference. Also `RATIONALE.md` in the same dir for the "why" behind the locked decisions.
3. **Map existing surface** — what to extend vs. replace. The existing topology page is `app/(app)/sessions/[id]/page.tsx` (currently calls `loadSystemTopology` → renders `<TopologyDiagnostic>` with a layout). Consider dispatching a `feature-dev:code-explorer` subagent to map the existing component graph so the plan slices cleanly.
4. **Invoke `superpowers:writing-plans`** to draft the plan. Save it to `docs/superpowers/plans/2026-05-23-electrical-topology-interactive-ui.md`.
5. **Surface the plan to Brandon for review** — plain-English summary in chat, paths to the doc. Do NOT start code until Brandon nods.
6. **Then invoke `superpowers:executing-plans`** and work through the tasks.

---

## In scope for PR-C/B (the baseline)

Per spec D14 + D18, the baseline ships now and the Claude Design polish layer follows in a later PR. **In scope:**

- **Compositional scenario picker** (spec D13 + §5.1) — ignition switch widget + engine state toggle + load level selector + 2 fault-sim buttons. Replaces the flat 8-pill row from the prototype with semantic controls that mirror the truck. Same underlying 8 scenarios.
- **Wire animation system** — 13 wire states (`off`, `steady-12v/5v/gnd`, `signal-rest/low/med/high/pegged`, `pwm-low/med/high/max`). CSS dash patterns + cycle durations as defined in the prototype's `:root`.
- **6 electrical-role colors** — Signal (green) / 5V Ref (burnt orange) / Low Ref (graphite) / PWM (chartreuse) / 12V (red coral) / Ground (black). New `--role-*` tokens added to `app/globals.css` (additive, not replacing existing tokens).
- **Click-to-isolate pin selection** — pin click → its wire bolds + glows, all other wires dim to 25% opacity. Click another pin = clean transfer. Click background = clear.
- **Side panel — 3 states** — empty (default) / component-selected / pin-selected. KV-row + section-title language per spec §4.6.
- **Hybrid captured/missing footer** (D15) — hand-written framing wrapper + closing italic note; bullet rows derived from data (rows where field labels are null = missing).
- **Scenario persistence** (D11) — read `sessions.last_scenario_slug` on load (already returned by the PR-C/A loader); write on scenario change. Default scenario = Idle (D17) if no persisted state.
- **Mobile baseline** (D14) — inline panel below the diagram. The polished bottom-sheet pattern is for the Claude Design pass; the baseline ships with a simple inline reveal.
- **Simple labelled ignition-switch widget** — full rotary-key-dial visual is Claude Design polish material.
- **Default scenario = Idle** (D17) — Ignition = On, Engine = Running, Load = Idle.

## Out of scope for PR-C/B

- **No outcome recording** (D7) — no `tech_outcomes` writes, no "PASS/FAIL/WARN" tap-through. The diagram IS the diagnostic; tech judgment is the output. Outcome capture is a separate later PR if/when warranted.
- **No Claude Design polish layer** (D18) — bottom sheet, motion choreography, materiality details, real rotary key-dial. All parked. Handoff doc for that pass: `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md` (marked DEFERRED — picks up after PR-C/B baseline ships).
- **No new schema** — PR-C/A landed everything the loader returns. PR-C/B is read + render + write `last_scenario_slug` only.
- **No "AI" word in user-facing copy** (D8) — visible plumbing only.
- **No new platforms or systems beyond fuel on 6.7L Power Stroke** (D10) — same `(platform, system)` slice as the shipped browse topology.

---

## Source documents (in priority order)

1. **Spec (load-bearing):** `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md` — the 18-decision spec, the user-flow narrative, the component-by-component design, the state table, the persistence model, the test plan.
2. **Prototype (visual + interaction reference):** `mockups/topology-guidance/round-3-opus/topology.html` + `RATIONALE.md` + `PACKAGE.md` (same dir).
3. **Rejected mockups (context, not material):** `mockups/topology-guidance/round-3-opus/_rejected/` — useful to see what was tried and abandoned (the wizard-style framing, the verdict-pill pattern, etc.) so we don't recycle.
4. **PR-C/A's loader contract:** `lib/diagnostics/load-system-topology.ts` — return type `SystemTopology` is the API surface PR-C/B's UI consumes.
5. **Premium-UI research (motion + typography reference):** `docs/superpowers/research/2026-05-23-premium-ui-research.md` — still load-bearing for the baseline's motion + type discipline.
6. **Existing diagnostic flow:** `docs/superpowers/research/2026-05-22-existing-diagnostic-flow.md` — context on how the topology page fits into the session lifecycle.
7. **Claude Design handoff (DEFERRED — read only for context on what's not in this PR):** `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md`.

---

## Brandon's standing rules — apply here

These are the rules from `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/` most relevant to this PR. Apply without re-asking:

- **Brainstorm before code** — spec is comprehensive, no brainstorm needed. Go straight to writing-plans. (If, during plan drafting, you find spec gaps, surface them to Brandon and brainstorm THOSE specifically.)
- **Mobile validation required** (375–414 px) before "done" — D14 baseline pattern, every state.
- **No "AI" word in UI** — D8.
- **Plain-English summaries to Brandon** — never SQL/Drizzle/jargon when presenting to him; reserve code for the spec/plan artifact.
- **Cosmetic UI must soft-fail** — names/labels/avatars use `'—'` fallback; never crash a page over a missing display value.
- **Stacked PR base** — this PR's base is `staging-interactive-diagnostics`, NOT `main`. The "branch from main" rule is overridden for coordinated multi-PR launches per [[project_release_branch_pattern]].
- **Brandon merges via GitHub UI** — never push to `staging-interactive-diagnostics` or `main` directly; never merge from CLI.
- **No DB writes to production without explicit per-op approval** — reads fine. PR-C/B's only DB write is to `sessions.last_scenario_slug`, which only happens via the live app under a real user session, not from dev tooling.
- **Apply migration to live DB** — N/A for PR-C/B (no schema changes; PR-C/A handled it).
- **TDD via failing test first** — Brandon's [[feedback_test_driven_bug_capture]] applies if bugs surface during execution.
- **Validate with real inputs** — when smoke-testing, hit the session UI in the browser (the F-350 / P0087 session `681de115-5de9-474e-9721-263f65066e08` is the canonical test bed).
- **Claude validates first, Brandon validates last** — pre-flight tsc + tests + browser smoke-test in dev before handing off.
- **Vitest PGlite flake on cold cache** — rerun once if first `pnpm test` shows "Hook timed out in 10000ms" errors in `beforeEach`.

---

## Gotchas worth flagging up front

1. **Local `staging-interactive-diagnostics` is diverged from origin.** Don't try to push to it or pull-with-merge. This branch (`feat/topology-interactive-ui`) was cut directly from `origin/staging-interactive-diagnostics`, which has the truth.
2. **Branch name vocab.** `feat/topology-guided-walk` (PR-C/A) was named before the framing pivot to "interactive electrical topology." `feat/topology-interactive-ui` matches the new framing. The vocabulary that ships in the UI is *diagnostic*, never *walk* (D-vocab decision from the spec).
3. **D13 changed the scenario picker.** The prototype shipped a flat 8-pill row. The locked design replaces it with a compositional UI (ignition switch + engine state + load + fault sims). The 8 underlying scenarios are unchanged — only the picker UI shifts.
4. **Compositional picker maps to existing scenario slugs.** The 8 scenarios in the DB (`system_scenarios.slug`) are the same as the prototype's. The picker's job is to translate ignition+engine+load+fault selections into the right slug. Spec §5.1 has the mapping.
5. **Mobile is design-from-scratch for the baseline.** The prototype is desktop-only. D14 locks the baseline pattern (inline panel below diagram); execution still needs to ship working mobile screens at 375 + 414 px before "done."
6. **The scenario change should re-tune all wires simultaneously for the baseline** — the staggered "system waking up" choreography is Claude Design polish material.
7. **Working-tree untracked files exist** (screenshots, the prior PR-C/A handoff doc). They aren't on any branch. Ignore them or clean later — they don't block PR-C/B work.

---

## Definition of done for PR-C/B

The baseline ships when ALL of these are true:

- [ ] All 8 scenarios reachable via the compositional picker (6 operating + 2 fault sims)
- [ ] Default scenario on cold load = Idle (D17) when no persisted state
- [ ] Persisted scenario restores on reload (D11) — `sessions.last_scenario_slug` reads + writes
- [ ] Active scenario name is glance-readable at arm's length on mobile (D11 mitigation)
- [ ] All 13 wire-state animations render correctly across the 6 role colors
- [ ] Pin click isolates its wire (others dim to 25%); background click clears
- [ ] Side panel renders all 3 states (empty / component-selected / pin-selected) with KV-row + section-title structure
- [ ] Hybrid captured/missing footer renders (hand-written wrapper + data-derived bullet rows)
- [ ] Mobile (375 + 414 px) renders all states without overflow or hit-target shrink
- [ ] PR-B's browse-only topology page still works (no regression on the same `(platform, system)`)
- [ ] `pnpm tsc --noEmit` clean (only the gitignored designs/* noise)
- [ ] `pnpm test` green
- [ ] Browser smoke-test on the F-350 / P0087 session in dev shows the full flow working

---

## Related

- Spec: `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
- Prototype: `mockups/topology-guidance/round-3-opus/topology.html`
- Design polish handoff (deferred): `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md`
- PR-C/A merged: https://github.com/Vyntechs/auto/pull/90
- Loader contract: `lib/diagnostics/load-system-topology.ts`
- Premium-UI research: `docs/superpowers/research/2026-05-23-premium-ui-research.md`
