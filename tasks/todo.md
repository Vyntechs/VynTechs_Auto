# Curator console — visual + UX pass

Branch: `feat/curator-console-design` (from `origin/staging-curator`) → PR back into `staging-curator`.
Handoff: docs/superpowers/handoffs/2026-05-31-curator-console-design-handoff.md (main worktree, uncommitted).
Re-plans: 0/3

## Direction (decided)
- Console was raw because it **bypassed an existing curator-grade kit** (`components/vt/desktop/` + `v2.css`/`v2-instruments.css`). Primary move = wire screens onto that kit + a few net-new primitives. NOT a from-scratch look.
- Every screen gets a self-explaining header (eyebrow + serif title + italic what/why subtitle).
- Tree = master step-LIST + detail panel (NOT a drag-canvas — breaks on mobile, reads as "circuits"). Mobile = drill-down.
- Brand settles on one word: **"Curator"**.

## Scope decisions (Brandon, 2026-05-31)
- **Editor = look + clarity ONLY.** Do NOT add: add-procedure, delete-step, set-start, type-toggle, autosave, editors for currently-uneditable fields (expectedSignal/confidence). Flag as fast-follow.
- **Conflicts = full arbitration.** Named two sides + quotes; keep-A / keep-B / keep-both-with-note; **block publish on unresolved**. (The one approved new capability.)
- Legacy screens: shell coherence + kill worst jargon (raw-JSON textareas, `Max similarity 0.42`, stepId leaks). Not a full redesign.

## Net-new primitives needed
1. Lifecycle status dot (draft=amber / published=signal-navy / changed) — from real `currentVersionState`.
2. Branching step-list row (start marker, question/procedure type, answer→branch / answer→finding summaries, orphan warning, citation count, conflict dot).
3. Evidence/citation card (title, source, fetchedAt, real excerpt, evidence grade as worded label).
4. Conflict-arbitration card (two named sides + quotes + keep-A/B/both + note).
5. Finding/verdict card (verdict + action + severity glyph + expectedSignal/confidence display).
6. List-row primitive (dot + title + subtitle + meta + action; stacks on mobile) — replaces bespoke tables.
7. Per-agent multi-track progress rows (real polled status + activity line + "X of N complete" + elapsed).

## Build checklist
- [x] Read kit API (index.tsx) + v2.css + v2-instruments.css
- [x] Shell: nav grouping (triage vs library), MainHeader, brand "Curator", mobile drawer (new CuratorShell)
- [x] Flows list: kit rows + status pills + self-explaining header + guided empty/create (real lifecycle status via fixed query)
- [x] Flow detail: no stepId leaks, finding action/severity, clean body summary, surface conflicts, kraft change note, back link, plain CTAs, draft-aware
- [x] New-flow form: distinct "Research this case first" vs "Write it myself" choice cards + honest ~3–6 min; reuse callout; duplicate-pair pre-submit guard
- [x] Research progress: named per-worker tracks (real status), activity line, X-of-N, real elapsed, static range, fixed error dead-end (link to editor), no-run state
- [x] Flow editor: kit two-pane, step LIST (no react-arborist, no stepId leaks), labeled branch-vs-finding ("Go to: title" / "End the diagnosis here"), plain finding fields, evidence cards w/ worded grade, styled publish bar, plain-English publish issues, mobile drill-down
- [x] Conflict arbitration (approved new capability): named sides + quotes + keep-A/B/both+note; publish-block in flow-validation
- [x] Legacy: shell coherence (all 7 in new grouped shell) + restored padding (one rule); FULL legacy polish deferred (see fast-follows)
- [x] Validate every priority screen desktop (1440) + mobile (390) in-browser
- [ ] Checkpoint Brandon (final before/after) → PR into staging-curator

## Review (2026-05-31)
- Root finding: console was raw because it bypassed an existing curator-grade kit. Primary work = wire screens onto kit + ~7 net-new primitives (status pill, step-list row, evidence card, conflict-arbitration card, finding presentation, list row, per-agent progress tracks).
- Verification: `tsc --noEmit` clean; full unit suite **1016 passed / 139 files** (incl. new conflict publish-block test); every priority screen screenshotted desktop + mobile and judged as a user.
- Data model: added optional `note?` to QuestionStep (symmetric w/ ProcedureStep) — the home for "keep both with a condition note". Additive, non-breaking (jsonb), forward-compatible.

