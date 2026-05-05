# Vyntechs MVP — Handoff (2026-05-04, Phase R comeback follow-ups shipped on a branch)

Companion to `2026-05-04-handoff-prod-deploy-shipped.md` — the prod-deploy handoff is still authoritative for the live `main` branch and `vyntechs.dev`. This handoff covers the **`feature/phase-r-comeback`** branch, which is committed but **not merged to main**. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/phase-r-comeback`
2. Read `AGENTS.md`. Latest plan corrections are in `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md` under "Phase R — Implementation corrections".
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **344/344 tests** pass, tsc clean, build clean. (All three were green at handoff time.)
4. Phase R is committed across **4 commits** on `feature/phase-r-comeback`: R1 schema, R2 schedule + DI, R3 cron + surface, R4 panel + list + resolve + decay.
5. Production at `vyntechs.dev` is still on `main` and unaffected by this branch.

## State

- Branch `feature/phase-r-comeback` at `5a08509`, parent commit on `main` is `298e28e`.
- Tests **344/344** clean. Was 316 baseline; +28 new across `comeback-schedule`, `comeback-surface`, `comeback-list`, `comeback-resolve`, `follow-up-panel`, plus a new "comeback follow-up scheduling (Phase R2)" block in `close-session-handler.test.ts`.
- New routes in build: `/api/cron/comeback-prompts-daily` (GET, daily 14 UTC), `/api/follow-ups/[id]/resolve` (POST).
- `vercel.json` created (was absent on `main`).
- Migration `0009_follow_ups.sql` written + journaled. **NOT applied to live Supabase** — apply via MCP `apply_migration` at merge time.

## What this session covered

- **Phase R end-to-end shipped on a branch.** Built strategic-incremental: 4 commits, each independently testable, each leaves the repo in a buildable state. Designed for one-merge-to-main when Brandon's ready.
- **Closes the outcome-feedback loop.** When a session closes, two follow-up rows (7d + 30d) auto-schedule. A daily cron flips `surfaced_at` when due. The tech sees a "Check-ins" panel on TodayHome (between In-progress and Queued). Tapping "Held" or "Came back" resolves the row; "Came back" fires `recordCorpusComeback` to decay matching corpus entries (existing fn from Phase K).
- **Plan-vs-reality reconciliation logged.** "Phase R — Implementation corrections (applied 2026-05-04)" callout added to the plan documenting the six material drifts (DI pattern, no shadcn, TodayHome not /sessions, plain shop English, etc.).
- **Side task: Angel's tester account provisioned.** `angelmoralesj@yahoo.com` Supabase auth user + profile pre-created in Brandon's shop (`089560cb-af9e-...`) as `role='tech'`. Same shop, separate tech — corpus shared. Login: `Angelsoccer02`.

## Carryovers

- **Merge sequence to ship Phase R to prod (when Brandon's ready):**
  1. From the worktree branch, ensure baseline still green (`pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`).
  2. `git checkout main && git merge --no-ff feature/phase-r-comeback` (or open a PR; the no-ff merge keeps the four commits visible on main's first-parent history).
  3. Apply migration `0009_follow_ups.sql` to live Supabase via MCP `apply_migration` with snake_case name `follow_ups_table`.
  4. Run MCP `get_advisors` after — should be no new lints (FK indexes already in the migration).
  5. Add `CRON_SECRET` to Vercel env vars (generate with `openssl rand -hex 32`). Both Production and Preview environments.
  6. `git push origin main` — Vercel auto-deploys, registers the cron job from `vercel.json`.
- **First close after merge writes follow-ups.** Brandon's first close-session post-merge will write 2 rows in `follow_ups`. They won't surface until 7 days later (after `due_at` passes) — for testing-the-loop purposes, manually `UPDATE follow_ups SET due_at = NOW() - INTERVAL '1 hour' WHERE kind='7d' AND session_id = '<id>'` then hit `/api/cron/comeback-prompts-daily` with the bearer secret to flip surfaced_at.
- **`/api/health` still pending removal.** From the prior handoff carryover. Not blocked by Phase R.
- **All earlier carryovers** from `2026-05-04-handoff-prod-deploy-shipped.md` apply unless superseded above.
- **Phase J / N / S still parked.** Stop-and-ask before touching.

## Suggested next session

If Brandon's ratified Phase R via the merge sequence above:
- Phase Q (calibration engine) — backend-only, threshold re-fit, depends on R's data flow being live (so Q runs against real outcomes).
- Or Phase O Counter 02-03 (desktop plan tree) — independent of Q/R, design bundle exists.

If Brandon hit something during R smoke:
- Triage from Vercel runtime logs first. The `/api/follow-ups/[id]/resolve` route returns `{ error, status }` — check response in Network tab.

Recommend `/clear` before either.
