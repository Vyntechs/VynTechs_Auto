# Vyntechs MVP — Handoff (2026-05-04, Session 5: plan-tree validated on RC then shipped to prod)

Supersedes `2026-05-04-handoff-plan-tree-rc-validated.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs` (main worktree).
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if next session touches UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **378/378**, tsc + build clean.
4. **Production at `vyntechs.dev` is on `main` head `e3a2568`** — plan-tree (Counters 01–03 + ViewportGate + favicon/icon) is live alongside phase-r check-back. Smoke confirmed authed.
5. `feature/phase-o-counter-02-03` is now merged. Branch can be deleted; same for `rc-plan-tree` and its worktree.

## State

- **Production:** `vyntechs.dev` → `vyntechs-mx470tguv-…vercel.app` → `main` head `e3a2568`. Tree of head matches the staging-rc-validated `f281c17` byte-for-byte; the two extra commits (`8a19b26`, `e3a2568`) are empty rebuild triggers from the env-var fix below — no source changes.
- Vercel prod env var **`NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true`** is now set (was missing entirely; was the live blocker — see "Prod-readiness gap closure" below).
- Staging aliases unchanged from Session 4: `staging-vyntechs.vercel.app`, `staging-plantree.vercel.app`, `staging-rc.vercel.app` — all now point at code in prod, can be reassigned in Session 6 without ceremony.
- `follow_ups` table on live: empty post-validation (test row `00000000-0000-0000-0000-000000000505` inserted, panel surfaced, Held clicked, DB write verified, deleted).
- `rc-plan-tree` worktree at `.claude/worktrees/rc-plan-tree` is disposable; same for the `rc-plan-tree` branch (its only post-merge commit was the Session-5-paused handoff `cf4916c`, now superseded by this file).

## What this session covered (Session 5 shipped)

1. **State verification.** Confirmed `rc-plan-tree` head `cf4916c` (handoff doc), parent `f281c17` (validated merge); `main` head `b26784d` (phase-r ship), untouched; `staging-rc.vercel.app` + `vyntechs.dev` both 200.

2. **Prod merge + push.** From main worktree: `git merge --no-ff feature/phase-o-counter-02-03` produced `17cf4d5`. Tree of `17cf4d5^{tree}` verified identical to `f281c17^{tree}` (validated staging-rc) before pushing — no surprise re-resolution. Pushed → Vercel auto-built `vyntechs-bc8n0zgo7-...` in **39s** → aliased to `vyntechs.dev`.

3. **Autonomous gap audit on prod (curl-able / public surfaces).**
   - `/favicon.ico` → 200, `image/vnd.microsoft.icon`, 1919 bytes ✓
   - `/icon.svg` → 200, `image/svg+xml`, age 0 (fresh from new build) ✓
   - `POST /api/intake/authorize -d '{}'` → **201** `{"workOrderId":"WO-..."}` ✓ (stub by design — Counter 04 wires real persistence; route source `app/api/intake/authorize/route.ts` is explicit about this and persists nothing)
   - `/sign-in` → 0 console errors / 0 warnings, Lighthouse desktop 100/100/100/100 (48 audits, 0 fails) ✓

4. **Prod-readiness gap caught + fixed live** (see § "Prod-readiness gap closure" below — `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` was missing from Production env scope, returning 404 on the entire `/intake/*` tree for authed users).

