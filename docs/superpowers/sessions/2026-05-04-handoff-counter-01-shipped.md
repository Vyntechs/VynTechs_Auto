# Vyntechs MVP — Handoff (2026-05-04, Counter 01 shipped via Claude Design v2 handoff)

Supersedes `2026-05-03-handoff-phase-i-verified-cleanup.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` (UI work upcoming).
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **303/303 tests**, exit 0, build clean.
4. Open the design handoff at `tmp/design-handoff-2026-05-03/vyntechs-design-system/project/claude_code_handoff/`. Read `README.md` first; then the screen you're building (`v2_designs/02-counter-plan-quote.html` next). Re-fetch via `https://api.anthropic.com/v1/design/h/HXGHr6IueKP8FrYYXWfeFQ` if `tmp/` is missing — it's gitignored.
5. Continue Phase O: **Counter 02 — AI plan & quote (HERO plan tree instrument)**, then Counter 03.

## State

- Branch `feature/mvp-implementation`, **1 commit ahead of `main`** (origin/main and origin/feature pushed at handoff time, see below).
- Tests **303/303**, tsc clean, `pnpm build` clean.
- Phase O Counter 01 (intake form) **shipped end-to-end**. Counter 02 + 03 remain.
- Active queue: continuing Phase O (Counter 02–03) → R (phone follow-ups) → Q (calibration, no UI) → P (curator console).

## What this session covered

- **Migration `0007_chief_bushwacker.sql` applied to live Supabase** (FK index on `artifacts.session_id`). Performance advisor flagged 7 more unindexed FKs — see Carryovers.
- **Repo pushed to GitHub for the first time.** `https://github.com/Vyntechs/VynTechs_Auto`. Both `main` and `feature/mvp-implementation` set up as tracking branches. **Required for Claude Design's GitHub sync** to see the project.
- **Claude Design v2 handoff bundle landed** (12 screens: 3 counter + 7 curator + 2 phone follow-ups + 2 phone existing-for-context). All 5 open design decisions resolved (commit `bbe21e4` description has summary; full README at `tmp/design-handoff-2026-05-03/.../claude_code_handoff/README.md`).
- **Foundation drift reconciled** — handoff CSS uses legacy `--vt-amber-*` (when accent was actually amber); codebase already corrected to `--vt-signal-*`. Codebase wins. Translation pattern: s/--vt-amber-/--vt-signal-/, s/--vt-stroke-amber/--vt-stroke-signal/, s/--vt-fg-on-amber/--vt-fg-on-signal/.
- **Counter 01 shipped** (commit `bbe21e4`): `components/vt/v2.css` desktop primitives, `components/vt/desktop/index.tsx` React primitives (Topbar, MainHeader, Btn, VtPill, Field, Input, Textarea, FormGroup, FormRow, FormFooter), `components/screens/counter-intake.tsx`, flag-gated `/intake` route, stub `/api/intake/submit` POST handler. 7 new tests.

## Carryovers

- **7 more unindexed foreign keys** flagged by Supabase performance advisor — same fix as 0007. Brandon hasn't approved batch yet. Tables: `profiles.shop_id`, `sessions.shop_id`, `sessions.tech_id`, `session_events.session_id`, `tech_assist_requests.session_id`, `corpus_entries.curated_by_user_id` + `.source_session_id` + `.source_shop_id`. Single migration with 7 `CREATE INDEX` statements would close it.
- **Counter 01 submit handler is a stub** — returns a placeholder UUID, persists nothing. **Counter 04 replaces it** with the real handler in `lib/intake.ts` that creates a `WorkOrderDraft` + kicks off AI plan stream. The form's `router.push('/intake/plan-quote/<draftId>')` will 404 until Counter 02's route exists.
- **`v2-instruments.css` not yet translated** — needed by Counter 02 (plan tree) and Counter 03 (some inline styles). At `tmp/design-handoff-2026-05-03/.../v2_designs/v2-instruments.css`. Same `--vt-amber-*` → `--vt-signal-*` translation pattern.
- **Counter 03 has inline `var(--vt-amber-500)` references** in `Screens-Counter.jsx` (the SW_WorkOrderConfirm `auth` styling) — translate when implementing.
- **Plan tree should be a reusable `<PlanTree>` component** per handoff README — Counter 02 displays it editable, Counter 03 displays it read-only with auth/gated/deferred per-step state. Build once, both consume.
- **NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true must be in `.env.local`** for `/intake` to render — otherwise it `notFound()`s.
- **I8 audio transport** still backlog (Whisper vs Anthropic native — undecided per 2026-05-03).
- **All earlier carryovers** from `2026-05-03-handoff-phase-i-verified-cleanup.md` still apply.

## Open Phase O design decisions (all resolved by Claude Design)

VIN: type+scan (typed canonical, scan affordance present and toggle-marked) · Quote editability: line-item ± with separate writer's note · Curator queue: tabular · Drift: time-series chart + sidebar · Follow-ups: section on Today/Home (not peer screen).

## Suggested implementation order (per handoff README)

Counter 02 → Counter 03 (closes Phase O) → Phone 11 + 12 (Phase R UI) → Curator 04 (overview) → 05 (queue) → 06 (case detail HERO) → 07 (authoring) → 08 (drift HERO).

## STOP-AND-ASK phases (deferred, decided 2026-05-03)

**Do not start Phases J, N, or S without explicit go-ahead from Brandon.**

- Phase J — Photo Storage Tiering (6 tasks). AWS cost-surprise concerns.
- Phase N — Tablet Layout + Real-Time Sync (6 tasks). Phone-first, tablet later.
- Phase S — End-to-End + Production Deploy (4 tasks). Don't deploy production without Brandon.

Recommend `/clear` before starting Counter 02.
