# Vyntechs MVP — Handoff (2026-05-04, plan-tree shipped on a branch + cross-feature gap list + tier-2 workflow)

Companion to `2026-05-04-handoff-phase-r-shipped.md` (still authoritative for the check-back branch's pre-validation state). Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/phase-o-counter-02-03` — current worktree for plan-tree work. (Note: this is `.claude/worktrees/`, not `.worktrees/` — EnterWorktree tool default. Branch and behaviour are unaffected by the path.)
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` (UI work upcoming).
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **336/336** tests, tsc clean, build clean.
4. Plan-tree feature on `feature/phase-o-counter-02-03` at head `952777a` + CSS fix `6efac97`. Validation revealed gap list (below). **Fixes not yet applied.**
5. Check-back feature on `feature/phase-r-comeback` unchanged from its handoff (head `4d5734c`). Validation revealed gap list (below). **Fixes not yet applied.**

## State

- Production at `vyntechs.dev` is unchanged on `main` (head `d7747d7`). Brandon's tech still using.
- Staging aliases: `staging-vyntechs.vercel.app` → check-back branch (existing), `staging-plantree.vercel.app` → plan-tree branch (new this session).
- Vercel env: `DATABASE_URL` widened to all preview branches (was branch-pinned). `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true` added to Preview scope. **`CRON_SECRET` still missing on both Preview and Production scopes** (check-back cron will silently 401 without it).
- `follow_ups` table in live Supabase (already there before this session — confirmed via MCP `list_tables`).
- Fresh design bundle re-fetched + unpacked at `tmp/design-handoff-2026-05-04/` in this worktree (gitignored). Source URL: `https://api.anthropic.com/v1/design/h/aj0cQjYROAQsepOS19lKtw` — works as of 2026-05-04, expires unknown.

## What this session covered

- **Plan-tree feature shipped on a branch** (Counter 02 + Counter 03 + reusable `<PlanTree>`). 336/336 tests, tsc + build clean. Deployed to `staging-plantree.vercel.app`.
- **Discovered v2.css + v2-instruments.css were never globally imported** — only loaded incidentally when a route imported from `@/components/vt` (the index). Added imports to `app/layout.tsx`. **This silently fixes Counter 01 styling** which was almost certainly also unstyled on the live `vyntechs.dev/intake` route. Worth Brandon retesting Counter 01 after merge.
- Walked validation matrix on both staging URLs. Cross-feature gap list assembled.
- Established a new workflow tier with Brandon: **tier-2 "merge-candidate" preview at `staging-rc.vercel.app`** (not yet provisioned). Pattern: branch off latest main + merge feature → deploy → re-validate the integrated code → only then merge to main.

## Plan-tree gap list (apply on `feature/phase-o-counter-02-03`)

1. **Authorize & queue → 404.** Add stub `/api/intake/authorize` POST that returns a synthetic `workOrderId`. Counter 04 replaces with real persistence.
2. **Re-run AI / Print for customer / Print receipt buttons are no-ops.** Disable with `disabled` + `title="Wires up in Counter 04"`. Don't make them look interactive.
3. **Quote total doesn't recalculate** when `×` removes a line. Compute totals from `lines` state (reduce), not from props.
4. **Mobile viewport breaks the layout.** Add a viewport-gate client component that detects `window.innerWidth < 1280` and renders a "Use a desktop or laptop — this screen needs a wider window" message. Apply on Counter 02 + Counter 03.
5. **Network error alert persists.** Auto-dismiss on user input (form change handler clears `error` state).
6. **`/favicon.ico` 404 (project-wide cosmetic).** Add `app/icon.tsx` or a static `public/favicon.ico`.

Stub-data behavior on Counter 02-03 is acceptable until Counter 04 wires real data — flag in commit message but don't gate the merge on it.

## Check-back gap list (apply on `feature/phase-r-comeback`)

1. **Check-ins panel REPLACES the Today queue when active** — design intent per Phase R handoff was "between In-progress and Queued." Likely a render-condition bug in `components/screens/today-home.tsx`. Confirm with screenshot before/after.
2. **`CRON_SECRET` not set on Vercel.** Add to **Preview AND Production** scope via CLI (`vercel env add CRON_SECRET preview "" --value=$(openssl rand -hex 32) --yes`, repeat for production). Then curl-test `/api/cron/comeback-prompts-daily` with the bearer token to verify the route surfaces due rows.
3. **"Held" button untested.** Insert test follow-up via Supabase MCP, click Held, confirm DB row gets `resolved_at` filled and `comeback_recorded=false`, delete test row. (The "Came back" path was confirmed end-to-end this session — DB row gets `resolved_at` + `comeback_recorded=true`.)
4. **`/favicon.ico` 404** — same as plan-tree #6, project-wide.

## Tier-2 workflow (new — once gaps closed on each branch)

For each feature, after its tier-1 gaps are closed:

1. `git checkout -b rc-<feature> main && git merge --no-ff <feature-branch>` — locally, off latest main
2. `git push origin rc-<feature>` — Vercel auto-builds
3. `vercel alias set <new-deployment-url> staging-rc.vercel.app` (creates the alias on first run)
4. Run full validation matrix on `staging-rc` — functional + regression + a11y + console + mobile
5. Brandon eyeballs `staging-rc`. On his go: `git checkout main && git merge --no-ff <feature-branch> && git push origin main`. Smoke prod 5 min.

**Order:** check-back first (older). Then plan-tree (now off updated main).

**Phase R merge-day extras** (still per its own handoff): `0009_follow_ups` already applied (confirmed this session); CRON_SECRET to be set per gap #2 above before merge.

## Carryovers

- `/api/health` still in repo — diagnostic only, remove once both features merged to prod and corpus loop is verified
- All earlier carryovers from prior handoffs still apply unless superseded above
- `tmp/design-handoff-2026-05-04/` is gitignored. Each fresh worktree refetches.

## Suggested next session split (per Brandon's strategic-context request)

Each fits cleanly in a fresh context:

- **Session 2 (next):** Apply the **plan-tree gap fixes** only. Push. Re-run validation matrix on `staging-plantree`. Write fresh handoff. Stop.
- **Session 3:** Apply the **check-back gap fixes** + add `CRON_SECRET`. Push. Re-run validation matrix on `staging-vyntechs`. Write fresh handoff. Stop.
- **Session 4:** Stand up `staging-rc.vercel.app`. Run **tier-2 candidate for check-back** (merge into RC, deploy, validate, hand off). On Brandon's go, merge to main, smoke prod. Stop.
- **Session 5:** **Tier-2 candidate for plan-tree** (now off updated main). Same playbook. On Brandon's go, merge to main, smoke prod.

Recommend `/clear` between each. Paste prompts in the next session start by reading this handoff first.
