# UI Design Toolkit — Vyntechs

> **READ THIS BEFORE TOUCHING ANY UI.** This is the single source of truth for which Claude Code tools, skills, and MCP servers to use for user-facing work, and what user-input checkpoints are non-negotiable. Picking the right tool is part of the work — no shortcuts.

## When to read this

Before starting **any** task that creates or modifies a user-facing surface. At minimum:
- Phase E start (phone session UX)
- Phase F (outcome capture forms)
- Phase G (Stripe billing UI)
- Phase H (PWA polish)
- Phase N (tablet layout)
- Phase O (desktop intake)
- Phase P (curator console)
- Any new component creation
- Any UX change request from the user

## High-level decision tree

```
Have a Claude Design handoff bundle (designed by Brandon)?
├─ YES → port from tmp/design-handoff-*/.../claude_code_handoff/ to the repo.
│        See "Claude Design handoff workflow" below.
└─ NO — and this is rare. Brandon designs in his Claude Design session,
        delivers a handoff bundle. If you somehow lack one:
   ├─ Have a Figma file? → use `figma:figma-implement-design`
   ├─ Explore layouts first? → `mcp__claude_ai_tldraw__exec` wireframes
   └─ Generate from spec? → `frontend-design:frontend-design` skill +
                            Chrome DevTools MCP for screenshot-iterate
```

Never code UI without one of these paths. "Just write the JSX" is a shortcut.

## Claude Design handoff workflow (the canonical path)

Brandon designs all screens in a persistent Claude Design session linked to the GitHub repo (`Vyntechs/VynTechs_Auto`). He delivers a bundle URL like `https://api.anthropic.com/v1/design/h/<hash>`.

To port a bundle:
1. **Fetch + extract.** WebFetch the URL — it returns gzipped tarball (saved to disk by the tool); `tar -xzf <path> -C tmp/design-handoff-<date>/`. The `tmp/` directory is gitignored.
2. **Read in order:** the top-level `vyntechs-design-system/README.md`, then `project/claude_code_handoff/README.md` (the canonical implementation guide), then the screen's `v2_designs/<NN>-<screen>.html` + matching `Screens-*.jsx`.
3. **Diff foundation tokens** — `claude_code_handoff/foundations/colors_and_type.css` vs `app/globals.css`. **Codebase wins.** Translate handoff names to codebase names (see "Token rename pattern" below).
4. **Build** — recreate as native React/TSX in the codebase using existing primitives from `components/vt/` first, then add new ones to `components/vt/desktop/` (or similar) only when needed. Don't render the HTML in a browser unless ambiguous — the source spells out everything.

## Token rename pattern (handoff CSS → codebase CSS)

The handoff CSS uses legacy token names from when the accent was actually amber. The codebase has the corrected `--vt-signal-*` names. Mechanical translation when porting:

| Handoff name (legacy) | Codebase name (canonical) |
|---|---|
| `--vt-amber-{200,300,400,500,600,700,800}` | `--vt-signal-{same}` |
| `--vt-fg-on-amber: var(--vt-bone-900)` | `--vt-fg-on-signal: var(--vt-bone-50)` (light text on navy, not dark — fixes contrast) |
| `--vt-stroke-amber` | `--vt-stroke-signal` |

## Capabilities by category

### Design generation

| Tool | What it does | When to use |
|---|---|---|
| `frontend-design:frontend-design` (skill) | Generates distinctive, production-grade UI code from a description. Avoids generic AI aesthetic. | No Figma file. Building from spec/description. |
| `mcp__claude_ai_tldraw` (MCP) | Canvas-based sketching. `exec` runs JS on the canvas; `search` queries the editor API. | Layout exploration before coding (e.g. SessionView tree-on-top vs stacked vs tabs). |
| Claude.ai "Design"/artifact canvas | NOT directly available in Claude Code. | If the user produces a design there, paste the code or screenshot — I cannot reach into that surface from here. |

### Figma integration (only when a Figma file exists)

| Tool | What it does |
|---|---|
| `figma:figma-implement-design` (skill) | Figma → code, 1:1 visual fidelity. **Default for any task with a Figma URL.** |
| `figma:figma-generate-design` (skill) | Code → Figma. Push existing code as a Figma page/screen. |
| `figma:figma-use` (skill) | Mandatory prerequisite before calling `use_figma` MCP. Programmatic Figma editing. |
| `figma:figma-code-connect` (skill) | Map Figma components to code snippets via `.figma.ts`. |
| `figma:figma-create-design-system-rules` (skill) | Generate project-specific Figma-to-code conventions. |
| `figma:figma-generate-library` (skill) | Build / update a design system in Figma. |
| `figma:figma-use-figjam` (skill) | Specifically for FigJam (whiteboard) context. |
| `figma:figma-generate-diagram` (skill) | Mandatory prerequisite for `generate_diagram`. |
| `mcp__plugin_figma_figma__*` (MCP) | Underlying Figma API. Authenticate first. |

