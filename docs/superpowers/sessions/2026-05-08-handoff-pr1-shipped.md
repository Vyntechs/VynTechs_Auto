# Handoff — PR1 (counter intake persistence) shipped to production

**Date:** 2026-05-08
**For:** The next Claude Code session that picks up Vyntechs development.
**Reason for handoff:** PR #10 was just merged to `main` and is deploying to production. Brandon is clearing context to start the next task (diagnostic side).

## TL;DR

PR #10 — "feat(intake): counter intake persistence (PR1)" — merged to `main` at **2026-05-08 10:13 AM CDT** as commit `6792e81e`. Production auto-deployed on Vercel. Counter intake persistence + audit fixes + 5-limit on open sessions are now live.

The session that produced this PR was a marathon: original bug → spec → implementation → PR1 manual validation by Brandon → 5 audit fixes from a jargon/dead-end audit → 5-limit change after Brandon hit the 1-open-session constraint → discovery that the feature branch was based on stale `preview-curator` (not `main`) → squash-rebase onto `main` to produce a clean PR → ship.

## Workflow rule established this session (HIGH IMPORTANCE)

**Every new feature must be branched from current `origin/main`, never from `preview-curator` or any other long-lived branch.** This is now a memory rule (`feedback_branch_from_main_for_new_work.md`). The reason: long-lived staging branches drift from main, producing preview URLs that aren't real production-clones. Today's pain (91-commit conflict mess) was 100% caused by branching off stale `preview-curator`.

**Going forward:**
1. `git fetch origin && git checkout main && git pull`
2. `git checkout -b feature/<new-thing>`
3. Push the branch — Vercel preview URL = `main + your work` = production-clone
4. Test there. PR `feature/<new-thing> → main`. Merge. Done.

`preview-curator` is **deprecated for new feature work.** It will continue to exist for now but should not be used as a base.

## What shipped in PR #10

- **Migration 0012:** customers + vehicles tables + sessions.vehicle_id link (already applied to live Supabase 2026-05-07)
- **/api/intake/submit** route handler with corpus retrieval + tree generation (fixes the original "Building your diagnostic plan..." hang)
- **5-limit** on open sessions per tech (replaces 1-at-a-time constraint, matches real shop reality)
- **Plain-English audit pass** (5 small UX changes):
  - TreeGenerating screen now has a `← My Jobs` back link (was dead-end)
  - Outcome page back-arrow goes to diagnosis (was /today)
  - Decline-or-defer page back-arrow goes to diagnosis (was /today)
  - "Building your diagnostic plan." → "Putting together your steps."
  - "How did it hold?" → "Did the fix hold up?"
- **Counter intake form** at `/intake` (full customer + vehicle + complaint) — visible to admin role only
- **+ New work order** button on My Jobs (admin role)
- **Comprehensive test coverage:** 484/484 green, including new regression guards for the Building hang, 7 audit-fix lock-ins, and 4 cap-boundary tests for the 5-limit

## Branch state

- `main`: `6792e81e` (PR #10 merged via squash). **This is production.**
- `feature/counter-intake-persistence`: deleted on origin via `--delete-branch` flag at merge. Local copy may persist (harmless).
- `preview-curator`: deprecated for new feature work. Has 6 local-only commits (specs/plans/handoffs from this session); `2026-05-08-handoff-pr1-validation-pending.md` is now obsolete (PR1 shipped). The 3 kickoff docs are preserved in this PR.
- `backup/feature-pre-rebase` (local-only): safety net at `15396ae` (the 91-commit pre-rebase tip). **Can be deleted; no longer needed.**

## What this PR adds

Just three deferred kickoff docs that were committed locally on `preview-curator` during this session and need to be reachable from `main` for future sessions. Plus this handoff.

- `docs/superpowers/kickoffs/2026-05-07-diagnostic-research-first.md` — Research-first phase for the diagnostic AI engine. **This is the kickoff Brandon's pointing the next session at.**
- `docs/superpowers/kickoffs/2026-05-08-permission-alignment.md` — Owner sees other techs' sessions in the list, gets 404 on click. List/detail permission contract violation.
- `docs/superpowers/kickoffs/2026-05-08-abandon-ui.md` — `/api/sessions/[id]/abandon` exists but no UI surfaces it. Stuck/orphan sessions can't be closed.

## Things still open / loose ends

These don't block anything; the next session can address as needed:

- **Stale worktree:** `.worktrees/testing-pipeline` is using `main` and was blocking `gh pr merge`'s local cleanup. Run `git worktree remove .worktrees/testing-pipeline` to clean up if it's no longer needed.
- **Stash @ {0}:** A `.gitignore` change adding `.superpowers/` exclusion for the brainstorming companion. Apply if continuing brainstorm work, drop if not.
- **`preview-curator`'s 6 local-only commits:** Most are now obsolete (PR1 spec/plan/handoff are in PR #10's shipped content). Decide whether to push, fold, or discard.
- **Local `backup/feature-pre-rebase` branch:** Safety net for the 91-commit pre-rebase tip. PR1 shipped; backup can be deleted. (`git branch -D backup/feature-pre-rebase`.)
- **Old broken sessions in DB:** F250 (`1ee26bcd`) was temporarily deferred during validation, then restored to `open` at end of session. Two earlier broken rows (F150 `d429e8ce`, Dodge `f513d7d2`) are status='deferred' from cleanup. None of these block anything.

