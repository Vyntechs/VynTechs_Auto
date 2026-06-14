# HANDOFF — interactive diagnostic (state + plan)

**Date:** 2026-06-14 · **Branch:** `feat/system-data-ingest` · **Worktree:** `.claude/worktrees/system-data-ingest`
This session was investigation + planning, NOT a build. No production code changed beyond the earlier UI polish.

## Where we are
- The interactive **topology diagram renderer is built and works** (the T1–T7 rebuild; renders real data for one seeded Ford 6.7L truck in the curator-only preview).
- The **system Brandon actually wants** — topology becomes THE user diagnostic at intake, reuse-if-built, build-on-demand-if-missing, branches that self-connect across concerns and fill gaps over time — is **mostly NOT wired yet.** See the full evidence-backed map.
- **Source of truth for state:** `docs/superpowers/research/2026-06-14-interactive-diagnostic-state-map.md` (9 capability gaps, data-model verdict, 7 open questions).
- **Source of truth for intent:** memory `interactive-diagnostic-vision` (topology = user diagnostic; curator is back-office; build-as-needed self-connecting graph).

## Immediate next step (exact first action)
A design brief is **queued and awaiting Brandon's "go"** in `tasks/todo.md` → block **"Design the finish — close the interactive-diagnostic gaps (DESIGN ONLY, no code)."**
- First action for a fresh agent: read that todo block + the state map, then (on Brandon's go) run it as an ultracode workflow — per gap: float 2–3 options → judge simplest/elegant/fewest-future-problems → pick + runner-up → assemble one architecture + phased build order → adversarial red-team. Output = a design doc under `docs/superpowers/` + a "Decisions Brandon must make" list. **No production code.**
- It must also settle 3 facts first: live-DB row counts for `ford-super-duty-4th-gen-67-psd` (Supabase read), and read `slot-resolver` / `topology-layout` / `routeForSession` to size whether intake-takeover is a routing change or a diagnose→lock→repair lifecycle rebuild (days vs months).

## What shipped this session (verified)
- `c08afe8` — full-window "fullbleed canvas" UI polish + 15 QA screenshots (the only code change; full suite green at the time: 1375 tests / 176 files).
- `07f5134`, `0a4e45b` — corrected + reframed the diagram-rebuild handoff (built ≠ validated; dropped premature main/merge focus).
- This session's planning artifacts (committed alongside this handoff): the state-map research doc, `tasks/lessons.md` (3 new lessons), and two queued briefs in `tasks/todo.md`.
- Memory written: `interactive-diagnostic-vision` (project), `keep-answers-short-plain` (feedback).

## Pending (NOT done)
- **Design-the-finish task** — queued, not started (awaiting "go").
- **Validation walk** — an earlier queued brief in `tasks/todo.md` (hands-on diagnosing of the seeded truck); not started.
- **The actual build** — not started (the design pass produces its plan).

## Hard constraints / only-Brandon
- **Not on main; ~110+ commits ahead.** No merge / deploy / migration without Brandon's explicit verify-everything gate.
- The design pass returns **recommendations + decisions for Brandon** (where takeover happens, who approves auto-built diagnostics, replace-vs-coexist with the wizard, cross-system v1 scope, seed repopulation, canonical intake path). It must not silently decide product direction.
- **Keep answers short + plain in chat; depth goes in docs** (memory `keep-answers-short-plain`).
- The one truck's data lives only in the live DB (seed was reverted from the repo) — a DB reset empties the preview.

## Resume prompt
```
Read HANDOFF.md in full and tell me where we left off.
```
