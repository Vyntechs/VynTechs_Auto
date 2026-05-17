# Root B (DTC) — fresh-session build kickoff

You're picking up the Vyntechs knowledge platform's **Root B (DTC subset)** implementation. Brandon `/clear`ed context between the brainstorm+plan phase and this build phase to keep the build session focused and lightweight.

---

## What's already done (don't redo)

- **Brainstorm:** complete. Product decisions locked (sub-code preservation, hard-reject on garbage, leave existing rows alone, plus the latent hex-body bug fix uncovered during code-reading).
- **Spec:** `docs/superpowers/specs/2026-05-17-knowledge-root-b-dtc-design.md` (committed on this branch)
- **Plan:** `docs/superpowers/plans/2026-05-17-knowledge-root-b-dtc.md` (committed on this branch — **10 tasks, TDD-shaped**, ~200 LOC total + one small migration)
- **Branch:** `feat/knowledge-root-b-dtc-normalize` cut off `origin/staging`, already checked out and pushed.

## What you do

1. Invoke skill `superpowers:executing-plans`.
2. Open the plan at `docs/superpowers/plans/2026-05-17-knowledge-root-b-dtc.md`. Read its **Self-review notes** at the bottom first.
3. Execute the 10 tasks **inline, in sequence**.
4. Per the plan's TDD loop: write failing test → run failing → write code → run passing → commit. **One commit per task.**
5. **Task 2 (migration):** rehearse on local `vyntechs_rehearsal` DB. **Do NOT apply to live Supabase during the build** — the live-DB migration is the LAST step before merge (see plan's "Live-DB migration step (DO BEFORE MERGE)" section).

## Constraints

- **No new dependencies** beyond what the plan calls for (other than `@testing-library/react` if it's not already installed, per plan Task 5 Step 1).
- **Brandon is a non-engineer founder.** Plain-English check-ins at natural breakpoints. No SQL / Drizzle / TypeScript / regex jargon when talking to him.
- **The word "AI" is not in user-facing copy.** Don't reintroduce it in error messages, badges, or labels (carry forward from Root A).
- **Branch base:** `origin/staging`. The PR will target `staging`, not `main`.
- **Brandon merges PRs himself** — don't merge.
- **Live DB migration is its own step.** After the build is otherwise complete and validated, surface the migration plan to Brandon for explicit approval, then apply via Supabase MCP `apply_migration`. Then update the PR body to note it's done. THEN Brandon merges.

## When build is done

1. Run the final verification pass (Task 10) — full typecheck + lint + test suite.
2. Push the branch (already tracking origin).
3. **Surface the live-DB migration step to Brandon** for explicit approval. Apply via Supabase MCP after he approves.
4. Open a PR against `staging` using `gh pr create`. Body should mirror **PR #74's shape** (the Root A PR) — that is, an iOS-readable validation checklist Brandon can run on the Vercel preview, organized by user-facing scenario. Include `## What this does`, `## Why`, `## What you'll see — validation checklist`, `## What's in this PR`, `## Out of scope`, `## Spec`, `## Base`. Reference the spec doc. Note that the live-DB migration was applied.
5. Post one comment on the PR telling Brandon what to walk on the Vercel preview (the 8 scenarios in the spec's "What Brandon walks" section).
6. **Don't push to main. Brandon merges.**

## Don't do

- Don't re-brainstorm. Decisions are locked.
- Don't extend scope. AI prompt updates, one-shot legacy DTC cleanup, vehicle-picker normalization — all explicitly **out of scope** (see plan's "Out of scope" section).
- Don't modify Roots A or C–H. Each has its own session.
- Don't apply the live-DB migration during the build itself; only at the pre-merge step with Brandon's per-op approval.

## Reference

- **Spec:** `docs/superpowers/specs/2026-05-17-knowledge-root-b-dtc-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-17-knowledge-root-b-dtc.md`
- **Parent roadmap:** `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`
- **Root A spec (sibling example):** `docs/superpowers/specs/2026-05-17-knowledge-root-a-source-verify-design.md`
- **PR shape reference (validation-checklist style):** PR #74 on GitHub — `gh pr view 74 --json body`
