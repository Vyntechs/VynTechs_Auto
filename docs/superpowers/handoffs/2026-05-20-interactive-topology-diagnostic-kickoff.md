# Handoff — Interactive Wiring-Topology Diagnostic · Build Kickoff

**Date:** 2026-05-20
**For:** the next session (fresh context)
**Resume line:** `Resume from docs/superpowers/handoffs/2026-05-20-interactive-topology-diagnostic-kickoff.md`

---

## The one sentence

Build the **interactive wiring-topology diagnostic** in the Vyntechs app — port the
prototype Brandon made into the real app, wired to the live Phase 2 database. This is
the actual diagnostic surface; the static test-plan list shipped in Phase 3 PR1 was
the wrong shape.

---

## The correction that triggered this handoff

Phase 3 PR1 shipped a "cached diagnostic overview" that is a **static, read-only
13-step test-plan list**. Brandon tested it on a real device and it was a dead end —
you can read the list but you cannot *do* anything with it.

He pointed at the reference artifact and said: *"We didn't do all this for asking
questions, it was interactive."*

**The diagnostic is not a list, and not a question-and-answer flow.** It is an
**explorable wiring-topology diagram** — see `THE TARGET` below. This was always the
intent; it's in long-standing project memory (`project_wiring_tool_diagnostic_complete`,
`feedback_theory_of_operation_is_source_not_panel`): *the canonical topology from the
theory of operation IS the diagnostic surface.* PR1's test-plan list diverged from
that. This handoff puts it back on track.

---

## THE TARGET — what to build

**Reference prototype (read it first, in full):**
`docs/superpowers/reference/vyntechs-fuel-system-prototype.html`
(also on Brandon's Desktop as `vyntechs-fuel-system-prototype.html` — the in-repo copy
is the canonical one now.)

It is a single self-contained HTML file. Open it in a browser to feel it. What it is:

- An **SVG diagram** of the 6.7L Power Stroke fuel system — PCM, lift pump, volume
  control valve, FRP sensor, FRP regulator, the high-pressure pump, shared splices —
  with every wire drawn and **color-coded by electrical role** (signal / 5V ref /
  low ref / PWM / 12V / ground).
- **Every component, pin, and wire is clickable.** Clicking opens a side panel with:
  physical location on the truck, the part's role, **what to expect when you probe
  it**, and **what a wrong reading means** (the diagnostic payload).
- A **scenario bar**: key-off / key-on / idle / light–medium–heavy load, plus fault
  simulations ("pegged high pressure", "no pressure"). Switching scenario animates the
  wires — pulse rate ∝ activity / PWM duty — and updates a "right now" readout.
- A footer tracking **what's captured from theory vs what labels are still missing**
  (wire colors, pin numbers) — missing labels make probing faster, not possible.

The tech *explores the system* and the expected readings + failure meanings are
attached to every point. That is the diagnostic.

---

## THE DATA — it already exists in the live database

Phase 2 already captured exactly this data. The prototype's hard-coded `DATA` object
is, for real, in Supabase. **Project `ynmtszuybeenjbigxdyl`.**

For the one seeded platform (`ford-super-duty-4th-gen-67-psd`, 2017–2022 F-250/350/
450/550 6.7 PSD), across 7 systems (fuel, cooling, air/turbo/EGR, engine-mechanical,
electrical):

| Table | ~Count | Holds |
|---|---|---|
| `components` | 123 | the boxes — PCM, sensors, valves, pumps, splices; `kind`, location, `platformId`, `isRetired` |
| `observable_properties` | 187 | per-component/pin: observation method, expected reading, what-wrong-means |
| `component_connections` | 188 | the wires — from/to component, connection kind (the topology) |
| `architecture_facts` | 141 | system-level facts, each source-tagged (TRAINING-CONFIRMED / INFERRED / FIELD-VERIFIED / GAP) |
| `test_actions` | 28 | the probe steps |
| `branch_logic` | 83 | "if you see X, do Y" |
| `symptom_test_implications` | 44 | which tests matter for which symptom + priority |
| `symptoms` | 3 | P0087, P0088, no-start-cranks-normally |

Read the table shapes in `lib/db/schema.ts`. The prototype is the design; the database
is the content. The job is to render one from the other.

---

## THE ONE HARD PROBLEM — diagram layout

The prototype **hand-places every box** with exact SVG x/y coordinates. The database
stores **topology** (what connects to what) but **not screen coordinates**. So the
real version needs a way to lay the diagram out from the connection graph.

This is the first thing to design. Options to weigh:
1. **Auto-layout** — run the components+connections through a graph-layout library
   (dagre, elk, d3-force) at render time. No stored coordinates; works for every
   future platform/system for free; layout may be less hand-polished than the prototype.
2. **Stored coordinates** — add x/y to `components` (and waypoints to connections),
   author them per system. Pixel-perfect like the prototype; manual work per system,
   doesn't scale to the 7 diesel platforms in the seeding plan.
