# Kickoff — Testing Pipeline (PR #5) Rescue or Redo

**For:** A parallel Claude Code session in this same project directory.
**From:** A separate session that just shipped 5 PRs (#3, #4, #6, #7, #8) to main and decided to defer PR #5.
**Brandon's framing (verbatim):** *"Don't tell it how to do it. Just tell it what needs to be done. Let the other session do the work."*

So: this doc tells you the WHAT and WHY. You do the brainstorming, planning, and execution.

## What needs to happen

Get a meaningful CI safety net running on every future PR. "Meaningful" = catches mechanical failures (typecheck, unit tests, build, basic dependency audit, secret scanning) before merge — without requiring Brandon to be the human checklist.

## Why it matters

Brandon is a non-engineer founder shipping small PRs to `vyntechs/main` solo. His validation focus is on product behavior (does the feature work, is the UX right). CI handles the mechanical failures he shouldn't have to babysit:

- type errors, broken unit tests, build failures
- accidentally-committed secrets
- known-vulnerable dependency versions

Without CI, those slip into main and surface as Vercel build failures or runtime bugs that cost Brandon validation cycles.

## Current state of PR #5

- **Branch:** `feature/testing-pipeline` (long-lived)
- **PR URL:** `https://github.com/Vyntechs/VynTechs_Auto/pull/5`
- **Status as of session-end:** branch is **behind main by ~12 commits**, has **13 merge conflicts** across 4 files (`lib/sessions.ts`, `playwright.config.ts`, `tests/e2e/curator.spec.ts`, `tests/e2e/global-setup.ts`)
- **Why it diverged:** PR #5 was cut before PRs #3, #6, #7, #8 merged. The conflicts are mostly because PR #3 added its own `tests/e2e/curator.spec.ts` independently from PR #5's version. Most of the "new" files in PR #5's diff against main are stale duplicates of curator code that's already on main.
- **Truly new content on PR #5 (not yet on main):**
  - `.github/workflows/ci.yml` (the workflow itself)
  - `scripts/test-all.sh`, `scripts/test-audit.sh`, `scripts/smoke-prod.mjs`, `scripts/lighthouse-check.mjs`
  - `playwright.config.ts` modifications (e2e harness)
  - `tests/e2e/global-setup.ts` modifications (auth setup)
  - `package.json` script entries (`test:audit`, `test:smoke`, `test:perf`, `test:all`)
  - `docs/testing/manual-checklist.md` and related docs
  - Some `tests/e2e/*.spec.ts` files that may or may not be new vs main
- **CI history on the branch:** every CI run so far has failed. We fixed two issues (chmod on shell scripts, global-setup early-exit when curator creds are absent) but a fresh CI run hasn't been triggered after merging in main. GitHub Actions secrets `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` are already set at the repo level (Stripe-related secrets are intentionally not set; CI tolerates empty Stripe vars).

## Constraints (these matter — read carefully)

1. **Brandon is non-engineer.** Plain English in every walkthrough. No SQL, no Drizzle, no git jargon. Reserve technical lingo for code + commit messages + spec docs.
2. **Plan-first, brainstorm-first.** Use `superpowers:brainstorming` to align with Brandon, then `superpowers:writing-plans` to break it down, then `superpowers:subagent-driven-development` or inline TDD to execute. Don't skip the design step even if "it's obvious."
3. **Tight scope.** Brandon explicitly does NOT want a "rewrite everything from scratch" job. Recover what's salvageable from `feature/testing-pipeline`. Trash what's stale. Don't expand into related work (refactoring, advisor findings, etc.).
4. **Small PRs.** Marathon, not sprint. If the testing pipeline is too much for one PR, split it (e.g., PR for the workflow + audit, separate PR for e2e harness, separate PR for smoke/perf scripts).
5. **Don't merge if CI is red on the PR itself.** The whole point is CI gating; merging a broken pipeline defeats it.
6. **Memory:** read `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/MEMORY.md` first. Brandon has documented preferences (plain English, brevity, marathon mindset, validation rigor, etc.) that apply to your work.

## What you should figure out (during brainstorming)

These are open questions for you to work through with Brandon — not predetermined answers:

- **Salvage vs rebuild.** Does it make more sense to merge main into the existing branch and resolve 13 conflicts, or to start a fresh branch off current main and cherry-pick just the new files? (Hint: the file-level diff in `git diff --stat origin/main...feature/testing-pipeline` shows ~80 files but most are stale curator duplicates.)
- **Scope of the first PR.** What's the minimum-viable CI that catches the most failures with the least integration pain? Examples: just typecheck + unit might be the right first PR, with build/e2e/audit as follow-ups.
- **e2e in CI vs local-only.** PR #5 had `--project=anonymous` running in CI and `--project=curator` only running locally. Is that the right split? Or is there a cleaner way (e.g., e2e on Vercel preview against the deployed URL, not in GitHub Actions at all)?
- **Required vs optional checks.** Should any of these be marked "required" in GitHub branch protection (blocking merge), or all optional (advisory)? Brandon hasn't asked for branch protection — he validates manually — but flagging this is worth doing.
- **Whether to close PR #5.** Once you have a plan, the existing PR may be obsolete. Decide whether to close + redo or rebase + recover.

## Resources

- **PR #5:** https://github.com/Vyntechs/VynTechs_Auto/pull/5
- **The branch's existing plan/spec docs** (older — may be partially stale):
  - `docs/superpowers/plans/2026-05-07-testing-pipeline-implementation.md` (if it exists on the branch)
  - `docs/superpowers/sessions/2026-05-07-handoff-testing-pipeline.md` (autonomous overnight handoff for the original work)
- **What just shipped on main (your context for "current main"):** PRs #3 (Phase P curator), #4 (intake fix), #6 (two-phase repair), #7 (validator override), #8 (closed-case summary). All merged 2026-05-07 evening.
- **GitHub Actions secrets already set:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `BACKUP_DATABASE_URL`. Verify with `gh secret list`.
- **Local credentials:** `.env.local` in this worktree has the working values for any secret you'd need to add (per Brandon's memory: same Supabase project across diagnostic + shop).

## Suggested first move

Don't start coding. Don't even start `git rebase`. Start by:

1. Reading `MEMORY.md` (linked above) so you have Brandon's preferences fresh.
2. Skimming this doc and confirming you understand the WHY.
3. Invoking `superpowers:brainstorming` with Brandon to align on:
   - The salvage-vs-rebuild question
   - The scope of the first PR
   - Anything you're unsure about

When the brainstorm produces a spec, the next move is `superpowers:writing-plans`. Then execution.

You're not bringing this PR home in one shot. Brandon expects multiple small follow-up PRs. Make peace with that up front.

## Final note

Brandon may not be available the moment you start. If he's offline, do the project-context exploration (read this doc, read recent commits, read existing plans on the branch) and wait. Don't proceed past Phase 1 of brainstorming without his input — he's the one who'll validate.