## Flagged fast-follows (NOT in this pass)
- Editor capability (Brandon: clarity-only): add-procedure-step, delete-step, set-start-step, question↔procedure toggle, editors for `expectedSignal`/`confidence`, autosave + unsaved-tab guard.
- Legacy content polish: MainHeaders + table→list-row restyle for the 7 review screens; kill raw-JSON textareas (corpus/founder-note forms) + `Max similarity 0.42` / treeState `<pre>` jargon.
- Research progress live view validated by logic only (no paid run triggered) — the no-run + error states are screenshotted; the live polling view uses the same real fields.

Skipped/Failed:
- Did NOT run a local `next build` (relied on tsc + 1016 tests + dev-compiled curator routes; the production build runs on the Vercel preview deploy).
- Live research-progress polling UI not screenshotted with a real run (would cost a real ~$2–3 run, Brandon-gated). Validated via code + no-run/error states.
- Full legacy content polish intentionally deferred (handoff scoped legacy as lower-urgency).

---

# Validate the rebuilt diagnostic diagram — operate & diagnose walkthrough

Branch: `feat/system-data-ingest` · Worktree: `.claude/worktrees/system-data-ingest`
Created: 2026-06-14 · Status: **NOT STARTED — awaiting Brandon approval**
Companion handoff: `docs/superpowers/handoffs/2026-06-07-diagnostic-diagram-HANDOFF.md`
Nature: **read-only validation. NOT a merge gate. NOT a fix pass.**

## Goal
Brandon has seen the rebuilt diagram walk the seeded fault cases end-to-end on `/curator/topology` and holds an honest, evidence-backed list of what diagnoses as intended vs. what's still broken/incomplete — so we know what development actually remains.

## Scope
- In play: `/curator/topology` only — the assembled diagram, the Meter, step sequence/fork routing, tap-to-inspect, the mobile tap-to-toggle sheet, the whole-system view.
- Cases: P0087 (fuel-rail-pressure too low), P0088 (too high), no-start-cranks-normally, plus a no-DTC case.
- Viewports: desktop-1440 and mobile-375.
- Run from the worktree above (branch `feat/system-data-ingest`).

## Out of scope (do NOT touch)
- **No `main`. No PR. No merge anything.**
- **No fixes.** Do not modify diagnostic logic, the part kit, templates, or any code to "fix" what you find — only document it; Brandon decides fixes.
- Nothing outside the topology diagram — leave the curator wizard, the system-data-ingest PRs (PR0–PR3), and curator-console work alone.
- Do not trigger any paid research/AI run.

## Steps (each independently verifiable)
1. **App up + curator auth.** Start the dev server in the worktree (`npm run dev`). Log in as `e2e@vyntechs.com` (password in `.env.local`); if login drifts, reset via the service-role admin (drift is the password, not email-confirm). → Verifiable: `/curator/topology` loads as a curator (no 403).
2. **Browser harness.** Playwright MCP is broken on this machine — drive a Node `@playwright/test` script with `executablePath` = the bundled `ms-playwright` chromium build. → Verifiable: the script produces a screenshot of `/curator/topology`.
3. **Per-case step-through (the core).** For P0087-low, P0088-high, and no-start-cranks, walk the guided flow step by step. At EACH step verify intent, not just render: (a) the diagram shows ONLY what that step tests — no leaked 12V/GND on a pressure step; (b) the Meter reads the right EXPECT / NOW / VERDICT; (c) forks route to the correct next step; (d) tap-to-inspect works; (e) the walk lands on the correct root cause. → Verifiable: a labeled screenshot sequence per case + a per-step pass/gap note.
4. **Mobile + edge views.** Repeat the walk at mobile-375 (confirm the Meter tap-to-toggle sheet peeks/expands correctly), and exercise the whole-system view and the no-DTC case. → Verifiable: mobile screenshots + whole-system + no-DTC shots.
5. **Judge against the quality bar across the spread** (not one case): right answer + knows-this-vehicle + honest/calibrated + sound method + no-DTC robustness. → Verifiable: a scored line per case.
6. **Honest report.** Per case: what diagnoses as intended vs. what's wrong/incomplete, with screenshots; then a consolidated "remaining development" list. Do not fix anything. → Verifiable: the report exists with an explicit pass/gap line per case + a remaining-dev list.

