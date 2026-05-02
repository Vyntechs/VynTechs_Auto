# Vyntechs MVP — Session Handoff (Phase E phone surface shipped, 2026-05-01)

**For the next session: paste this file as the first message. It supersedes `2026-05-01-handoff-end-of-phase-d.md`.**

## Where we are

- **Worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
- **Branch:** `feature/mvp-implementation` (now **18 commits ahead** of `main`)
- **Plan:** `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md`
- **Spec:** `docs/superpowers/specs/2026-05-01-vyntechs-design.md`
- **Tests:** **85 passing** across 14 files. Typecheck clean (`pnpm exec tsc --noEmit` exit 0).

## What shipped this session

Phase E phone surface — full design-system + 5 screens — landed in one commit (`a4b33e6`).

The design was synthesized in **Claude Design** (claude.ai/design) by feeding it a curated, UI-stripped product brief in a separate private repo `Vyntechs/vyntechs-design-context` (six docs: README, WORKFLOW, DATA, SCREENS, PHASES, QUALITY_BAR). The "let it design freely with quality gates" approach yielded **"Workshop Instrument"** — a graphite + signal-amber + Instrument-Serif aesthetic synthesized from scratch.

### Foundation
- `app/globals.css` — full token set (OKLCH color, type scale, spacing, radii, motion). Dark canonical, light opt-in via `[data-theme="light"]`.
- `app/layout.tsx` — `next/font` for Inter Tight + JetBrains Mono.
- `public/fonts/InstrumentSerif-Regular.ttf` — self-hosted serif.
- `@phosphor-icons/react` for iconography (free; OFL).
- **No Tailwind, no shadcn.** Design was authored as plain CSS with variables — perfect Next.js fit, no migration needed.

### Component primitives — `components/vt/`
Pill, Risk, VehicleStrip, Module, ConfidenceBlock, TreeRail, CaptureBar, AppHeader, DtcChip, HairlineProgress. Typed, accessible (aria labels, focus rings, reduced-motion fallbacks). 13 unit tests in `tests/unit/vt-components.test.tsx`.

### Screens — `components/screens/`
- `today-home.tsx` — T-PH-2 — In progress / Queued / Closed-today.
- `active-session.tsx` — T-PH-4 — Vehicle strip, active step with risk/gate, confidence, tree rail, capture bar.
- `active-step-form.tsx` (client) — POSTs observation to `/api/sessions/[id]/advance`.
- `tree-generating.tsx` — T-PH-5 — Italic-serif loading state with hairline progress bar.
- `decline-or-defer.tsx` — T-PH-6 — Static demo only; Phase M wires real gating.
- `outcome-capture.tsx` — T-PH-7 — Form with stub AI specificity rejection; Phase F wires real validation.

### Routes — `app/(app)/`
- `today/page.tsx` — fetches sessions for the tech, splits into in-progress / queued / closed-today (queued is empty until intake-queue concept lands).
- `sessions/[id]/page.tsx` — renders ActiveSession (or TreeGenerating when `treeState.nodes` is empty).
- `sessions/[id]/loading.tsx` — TreeGenerating during navigation.
- `sessions/[id]/outcome/page.tsx` → OutcomeCapture.
- `sessions/[id]/decline/page.tsx` → DeclineOrDefer with demo data.
- `(app)/layout.tsx` stripped to **auth + pass-through** — design owns its chrome (vehicle strip, capture bar, etc.). The previous header/nav was removed.

### Public preview — `app/design/page.tsx`
All five screens at 390×844 with fixture data, **no auth, no DB required**. Visit `/design` to see the design rendered. Used for verification this session.

## Design source preserved

- **Claude Design archive** (gzipped tar from claude.ai) extracted to `.design-from-claude/` in the worktree. **Gitignored.** Contains the original synthesized HTML/CSS/JSX prototypes, brand assets (sigil.svg, wordmark.svg, risk glyphs), foundation CSS, chat transcript, and Instrument Serif TTF. The TTF was copied into `public/fonts/`; the rest is reference material.
- **Product brief repo:** `https://github.com/Vyntechs/vyntechs-design-context` (private). Six markdown docs that describe what the product does without prescribing visuals. Re-link this in any future Claude Design session for consistent re-synthesis.
- **Workshop Instrument design-system README** is in the gitignored archive at `.design-from-claude/vyntechs-design-system/README.md`. Worth re-reading if the design system needs to evolve.