5. **Authed gap audit on prod** (after the env fix). Logged in via chrome-devtools as `brandon@vyntechs.com`:
   - `/intake` (Counter 01) → fully styled, "Who's at the counter?" form with Customer / Vehicle / Complaint sections, VIN scan button ✓
   - `/intake/plan-quote/draft-rc-test` (Counter 02) → 5-step plan, total **`2.25 hr / $247`**, click "Remove Repair" → live recompute to **`1.5 hr / $165`** ✓; "Re-run AI" + "Print for customer" `disableable disabled` ✓
   - Authorize click → POST `/api/intake/authorize` → 201 → navigate to `/intake/confirmed/WO-57b78bd4-...` ✓
   - Counter 03 → page styled, "Print receipt" `disableable disabled`, vehicle/customer/estimate/tech/SMS-preview sections render ✓ (ESTIMATE shows `2.25 hr · $247` — documented carryover; Counter 03's totals are hardcoded stubs pending Counter 04's `lib/intake.ts` wire-up)
   - Resize to 390×844 on Counter 02 → only `<ViewportGate>` renders: "Use a desktop or laptop — this screen needs a wider window." ✓; resize back to 1440×900 → Counter content reappears
   - Phase-r regression: inserted test row `00000000-0000-0000-0000-000000000505` for Brandon's tech_id against his open session `ab92fac2-...`. `/today` reload → "CHECK-INS · 1" panel renders with "2015 Ford F250 · 7-DAY CHECK-IN", Held / Came back / VIEW CASE buttons ✓. Held click → panel dismissed, `/today` returned to In Progress only ✓. DB row post-Held: `resolved_at = 2026-05-05 11:51:36+00`, `comeback_recorded = false` ✓. Test row deleted; `follow_ups` count back to 0.
   - **Lighthouse desktop:** `/intake` 100/100/100/100 (47/0), `/intake/plan-quote/draft-rc-test` 100/100/100/100 (48/0), `/intake/confirmed/WO-...` 100/100/100/100 (46/0), `/today` **95**/100/100/100 (45/1) — 1 a11y failure: `color-contrast` on the In Progress card (state-dependent, not a code regression vs staging-rc; tree is identical and staging-rc was anonymous-ish empty state). See "Carryovers" below.

## Prod-readiness gap closure (the env-var bug)

**Symptom.** After ship, anon `curl /intake/plan-quote/draft-rc-test` returned 307 → /sign-in (auth middleware), but authed Brandon got **404**. Staging-rc had been 200 with the same tree.

**Root cause.** `app/(app)/intake/layout.tsx:8` calls `notFound()` when `isDesktopIntakeEnabled()` returns false. `lib/feature-flags.ts:1` reads `process.env.NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'`. Vercel had this env var set on **Preview** scope only (added during Session 5 prep, not propagated to Production). So staging-rc (Preview deploy) had it; `vyntechs.dev` (Production deploy) didn't. Session 4 handoff anticipated this would be fixed during Session 5's prod ship; the original handoff didn't list it as a concrete pre-flight item, and it slipped past initial smoke until Brandon hit a 404.

