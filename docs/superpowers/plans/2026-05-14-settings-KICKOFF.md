# KICKOFF — Settings page PRs (use this verbatim each fresh session)

Brandon: between PRs you `/clear` and start a fresh session. Open this file, copy the **PROMPT TO PASTE** block below, swap in the PR number/name in the file path, paste it as your first message.

---

## PROMPT TO PASTE

```
We're starting PR <N> of the Settings page feature.

Read these two files first (both already exist on settings-wip and settings-page branches):
1. docs/superpowers/plans/2026-05-14-settings-pr<N>-<name>.md   ← this PR's plan
2. docs/superpowers/specs/2026-05-14-settings-page-design.md    ← overall spec

Setup before doing anything:
- git fetch origin
- git checkout settings-wip
- git pull origin settings-wip --ff-only
  (if working tree is dirty, git status first and sort it out before pulling)

The plan is a SCOPE CONTRACT, not a typewriter script. Do your own exploratory work in the codebase first — read existing patterns and components, understand how similar things are built — then execute.

Branch rules:
- ALL commits land on settings-wip. Push to origin when done so I can validate via the Vercel preview URL.
- I merge settings-wip → settings-page via GitHub UI after my validation. You do NOT merge.
- Never push or merge to main.

Mobile validation is REQUIRED before claiming done — test 375px, 768px, and 1024+ explicitly. Per my memory feedback_mobile_validation, /curator shipped broken on mobile because that step was skipped — don't repeat it.

If you find a gap, inconsistency, or surprise in the plan or spec, FLAG IT — push back, don't paper over. Use brainstorming if the problem is non-trivial.

When done: confirm everything works on the preview URL, then tell me to validate. Don't merge anything.
```

---

## File paths to swap in (replace `<N>-<name>` in the path above)

| PR | Replacement | Scope summary |
|---|---|---|
| 1 | `settings-pr1-app-header` | AppHeader hamburger menu + shop name display |
| 2 | `settings-pr2-skeleton` | `/settings` list page + responsive layout + redirect from old `/billing` |
| 3 | `settings-pr3-billing` | Move existing BillingClient under `/settings/billing` (smallest PR) |
| 4 | `settings-pr4-account` | Display name editor + Reset Password button + signup-form fullName + reset-password page |
| 5 | `settings-pr5-shop` | Rename shop + AppHeader updates live with new name |
| 6 | `settings-pr6-team` | Team list + invite-by-email + role change + deactivate + canCurate tighten + live DB migration (BIGGEST, RISKIEST) |

---

## Order matters

1 → 2 → 3 → 4 → 5 → 6. Don't skip ahead.

- PR 2 needs PR 1 (the hamburger menu links to `/settings` which doesn't exist until PR 2)
- PR 3 needs PR 2 (the placeholder it replaces only exists after PR 2)
- PR 4-6 each replace placeholder pages from PR 2

---

## Cycle each iteration

1. `/clear`
2. Paste the prompt above (with the right PR number swapped in)
3. Fresh session does exploratory + executes + pushes to `settings-wip`
4. You validate on the Vercel preview URL for the `settings-wip` branch
5. If broken: tell the session what failed (it can fix in same session, or you can `/clear` and restart)
6. If good: you merge `settings-wip` → `settings-page` via GitHub UI
7. Repeat for next PR

After all 6 are merged into `settings-page` and you've validated the combined state on the `settings-page` Vercel preview: merge `settings-page` → `main` via GitHub UI. Settings ships.