### Component implementation

| Tool | When |
|---|---|
| `vercel:nextjs` (skill) | App Router patterns — server vs client components, layouts, server actions, middleware, data fetching. **Invoke at the start of any new route.** |
| `vercel:react-best-practices` (skill) | TSX checklist — run after editing multiple TSX components. Covers structure, hooks, a11y, perf, TS patterns. |
| `vercel:shadcn` (skill) | shadcn/ui composition. Not yet relevant (no shadcn in repo). Revisit when shadcn lands. |
| `vercel:next-cache-components` (skill) | Caching strategy (`use cache`, `cacheLife`, `cacheTag`). Phase E is unlikely to need this; later phases will. |
| `vercel:turbopack` (skill) | Bundler config / HMR debugging. Use only if dev-server build issues surface. |

### Browser-based verification (mandatory for **any** UI change)

> The system prompt is explicit: *"For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."* No exceptions.

| Tool | Purpose |
|---|---|
| `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` (MCP) | Full Chrome control — `new_page`, `navigate_page`, `click`, `fill`, `take_screenshot`, `take_snapshot`, `resize_page`, `emulate`, `lighthouse_audit`, `list_console_messages`, `list_network_requests`. |
| `mcp__plugin_playwright_playwright__*` (MCP) | Alt browser automation. Used by `tests/e2e/landing.spec.ts` — match this pattern when adding e2e specs. |
| `chrome-devtools-mcp:chrome-devtools` (skill) | Guidance for using the MCP efficiently. |
| `chrome-devtools-mcp:troubleshooting` (skill) | If list_pages / new_page / navigate_page fail. |
| `chrome-devtools-mcp:chrome-devtools-cli` (skill) | Shell-script automation if needed outside the MCP. |
| `vercel:verification` (skill) | Full-story flow verification: browser → API → data → response. **Invoke before declaring any phase complete.** |

### Accessibility (mandatory — shop-floor UX)

| Tool | Purpose |
|---|---|
| `chrome-devtools-mcp:a11y-debugging` (skill) | Semantic HTML, ARIA, focus, keyboard nav, tap targets, contrast, web.dev guidelines. **Run before closing each Phase E task.** |

### Performance (run before phase close)

| Tool | Purpose |
|---|---|
| `chrome-devtools-mcp:debug-optimize-lcp` (skill) | Largest Contentful Paint debugging. |
| `vercel:performance-optimizer` (agent) | Lighthouse-style audit. **Invoke at end of Phase E.** |
| `chrome-devtools-mcp:memory-leak-debugging` (skill) | If suspected leaks (unlikely in Phase E, possible in Phase I+). |

### Design systems / theming (later)

| Tool | When |
|---|---|
| `vercel:shadcn` | Once shadcn is added (TBD — see "When to add shadcn / Tailwind" below). |

## Phone-specific requirements (Phase E and any mobile-first surface)

This product runs in the hands of techs working under a vehicle. Mobile-first is **functional**, not aesthetic.

- **Viewport for testing:** 390×844 (iPhone 14) via `chrome-devtools-mcp__resize_page` or `__emulate`
- **Tap targets:** 44×44pt minimum — anything smaller fails for gloved hands
- **Primary action zone:** bottom 1/3 of screen (single-handed thumb reach)
- **Contrast:** high — shop lighting is bad and screens get glare. Aim for WCAG AA at minimum, AAA where text is small
- **Offline behavior:** shop wifi drops. Service worker / queueing comes in Phase H but plan UI states for it from E onwards
- **Single-handed paths:** every primary user flow must be completable with one thumb on a phone
- **Voice input affordance:** plan stub buttons in StepInput for later phases — don't paint into a corner

## UX decisions that require user input (NO shortcuts — surface and decide together)

These are real product decisions, not implementation details. Always surface before locking in.

### Phase E specifically

1. **E2 SessionView layout** — tree-on-top + input-on-bottom vs. stacked vs. tabs vs. drawer. Affects every subsequent Phase E task.
2. **E5 StepInput** — text-only first, or include a stub voice-record button now? Affects later voice integration in Phase I.
3. **Error UI when LLM fails** — retry button, manual input fallback, or "try again later"? Affects perceived reliability.
4. **Loading state during initial tree generation (3–8s)** — what's on screen? Skeleton, spinner with progress copy, or vehicle-specific contextual message?
5. **Tree node interaction** — read-only, expandable on tap, or fully interactive? Affects E3 TreeView complexity.