## Verify by
A written report + step-by-step screenshot set covering each case on `/curator/topology`, with an explicit **pass/gap line per case** and a **"remaining development" list** at the end. If the app won't run locally or a case won't load, that is stated loudly — not papered over.

⚙️ `/effort high` — runs the app, drives a browser, reasons about the diagnostic engine across multiple cases.
🤖 Model: `claude-opus-4-8` — judging whether each step diagnoses correctly is a judgment call, not a mechanical check.

---

# Design the finish — close the interactive-diagnostic gaps (DESIGN ONLY, no code)

Branch: `feat/system-data-ingest` · Worktree: `.claude/worktrees/system-data-ingest`
Created: 2026-06-14 · Status: **NOT STARTED — awaiting Brandon approval**
Input: `docs/superpowers/research/2026-06-14-interactive-diagnostic-state-map.md` (9 gaps, data-model verdict, 7 open questions)
Vision: `[[interactive-diagnostic-vision]]` (memory) — topology becomes the user diagnostic; build-as-needed, reuse, self-connecting, gap-closing graph.
Nature: **design + plan only. NO production code.**

## Goal
A vetted design doc + phased build plan exists that closes all 9 gaps between today's interactive diagnostic and the build-as-needed / reuse / self-connecting-graph intent — each gap solved with the simplest elegant approach (not over- or under-engineered) — with the few real product decisions surfaced for Brandon's sign-off, and zero production code written.

## Scope
- Read-only over the worktree (branch `feat/system-data-ingest`).
- Inputs: the state map above — its 9 capability gaps, the data-model verdict, the 7 open design questions.
- Deliverable: a design doc + phased plan written under `docs/superpowers/`.
- **Full toolkit allowed:** ultracode Workflow (candidate → judge → synthesize → adversarial), Explore subagents, Supabase MCP (READ-only) for the live-DB row check.

## Out of scope (do NOT)
- No feature / production code — **design only**.
- Don't touch `main`, the curator's existing working flows, the live AI-tree/wizard user path, or any DB **data** (reads only).
- Don't propose ripping out working pieces unless clearly justified.
- No new dependencies unless one is genuinely the simplest elegant option (justify it).

## Steps (each independently verifiable)
1. **Re-ground on facts.** Confirm the 3 "still assumption" items from the state map: test status (already green — 1375 tests / 176 files), live-DB row counts for platform `ford-super-duty-4th-gen-67-psd` (Supabase read), and a verdict on whether "topology takes over at intake" is a routing change vs a diagnose→lock→repair lifecycle rebuild (from reading `slot-resolver`, `topology-layout`, `routeForSession`). → Verifiable: those 3 facts appear in the doc with evidence.
2. **Solve each gap (all 9).** 2–3 candidate approaches each, judged on simplest + elegant + fewest-future-problems + schema-fit; pick one with reason + name the runner-up. → Verifiable: 9 gap sections, each with chosen + runner-up + why.
3. **Answer each open question (all 7).** A recommended answer each; flag the ones that genuinely need Brandon's decision. → Verifiable: 7 answers, decisions marked.
4. **One coherent target architecture.** entry → reuse-or-build decision → build-on-demand → render → compounding/gap-fill graph; plus the minimal data-model delta; naming the existing code reused. → Verifiable: an architecture section + a data-model-delta list.
5. **Phased build order.** Smallest valuable slice first, each independently shippable + verifiable, with size/risk per phase. → Verifiable: an ordered phase list with size/risk.
6. **Adversarial review of the design.** Hunt over-engineering, under-engineering (problems we'd create), hidden coupling; check against the honesty/no-DTC + scalability bars. → Verifiable: a "design red-team" section listing what was challenged and how it resolved.
7. **Write the doc** to `docs/superpowers/` with a **"Decisions Brandon must make"** list at the very top. → Verifiable: the file exists; that list is first.

## Verify by
A design doc under `docs/superpowers/` that: solves all 9 gaps (chosen + runner-up + why), answers all 7 open questions (decisions flagged), gives one architecture + data-model delta, a phased build order, and a top "Decisions Brandon must make" list. Spot-check: every chosen approach names the specific file/table it touches and why it's the simplest elegant fit. And: `git diff` shows **only the new doc** — no code files changed.

⚙️ `/effort xhigh` — vyntechs architecture; this design drives a large multi-system build.
🤖 Model: `claude-opus-4-8` — every choice is a simplest-vs-elegant-vs-future-proof judgment call.
