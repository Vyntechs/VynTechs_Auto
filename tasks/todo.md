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