## Memory rules saved this session (durable across all future sessions)

In addition to `feedback_branch_from_main_for_new_work.md`:

- `feedback_minimal_role_models.md` — default role lineup is `tech` + `admin (= Brandon)` only. No service-writer / manager / dispatcher hierarchies unless asked.
- `feedback_subagent_model_choice.md` — Opus for internal codebase analysis (jargon audits, code review, nav graphs); Haiku reserved for cheap web research only.
- `project_intake_paths_kept_split.md` — `+ New diagnosis` and `+ New work order` stay as two paths. Brainstormed and parked 2026-05-08; don't reopen without user trigger.

## Brandon's signaled next task

**The diagnostic side.** He hasn't named the specific kickoff yet but explicitly mentioned wanting to work on diagnostics. The most relevant kickoff doc is `docs/superpowers/kickoffs/2026-05-07-diagnostic-research-first.md` (added in this PR) — research-first phase for the AI to surface TSBs and known failure modes upfront, before walking the tech down a doomed repair path. The kickoff includes a verbatim quote from Brandon explaining why this matters and a real evidence-trail from a 2004 Camry session that cost ~$1,500 in customer repairs because the AI surfaced the relevant TSB AFTER the wasted work.

## Things you must NOT do without Brandon's explicit go

- Push `preview-curator` to origin
- Merge any PR (this docs PR included; it's small but his click)
- Force-push anywhere
- Apply schema migrations (none needed for the diagnostic kickoff afaik; verify by reading the kickoff)
- Touch the F250 (`1ee26bcd`) — that's Brandon's real diagnostic work in progress
- Delete worktrees (the testing-pipeline one might still be useful to him)

## Suggested first actions for the next session

1. **Read MEMORY.md fully.** It's longer than it was; the new rules matter, especially `feedback_branch_from_main_for_new_work.md`.
2. **Read this handoff.**
3. **Verify production is live with PR1:** visit prod URL → click `+ New work order` → confirm a real intake works end-to-end. (Brandon already verified before clearing context but a sanity check after fresh load is cheap insurance.)
4. **Branch correctly per the new rule:** `git fetch origin && git checkout main && git pull && git checkout -b feature/<diagnostic-thing>`. Confirm the SHA matches production.
5. **Read the diagnostic kickoff** (`docs/superpowers/kickoffs/2026-05-07-diagnostic-research-first.md`) to ground the next conversation with Brandon.
6. **Wait for Brandon's specific framing** before brainstorming. He'll point at the kickoff or describe what he wants. Don't pre-brainstorm.

## Quick numbers (so the next session has a feel)

- PR #10 final shape: 52 files changed, +3,235 / -681 lines (clean PR1-only delta).
- Tests at merge: 484/484 green. Type-clean.
- Total session length: ~9 hours of conversation, multiple validation+brainstorm+rebase cycles.
- Memory file count: now 19 entries in MEMORY.md (was 17 at session start).

That's it. Production is live, the rule is clear, the next task is queued. Brandon's free.