### Phase F specifically

6. Outcome capture: minimal end-of-session form vs. full detailed capture. Trade-off between data richness and tech friction.

### Phase G specifically

7. Stripe entry point: top-nav, settings page, or onboarding-only?

## Workflow for any UI task

1. **Read this doc + the relevant plan task.**
2. Invoke `superpowers:executing-plans` (once per phase) and `superpowers:test-driven-development` (every cycle).
3. **Pick the design path** — Figma / frontend-design / tldraw-then-code.
4. **Wireframe or generate** the component / page / view.
5. **Test first** — component test or unit test where possible (TSX testable parts via `tests/unit/*.test.tsx`, e2e via Playwright in `tests/e2e/`).
6. **Implement minimal code to pass.**
7. **Run dev server.** Navigate via Chrome DevTools MCP at **phone viewport (390×844)**.
8. **Screenshot.** Verify against design intent. Compare to wireframe / Figma.
9. **Run `chrome-devtools-mcp:a11y-debugging`** — fix any issues before commit.
10. **Run `pnpm exec tsc --noEmit` + `pnpm test`** — must be clean.
11. **Surface UX decision points** from the list above to the user before locking in design.
12. **Invoke `superpowers:verification-before-completion`** before declaring done.
13. **Commit** with the message format from the plan task.

## End-of-phase checklist (Phase E and onward)

Before declaring a UI phase complete:
- [ ] Every task from the phase has a passing test (unit or e2e)
- [ ] `pnpm test` clean
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] All routes navigated at 390×844 viewport with screenshots
- [ ] `chrome-devtools-mcp:a11y-debugging` skill run, no new violations
- [ ] `vercel:performance-optimizer` agent run, results captured
- [ ] `vercel:verification` skill run on the primary user flow
- [ ] All UX decision points from the list above resolved with user input on record
- [ ] No console errors in dev (`chrome-devtools-mcp__list_console_messages` clean)

## Skills NOT to use during a UI phase (for clarity)

- `superpowers:subagent-driven-development` — UX needs design judgment in foreground (per handoff)
- `superpowers:dispatching-parallel-agents` — same reason
- `superpowers:brainstorming` — plan + spec already exist
- `superpowers:writing-plans` — plan already written

These are good tools, just not for UI work where each component decision compounds and benefits from foreground judgment.

## shadcn / Tailwind — decided NOT to adopt

**Workshop Instrument is the design system.** All form primitives, buttons, pills, layout shells live in `components/vt/` (phone) and `components/vt/desktop/` (desktop ≥1280px), styled via `components/vt/vt.css` + `components/vt/v2.css` against the `--vt-*` OKLCH tokens in `app/globals.css`. No shadcn, no Tailwind, no CSS modules.

If a future phase produces a real reason to revisit, surface it explicitly to Brandon — don't silently introduce.

## Tools NOT relevant to UI work (for noise reduction)

These are available in this session but unrelated to UI:
- `mcp__plugin_supabase_supabase__*` — DB / auth / edge functions
- `mcp__plugin_stripe_stripe__*` and `mcp__stripe__*` — payments (Phase G later)
- `mcp__plugin_vercel_vercel__deploy_to_vercel` — deployment (Phase S)
- `mcp__claude_ai_Gmail__*` — email
- `mcp__claude_ai_Google_Calendar__*` — calendar
- `mcp__claude_ai_Google_Drive__*` — drive
- `mcp__plugin_gitlab_gitlab__*` — git host (we use GitHub anyway)
- `mcp__surgeon__*` — YouTube / web extraction

## References

- **Plan:** `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md` (Phase E starts at line 2327; the Phase D corrections callout is at line 2312)
- **Spec:** `docs/superpowers/specs/2026-05-01-vyntechs-design.md`
- **Last handoff:** `docs/superpowers/sessions/2026-05-01-handoff-d4.md`
- **Conventions:** same handoff (TS aliases camelCase, SQL snake_case; production code takes `db: AppDb`; pglite per-test; etc.)
- **TDD discipline:** `superpowers:test-driven-development` skill — Red → Green → Refactor, watch every test fail before implementing
- **Verification discipline:** `superpowers:verification-before-completion` — evidence before claims, always

## Updating this doc

When you discover a new tool, fix a workflow, or change a convention during UI work — update this file in the same commit. This is the living UI playbook for the project.