**Fix took two attempts:**
1. `echo "true" | vercel env add NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED production` then `vercel redeploy <prod-url>`. Did not work — `vercel redeploy` reuses the cached build artifact, and `NEXT_PUBLIC_*` env vars are read at build time. Needed a fresh build.
2. Empty commit + push (`8a19b26`) → fresh build `q5yd888f4` (45s). **Still 404.** Pulled production env to inspect: value was `"true\n"` (literal trailing newline from `echo`'s default behavior). Strict equality `'true\n' !== 'true'` → false → notFound() fires → 404.
3. `vercel env rm` then `printf "true" | vercel env add` (no newline). Verified via `od -c` that the value is exactly `t r u e` followed by line terminator (outside the quoted value). Empty commit + push (`e3a2568`) → fresh build `mx470tguv` (45s). **Authed `/intake/plan-quote/draft-rc-test` rendered.** Verified end-to-end via chrome-devtools.

**Lessons recorded (worth keeping):**
- `vercel redeploy` reuses cached builds. For env-var changes that affect `NEXT_PUBLIC_*` vars (which are inlined at build time), force a fresh build via empty commit + push or `vercel deploy --force`.
- Always pipe values with `printf "..."` or `echo -n "..."` into `vercel env add` (and any tool that reads stdin verbatim). `echo` adds a trailing newline that gets stored in the env value.
- The gap-audit pattern (every concern → a runtime verification on the actual prod surface) is what surfaced this. Curl alone gave a misleading 307 (auth-middleware redirect for anon) that masked the layout's notFound() for authed users. Always verify the authed user flow from inside the auth boundary.

## Validation matrix (final state on `vyntechs.dev` head `e3a2568`)

All checks below pass live on prod, captured during the audit above:

- Counter 01 `/intake` styled (Workshop Instrument loaded via merged layout) ✓
- Counter 02 line-remove live recompute (2.25hr/$247 → 1.5hr/$165) ✓
- Counter 03 disabled-button states ("Print receipt" disableable disabled, "Wires up in Counter 04" hover description) ✓
- ViewportGate at 390×844: only "Use a desktop or laptop" renders ✓
- `/favicon.ico` 200, `/icon.svg` 200 ✓
- `POST /api/intake/authorize` → 201 with `WO-` UUID stub ✓
- Phase-r Check-ins panel: surfaces, Held click, DB writes `resolved_at` + `comeback_recorded=false` ✓
- Lighthouse desktop: Counter 01 100/100/100/100 · Counter 02 100/100/100/100 · Counter 03 100/100/100/100 · `/today` 95/100/100/100 (1 color-contrast warn — see Carryovers)

## Carryovers (still apply)

- **`/today` Lighthouse a11y = 95 (color-contrast)** — new this session, only on prod, not on staging-rc. Almost certainly the In Progress card's risk pill or live-timer color when populated. Tree is identical to staging-rc, so this is a state-dependent finding. Worth a 5-min targeted fix in a follow-up: open the report at `/var/folders/.../chrome-devtools-mcp-BPjDL5/report.html` to identify the specific element, bump the contrast in `components/vt/v2-instruments.css` (or wherever the In Progress card styles live).
- `quote.totalHours` and `quote.totalUSD` props on Counter 03 still hardcoded — Counter 04's `lib/intake.ts` wire-up closes this loop.
- `/api/health` diagnostic still in repo — remove once corpus loop verified end-to-end in prod (still pending).
- Brand drift on `public/icons/icon.svg` (still amber `#F2A93B`) — separate cleanup task.
- `app/api/intake/authorize/route.ts` is a placeholder stub (no DB persistence, generates UUID + returns). Counter 04 replaces it with a real handler that persists a WorkOrder record keyed by draftId.
- Sign-in page has 1 a11y issue: form fields missing `autocomplete` attribute (count 3). Pre-existing, not a regression. Easy fix: add `autocomplete="email"`, `autocomplete="current-password"` to the sign-in inputs.
- `staging-vyntechs.vercel.app`, `staging-plantree.vercel.app`, `staging-rc.vercel.app` aliases now point at deployments whose code is in prod — reassign next time, no need to actively decommission.
- `rc-plan-tree` branch and worktree are disposable. Same for `rc-check-back` from Session 4.
- Plan-tree carryovers from `2026-05-04-handoff-plan-tree-gaps-closed.md` still apply on the merged tree.

## Next session (Session 6)

Likely Counter 04 — wires `lib/intake.ts` for real draft persistence + work order writes. When that lands:

1. Tier-2 RC pattern off updated `main` (which now has phase-r + plan-tree).
2. Worktree: `.claude/worktrees/rc-counter-04` off `origin/main`.
3. `vercel link --project vyntechs-dev --yes`.
4. Merge `feature/phase-o-counter-04` (or whatever the branch name is); resolve conflicts with the now-merged Counter 02/03 routes.
5. **Pre-flight: env-var diff.** Before validating, run `vercel env ls`, identify any env vars set on Preview but missing on Production (this session's miss). For Counter 04, that likely means `NEXT_PUBLIC_*` flags or new server-side keys for whatever persistence backend it uses. Set them on Production before pushing the merge — fresh build will pick them up.
6. Standard validation matrix on staging-rc (use `superpowers:executing-plans` checkpoints).
7. On Brandon's go: merge to main, prod ship, gap audit. **Run the audit from inside the auth boundary** (sign in, exercise the actual user flow) — not just curl/anon, which masks layout-level `notFound()` calls behind auth-middleware 307s.

If the `/today` color-contrast a11y regression annoys anyone first, that's a 5-minute fix; can ship as its own PR ahead of Counter 04.

Recommend `/clear` before starting Session 6.