3. **Hybrid** — auto-layout as the baseline, optional stored overrides.

Recommendation to pressure-test: auto-layout (option 1) — it scales, and the diesel-
seeding plan adds 7 more platforms. But brainstorm it; this decision shapes everything.

**Start the next session with `superpowers:brainstorming` on this layout question.**

---

## What carries forward from PR1, what's superseded

PR1 (Platform Resolver + Cached Diagnostic Overview) is **merged** into
`staging-interactive-diagnostics` (PR #81).

**Keep / build on:**
- `lib/diagnostics/resolve-platform.ts` + `symptom-resolver.ts` — vehicle+complaint →
  cached platform/symptom. This routing is correct and needed.
- The cache-hit pre-flight in `app/api/sessions/route.ts`, the `cached-overview` route
  kind in `lib/session-routing.ts`.
- The intake-form chip picker (`components/intake/cached-complaint-picker.tsx`).

**Superseded by the topology view:**
- `components/screens/cached-overview.tsx` — the static 13-step test-plan list. The
  topology diagram replaces this as what a tech sees on a cache hit. Don't extend it;
  replace it.

---

## Repo / PR state (verify with `gh pr view` — it drifts)

- Main orchestration integration branch: **`staging-interactive-diagnostics`**.
- **PR #81** — Phase 3 PR1 — **MERGED**.
- **PR #82** — draft `staging-interactive-diagnostics → main` — a preview surface only;
  leave it open, it auto-updates; do not merge.
- **PR #83** — `fix/cached-overview-exit → staging-interactive-diagnostics` — **OPEN,
  should be merged.** Contains two real fixes: (a) the platform resolver accepting the
  inputs techs actually type (`6.7` engine, `F350` no hyphen) — **essential, keep this
  regardless of the topology rebuild**; (b) the cached-overview dead-end fix (back link
  + "Mark incomplete"). The dead-end fix only matters until the topology view replaces
  that screen, but the resolver fix is permanent. Merge #83.

New work branches from `staging-interactive-diagnostics` (the orchestration line),
not `main`. Never push to `main`; Brandon merges PRs himself.

---

## Other in-flight — do not lose

- **Diesel seeding** — branch `feat/diesel-platform-seeding`,
  `docs/superpowers/diesel-seeding-strategy.md` + `diesel-research-appendix.md`.
  Research-grounded plan to seed Ford 6.7 PSD (2 more gens) / GM Duramax LML+L5P / Ram
  6.7 Cummins — an 8-platform taxonomy. **Awaits Brandon's sign-off on the taxonomy
  (§2)** before any loop run. Separate track from the topology build.
- **Design decisions log** — branch `phase3-pr1-design-notes`, `DESIGN-DECISIONS-LOG.md`
  — autonomous calls D1–D7 made during PR1.
- **Validation evidence** — `validation-pr1/` on `staging-interactive-diagnostics`:
  report + screenshots from PR1's live UI validation (7 bugs found + fixed).

---

## How to work (carry forward)

- **Brandon is a non-engineer founder.** Plain-English check-ins; no jargon in
  decision summaries.
- **Autonomous mode** — keep moving, use branches for commits, Brandon validates.
  Answer design questions as Brandon would and log them; don't stall on questions.
- **Brainstorm before building** (`superpowers:brainstorming`) — this is a non-trivial
  feature.
- **Validate with the messy inputs techs actually type**, not idealized strings — see
  `feedback_validate_with_real_inputs`. Three PR1 bugs shipped because validation used
  perfect inputs.
- **Validate on the real authed app**, and validate the *workflow*, not just that a
  screen renders (`feedback_verification_rigor`).
- Local sign-in for validation: the test password in `.env.local` is stale (account
  moved to Google auth). Mint a one-time magic link with the Supabase admin key
  (`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`) and hit `/auth/confirm?token_hash=…&
  type=magiclink&next=/today`. The dev server talks to the **live** Supabase — creating
  test sessions writes real rows; clean them up (delete by id) when done.
- **No diagnostic data written to live Supabase without Brandon's per-batch approval.**

---

## First steps for the next session

1. Read the prototype in full: `docs/superpowers/reference/vyntechs-fuel-system-prototype.html`.
2. Read `lib/db/schema.ts` for the `components` / `observable_properties` /
   `component_connections` table shapes; query the live DB to see real rows.
3. `superpowers:brainstorming` on the **layout problem** (the section above) — settle
   auto-layout vs stored coordinates first; it shapes the whole build.
4. Then design the build: data layer (load topology for a platform+system), the
   diagram component, the detail panel, scenario simulation — scoped to the fuel
   system on the F-250 first (the prototype's exact subject, so the data is all there
   to prove it end-to-end).
5. Build on a branch off `staging-interactive-diagnostics`. Validate live.
