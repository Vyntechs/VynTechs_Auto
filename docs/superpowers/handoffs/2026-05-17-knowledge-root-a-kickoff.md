# Root A — fresh-session kickoff

You're picking up the Vyntechs knowledge platform's **Root A** implementation. Brandon `/clear`ed context between the brainstorm+plan phase and this build phase to keep the build session focused and lightweight.

---

## What's already done (don't redo)

- **Brainstorm:** complete. Product decisions locked.
- **Spec:** `docs/superpowers/specs/2026-05-17-knowledge-root-a-source-verify-design.md` (committed on this branch)
- **Plan:** `docs/superpowers/plans/2026-05-17-knowledge-root-a-source-verify.md` (committed on this branch — **9 tasks, TDD-shaped**, ~150 LOC total)
- **Branch:** `feat/knowledge-root-a-source-verify` cut off `origin/staging`, already checked out and pushed.

## What you do

1. Invoke skill `superpowers:executing-plans`.
2. Open the plan at `docs/superpowers/plans/2026-05-17-knowledge-root-a-source-verify.md`. Read its **Self-review notes** at the bottom first.
3. Execute the 9 tasks **inline, in sequence**.
4. Per the plan's TDD loop: write failing test → run failing → write code → run passing → commit. **One commit per task.**

## Constraints

- **No new dependencies** beyond what the plan calls for. No SDK swaps, no new model providers, no new libraries.
- **Brandon is a non-engineer founder.** Plain-English check-ins at natural breakpoints. No SQL / Drizzle / TypeScript jargon when talking to him.
- **The word "AI" is being eliminated from user-facing copy.** Don't reintroduce it in badges, labels, error messages, or page titles.
- **Branch base:** `origin/staging`. The PR will target `staging`, not `main`.
- **Brandon merges PRs himself** — don't merge.
- **No prod ops.** This PR has no DB migrations. Don't run any migration commands.

## When build is done

1. Run the final verification pass (Task 9) — full typecheck + lint + test suite.
2. Push the branch (already tracking origin).
3. Open a PR against `staging` using `gh pr create`. The body should mirror **PR #72's shape** — that is, an iOS-readable validation checklist Brandon can run on the Vercel preview, organized by user-facing scenario (happy path, sparse-source, sparse-paste, mobile). Include `## What this does`, `## Why`, `## What you'll see — validation checklist`, `## What's in this PR`, `## Out of scope`, `## Spec`, `## Base`. Reference the spec doc.
4. Post one comment on the PR telling Brandon either:
   - "Just merge — backend-only changes covered by unit tests" (if all manual walkthroughs are non-essential), OR
   - "Walk steps X, Y, Z on the preview first" (if there's UI-facing behavior that unit tests can't prove)
5. **Don't push to main. Brandon merges.**

## Don't do

- Don't re-brainstorm. Decisions are locked.
- Don't extend scope. Layer 1 (templated regex), vehicle scope receipts, per-item receipts, etc. are explicitly **out of scope** (see the plan's "Out of scope" section).
- Don't modify Roots B–H. Each has its own session.
- Don't apply migrations to live Supabase — there aren't any in this PR.

## Reference

- **Spec:** `docs/superpowers/specs/2026-05-17-knowledge-root-a-source-verify-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-17-knowledge-root-a-source-verify.md`
- **Parent roadmap:** `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`
- **PR shape reference (validation checklist style):** PR #72 on GitHub — `gh pr view 72 --json body`