## Conventions to preserve

- **Strict `superpowers:test-driven-development`** — Red → Green → Refactor.
- **Strict `superpowers:verification-before-completion`** — evidence before claims.
- TS aliases camelCase, SQL columns snake_case.
- Production code takes `db: AppDb` as parameter (DI for testability).
- `lib/ai/client.ts` uses lazy Proxy (defers Anthropic SDK construction).
- `vi.hoisted` for mock factories shared between `vi.mock` and per-test setup.
- **The design tokens are the source of truth.** Always reference `--vt-*` tokens, never hard-code hex / px values for color and spacing. Use semantic type classes (`.vt-h1`, `.vt-mono-data`, `.vt-eyebrow`) over inline font styles when adding new surfaces.
- **Icon discipline:** Phosphor Regular only. No emoji in product UI. Risk class glyphs are bespoke (live in `.design-from-claude/.../assets/risk/` if we ever swap from CSS-drawn glyphs to SVG).
- **Voice:** calm, technical, second-person, imperative. No cheerleading, no condescension, no sparkle. Numbers always with units (`3.6 psi`, `87.0 %`). Confidence always to one decimal.
- **Be terse.** No Insight blocks unless genuinely non-obvious.
- **Workflow adherence** — invoke each named superpowers skill explicitly at its workflow step.

## Open env values still needed

Same as before — none of the in-flight code work is gated, but live testing requires:

- `SUPABASE_SERVICE_ROLE_KEY`
- `[YOUR-PASSWORD]` placeholder in `DATABASE_URL` and `DATABASE_URL_DIRECT`
- `ANTHROPIC_API_KEY` for live tree generation

The `/design` route works without any env values — fixture-driven.

## Recommended next steps

The natural next-up phases, in priority order:

1. **Phase F — Outcome Capture (7 tasks).** Wires real AI specificity validation to `OutcomeCapture`. The form structure is already in place; needs the AI validation hook + 7-day / 30-day comeback scheduling. Best follow-up to E because it closes the session loop.
2. **Phase H — PWA + Polish (3 tasks).** Service worker, install prompt, offline banner. Touches existing surfaces lightly.
3. **Phase M — Risk gating + Decline-or-Defer (subset of 9 tasks).** Wires real confidence-gating logic. The `DeclineOrDefer` screen is ready to receive real data.
4. **Phase I — Multi-Modal Capture (10 tasks).** Wires the four `CaptureBar` buttons (Voice, Photo, Video, Scan) to actual capture flows.
5. **Phase N — Tablet layout (6 tasks).** Same design system, two-pane layout. Tokens already support all viewports.

## Recommended resumption flow

1. `/clear`.
2. Paste this file as the first message.
3. Read the Workshop Instrument design system README at `.design-from-claude/vyntechs-design-system/README.md` (gitignored — extract from `https://api.anthropic.com/v1/design/h/__2AZWqZXQdx20C9BJTIIw` if not present locally).
4. Pick the next phase. Phase F is the recommended default — closes the diagnostic loop end-to-end.
5. Use `superpowers:executing-plans` (once per phase) and `superpowers:test-driven-development` (every cycle).
6. Boot dev server + visit `/design` at 390×844 in Chrome DevTools MCP for any UI surface.
7. End of phase: `chrome-devtools-mcp:a11y-debugging`, `vercel:performance-optimizer`, `vercel:verification`.

## Key files to know (additions this session)

- `app/globals.css` — design tokens
- `components/vt/index.ts` — VT primitives barrel (Pill, Risk, VehicleStrip, etc.)
- `components/vt/vt.css` — component-level styles
- `components/screens/` — the five phone screens
- `lib/format.ts` — `formatVehicleName`, `formatElapsed`, `nodesToSteps`, `getActiveNode`
- `app/design/page.tsx` — public design preview at 390×844 with fixtures
- `.gitignore` — `.design-from-claude/` is excluded

## Phase D conventions still apply

The Phase D corrections callout in the plan (line 2312) and the per-route auth-and-DI pattern remain authoritative. Helper arities are unchanged. `appendSessionEvent` and `updateSessionTreeState` are how the active-step form posts observations through the existing `/api/sessions/[id]/advance` route.
