# Vyntechs MVP — Handoff (2026-05-04, plan-tree gaps closed, ready for tier-2 RC)

Companion to `2026-05-04-handoff-mid-validation-gap-list.md` — that handoff still authoritative for the **check-back branch's** unfixed gap list (Session 3 territory).

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/phase-o-counter-02-03`
2. Read `AGENTS.md`. UI work upcoming for check-back fixes → also read `docs/superpowers/ui-design-toolkit.md`.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **347/347** tests, tsc clean, build clean.
4. Plan-tree feature on `feature/phase-o-counter-02-03` at head `42f1824` is **GAPS-CLOSED** + validated on `staging-plantree.vercel.app`. Ready for Session 5 (tier-2 RC).
5. Check-back feature on `feature/phase-r-comeback` head `4d5734c` still **GAPS-OPEN** — Session 3 next.

## State

- Production at `vyntechs.dev` unchanged on `main` (head `d7747d7`).
- Staging aliases unchanged: `staging-vyntechs.vercel.app` → check-back, `staging-plantree.vercel.app` → plan-tree (now at `42f1824`).
- `staging-rc.vercel.app` not yet provisioned (Session 4).
- `CRON_SECRET` still missing on Preview AND Production scopes — must be set before merging check-back to main (per check-back gap #2 from prior handoff).

## What this session covered (Session 2)

All six plan-tree gaps from the prior handoff closed via TDD:

1. **Stub `/api/intake/authorize` POST** added — returns `{ workOrderId: WO-<uuid> }` 201. Counter 04 will replace with real persistence (`lib/intake.ts`). Tested at `tests/unit/intake-authorize-route.test.ts` (2 tests).
2. **`Re-run AI`, `Print for customer`, `Print receipt` buttons disabled** with `title="Wires up in Counter 04"`. Snapshot confirms screen-reader description carries through. (3 new component tests.)
3. **Quote total recomputes from `lines` state** via reduce — props `quote.totalHours/totalUSD` no longer read. Removing the diagnostic line live on staging dropped the total from `2.25 hr / $247` → `0.75 hr / $82`. (1 new component test.)
4. **`<ViewportGate>` client component** — `window.innerWidth < 1280` renders a Workshop-Instrument-styled gate with `role="alert"`. Resize listener flips live. Wraps Counter 02 + Counter 03 at the **page boundary** (not inside the component) so component tests stay focused on component logic. (4 new component tests.)
5. **Network error auto-dismisses** in Counter 02 on writer-note edit and on quote-line removal. (1 new component test.)
6. **`app/icon.svg` + `app/favicon.ico` added.** Favicon is a binary ICO wrapping the existing 192px brand mark (PNG payload). Both URLs return 200 with correct content-types. Modern Chrome no longer requests `/favicon.ico` because the SVG link suppresses it — direct `/favicon.ico` requests still resolve.

**Tests:** 336 → **347 (+11)**. All tsc clean. All build clean.

## Validation matrix (passed on `staging-plantree.vercel.app` at `42f1824`)

- Sign-in as `angelmoralesj@yahoo.com` / `Angelsoccer02` → `/today` ✓
- Walk Counter 01 → 02 → 03: form rendered, total recomputed on remove, Authorize POST 201, navigated to `/intake/confirmed/WO-674db52f-...` ✓
- Re-run AI / Print for customer / Print receipt all `disableable disabled` with `description="Wires up in Counter 04"` ✓
- Regression: `/today`, `/sessions`, `/sessions/new`, `/billing` all clean console ✓
- Mobile (390×844 emulated, deviceScaleFactor 3): both `/intake/plan-quote/*` and `/intake/confirmed/*` show only the gate ✓
- Resize back to 1440×900 → Counter content reappears (resize listener verified live) ✓
- **Lighthouse desktop:** Counter 01 / 02 / 03 each **100/100/100** on a11y / best-practices / SEO. **132 audits passed / 0 failed across all three screens.**
- **Console:** 0 errors, 0 warnings across the full walk + regression.
- **Network:** `/favicon.ico` resolves 200, no implicit request emitted because of `<link rel="icon" type="image/svg+xml">`.

## Carryovers (still apply)

- `quote.totalHours` and `quote.totalUSD` props on `CounterPlanQuoteProps` are **now unused** but kept in the type so the page-level stub spread doesn't break. Counter 04 will rework the prop shape entirely.
- Stub data on `/intake/plan-quote/[draftId]` and `/intake/confirmed/[workOrderId]` still hardcoded. Counter 04 wires real draft hydration via `lib/intake.ts`.
- `/api/health` diagnostic still in repo — remove once corpus loop verified in prod.
- Brand drift: `public/icons/icon.svg` (and the new `app/icon.svg` copy) still uses legacy amber `#F2A93B` for the horizontal bars. The signal token rebranded to navy in the codebase. Separate brand-cleanup task; out of scope here.

## Next session (Session 3)

Apply the **check-back gap fixes** on `feature/phase-r-comeback` per `2026-05-04-handoff-mid-validation-gap-list.md` § Check-back gap list:
1. Fix the today-home render condition that lets Check-ins panel REPLACE the Today queue when active
2. Set `CRON_SECRET` on Preview + Production via `vercel env add`, then curl-test `/api/cron/comeback-prompts-daily`
3. Validate the "Held" button end-to-end via Supabase MCP
4. (favicon already fixed for the project — same change carries over once branches converge)

Push, re-validate on `staging-vyntechs.vercel.app`, write fresh handoff, stop. **Recommend `/clear` before starting.**
