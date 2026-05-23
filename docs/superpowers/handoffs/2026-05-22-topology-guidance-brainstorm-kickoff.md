# Topology Guidance — Brainstorm Continuation Kickoff

**Date:** 2026-05-22
**Branch:** `feat/topology-guided-walk` (cut from `origin/staging-interactive-diagnostics` *after* PR #89 merged)
**Status:** Brainstorm partway — shape and scope are LOCKED; the design draft below is on the table but **not approved**. Brandon asked for interactive HTML mockups he can explore in a browser before he'll lock the design.

**Resume trigger / Brandon's one-line paste:**

```
Resume the topology-guidance brainstorm — read docs/superpowers/handoffs/2026-05-22-topology-guidance-brainstorm-kickoff.md (you should already be on branch feat/topology-guided-walk — git fetch && git switch feat/topology-guided-walk if not)
```

---

## What this is

The next major Phase 3 PR: **guided diagnostic walk on the interactive topology**. The previous session got partway through the brainstorm — two big forks are resolved, a technical design is sketched. Before the design is signed off, Brandon's exact instruction: *"create HTML pages where you give me a link and it opens it in a browser, and I can explore it interactively and see what you're talking about, with mock data."* Build interactive mockups → iterate with him → only then lock the design and move to spec → plan → execute.

## What's already locked

- **Shape — Diagram-as-scoreboard.** The topology itself becomes the live guided-diagnosis surface: parts numbered in test order, the active one highlighted, each fills in ✓/✗ as results are recorded. Rejected alternative: "Guide in the panel" (diagram stays static, panel walks through). The chosen shape is the distinctive thing no current diagnostic tool does — research reviewed Identifix Direct-Hit, Mitchell 1 ProDemand / SureTrack, Snap-on guided component tests, Bosch ESI, Autel guided functions, ALLDATA. None use the system map as a live progress record.
- **Scope — Walk + save together** in one PR. PR 1 ships the full guided walk AND persists every result to the database — so the library compounds from day one, and reloads mid-walk survive. Rejected alternative: "Walk now, save later" (smaller first PR; ephemeral walks).

## Current design draft (NOT approved — to refine after mockups)

### 1. What a tech sees

Open a cached fuel session (e.g. the 2017 F-350 / P0087 case, session `681de115-5de9-474e-9721-263f65066e08`) → topology renders with parts numbered in test order; the first is highlighted (▶), the rest are greyed (· upcoming). Tap the active part → its side panel switches from "browse" to "guided" — showing the test (what to do, what to expect) and a list of observation options. Each option is one of the existing `branch_logic.condition` strings in plain shop English ("FRP PID reads near 0 PSI at idle…", "…reads in normal range," etc.), plus a "Can't run this" escape.

Tap the option matching what was actually seen → the diagram's badge fills in and the walk advances:

- **OK** → next part highlights, continue.
- **Fail** → walk ends with a "Recommended fix" card carrying the branch's `nextAction` text + the trail of steps run.
- **Warn** → step is flagged on the diagram, continue.

Reload mid-walk → resume from where you were. Every tap saves as it happens.

### 2. The order of parts

Sequenced by signals already in the data: tests with `implicatedByCurrentSymptom = true` first, then by `invasiveness` ascending. A component's position in the sequence = the highest-priority test on it.

### 3. Routing

Uses existing `branch_logic` without a schema change:

- **Fail** ends the walk and surfaces that branch's `nextAction` text as the fix card.
- **OK** advances to the next-priority test (next part if this one's done).
- **Warn** flags the step on the diagram and continues.

A future PR can add structured "next test" pointers if the heuristic ever leaves gaps.

### 4. What gets saved

- One `diagnostic_sessions` row per walk (table from Phase 2).
- One `tech_outcomes` row per step the tech taps (table from Phase 2).
- Walk state — which test is active — is **derived** from those outcomes, not stored separately.

**No new tables. No new columns.**

### 5. How it fits the codebase

`<TopologyDiagnostic>` gains a "guided" mode: when a session has an active walk, its detail panel switches from browse (read-only) to guided (active test + branches as tap targets). The diagram gains walk-aware badges (▶ active, ✓ pass, ✗ fail, · upcoming). A small `advanceWalk()` server action handles each tap — writes the outcome, returns the new state. Same shape as the existing `advanceSession` for the AI flow.

### 6. NOT in this PR

- A vehicle-profile page showing past walks (a follow-up).
- A confidence percentage — the visual scoreboard *is* the indicator.
- AI on-demand for new symptoms (Phase 3 kickoff's PR 4).
- Cross-platform inheritance (Phase 3 kickoff's PR 5).
- Editing past walks (read-only once saved).
- Schema changes for structured routing — heuristic is enough for v1.

### 7. Testing

Unit-test the advance logic (state + observation → next state). Test the sequencing. Test DB writes via PGlite. Smoke-test the new screen. Live re-validate on a fresh preview against session `681de115-…`, desktop + mobile.

## Research that informed the design

`docs/superpowers/research/2026-05-22-guided-diagnostics-ux-patterns.md` — Sonnet subagent's findings on how leading diagnostic tools guide a tech. **Top 5 patterns:** (1) probability-first ordering, (2) diagram-as-live-navigation-index (Vyntechs already does this), (3) all-info-in-one-card, (4) binary/categorical tap-to-record, (5) **topology-as-live-progress-record — the untapped gap.** The 5th pattern drove the shape choice; the others inform the design details.

## What's still open — to dial in via mockups

Brandon needs to see and tap through these before approving. These are the questions the mockups should make answerable:

1. **Visual density.** With 22 fuel components numbered + badged, does the diagram get noisy on desktop and on a phone? Should upcoming parts be heavily de-emphasized (low opacity / faded), or kept readable for context? Are sequence numbers leading badges, or shown on hover?
2. **The active-test panel layout.** Test description, "what to expect" text, list of tap-able branch options, "Can't run this" escape — desktop side-panel and mobile bottom-sheet variants.
3. **Branch-option tap targets.** Real `branch_logic.condition` strings are full sentences. How does a tappable card sized for that much text look? Does each card show a leading verdict icon (✓ / ✗ / ⚠)? Can the tech scan three or four 1–2-sentence options without fatigue?
4. **The "Recommended fix" terminal card.** When a fail terminates the walk: layout for the recommendation text + trail of "you ran A→ok, B→ok, C→fail" + a clear "what next" affordance (Close case? Print? Hand to advisor?).
5. **Reload-resume welcome.** A tech reloads mid-walk — first thing they see ("You were on test 3 of 6 — pick up here"?). Sticky banner? Dismiss-able?
6. **All-passes ending.** If every step is OK and the walk runs out, what does the tech see ("All implicated tests came back OK — escalate / check connection points / etc.")?
7. **Badge style.** Color tokens, sizing — match the existing topology palette (`--vt-amber-500`, `--vt-elem-*`, etc. in `app/globals.css`).

## What the mockups should be

- A small set of **standalone HTML pages** — plain HTML + CSS + a touch of JS for click-through. No React, no Next.js. Brandon opens them locally.
- Live under a fresh `mockups/topology-guidance/` directory at the repo root (commit them to this branch — they're conversation artifacts; they can be deleted before the actual PR ships).
- Served via `python3 -m http.server` or `npx serve` — whatever's lightest. Give Brandon a clear local URL to open.
- **Mock data:** the 2017 F-350 / P0087 fuel scenario. Use the real component names + real `branch_logic.condition` and `nextAction` strings. Pull them via the Supabase MCP (project `ynmtszuybeenjbigxdyl`) — example query:

  ```sql
  -- Get the components, their test_actions, and the branches, for the
  -- 2017 F-350 / P0087 cache-hit (platform ford-super-duty-4th-gen-67-psd,
  -- symptom p0087-fuel-rail-pressure-too-low).
  ```

  Or use the test-fixture shapes in `tests/unit/topology-*.test.tsx` for structure.

- **Cover at minimum:**
  1. Walk start (parts numbered, first active, panel showing first test).
  2. Mid-walk (some ✓, some ✗, active mid-way, panel with branch options).
  3. A branch tap → routing transition (animated or static-to-static).
  4. Fail terminal (the fix card).
  5. All-passes ending.
  6. Reload-resume welcome.
  7. Mobile (375–414px) variants of the above.

- **Disposable.** Iterate fast; don't optimize them.

## Recommended workflow for the next session

1. **Verify state.** `gh pr view 89` — PR #89 (topology fast-follow) was MERGED 2026-05-22; this branch is cut off the post-merge integration. The fast-follow's fixes (close button, readable zoom, plain-English connection labels, keyboard select) are canon — the mockups should reflect that current shape.
2. **Invoke `superpowers:brainstorming`** to formally resume. Don't restart — shape + scope are locked. The brainstorm continues from the "present design" stage, gated on mockups.
3. **Invoke `superpowers:frontend-design`** to build the mockups. That skill is built for distinctive, polished frontend interfaces — exactly what these need. Don't generate generic AI-looking pages.
4. **Iterate with Brandon.** Give him a local URL (or hosted preview) per round. Each round of feedback → revise. Don't try to nail it in one pass.
5. **Once visuals are agreed on** → revise the 7-section design draft above to match → write the spec at `docs/superpowers/specs/YYYY-MM-DD-topology-guided-walk-design.md` → invoke `superpowers:writing-plans` for the implementation plan → produce a per-PR execution kickoff doc → handoff a fresh session to execute via `superpowers:subagent-driven-development`.

## Constraints / standing memory that matter

- **Non-engineer founder.** Plain English in chat; technical detail in spec/plan artifacts only.
- **Mobile validation required.** 375–414px viewports for any UI that ships; mockups must cover this.
- **No "AI" word in user-facing copy.** The guided walk is a structured product feature; do not frame it as AI.
- **Brainstorm before code; small PRs; never push to main; Brandon merges PRs himself.**
- **Marketing voice rules:** plain shop-floor English, no em-dash drama, no AI pivots — applies to UI copy too.
- **No "ready to continue?" pauses once a plan is approved** — execute end-to-end.
- **After the brainstorm finishes,** update `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/project_orchestration_phase_3_inflight.md` to note the new spec/plan + PR.

## Pointers

- This file: `docs/superpowers/handoffs/2026-05-22-topology-guidance-brainstorm-kickoff.md`
- Research: `docs/superpowers/research/2026-05-22-guided-diagnostics-ux-patterns.md`
- PR-B spec (the topology itself): `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md`
- PR-B fast-follow spec: `docs/superpowers/specs/2026-05-22-topology-pr-b-fast-follow-design.md`
- PR-B fast-follow plan: `docs/superpowers/plans/2026-05-22-topology-pr-b-fast-follow.md`
- PR-B closeout: `docs/superpowers/handoffs/2026-05-22-interactive-topology-pr-b-closeout.md`
- Phase 3 overall kickoff (PR roadmap): `docs/superpowers/handoffs/2026-05-19-orchestration-phase-3-kickoff.md`
- Topology code: `components/topology/`, `components/screens/topology-diagnostic.tsx`
- Topology loader (the `SystemTopology` shape): `lib/diagnostics/load-system-topology.ts`
- Topology unit tests (fixtures + shape examples): `tests/unit/topology-*.test.tsx`
- Live topology data: Supabase project `ynmtszuybeenjbigxdyl` (use the Supabase MCP)
- Grounding session for mock data: `681de115-5de9-474e-9721-263f65066e08` (2017 F-350 / P0087 cache hit, owned by `brandon@vyntechs.com` at Young Motorsports)
- Validation screenshots from PR-B fast-follow (capture the current topology visually): `validation-pr-b-ff-desktop-1440.png`, `validation-pr-b-ff-mobile-390.png`, `validation-pr-b-ff-mobile-390-sheet.png` on branch `fix/topology-pr-b-fast-follow` (or in any local working dir that ran the validation)
