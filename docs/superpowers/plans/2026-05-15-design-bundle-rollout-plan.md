# Design-bundle rollout — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three unshipped pieces from the Anthropic design-handoff bundle: marketing-visuals swap, phone Follow-ups list refresh (#11), phone Outcome confirm refresh (#12). Three PRs, sequential, each branched from `origin/main`, each opened against `main`. Brandon merges via the GitHub UI after Vercel-preview validation; **never `git push` to `main`**.

**Architecture:** Three independent PR branches, each cut from `origin/main` HEAD. PR A is a pure asset + config swap. PR B and PR C are TDD visual refreshes — update tests for new DOM structure, refactor component to bundle design, confirm green.

**Tech Stack:** Next.js 16 App Router · React 19 · plain CSS (no Tailwind, no CSS modules) · Vitest · Playwright · pnpm.

**Source spec:** `docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md`
**Bundle root:** `/tmp/vyntechs-design-extract/vyntechs-design-system/`

---

## Phase 1 — PR A: Marketing visuals swap

**Branch:** `staging-marketing-visuals` (already cut from main, currently identical; spec doc commit `aa3592e` already on it).

**Goal of phase:** Replace 7 placeholder marketing screenshots with retina-resolution scenario-grounded PNGs; update alt strings.

### Task A.1: Confirm clean baseline before edits

**Files:** none modified.

- [ ] **Step 1: Confirm branch and clean working tree**

```bash
git rev-parse --abbrev-ref HEAD                 # expected: staging-marketing-visuals
git status --short | grep -v '^??' || echo OK   # no staged/unstaged tracked changes
```

Expected: branch matches, output `OK` (untracked stray PR screenshots are fine — they don't block us).

- [ ] **Step 2: Confirm bundle is still extracted at expected path**

```bash
ls /tmp/vyntechs-design-extract/vyntechs-design-system/project/marketing-visuals/screenshots/*.png | wc -l
```

Expected: `7`. If 0, redownload from the handoff URL (see spec source-materials table).

- [ ] **Step 3: Confirm baseline `pnpm test` is currently passing**

```bash
pnpm test --reporter=dot 2>&1 | tail -20
```

Expected: a clean tail like `Test Files X passed | Tests Y passed`. Capture the numbers — we'll compare after the swap. **If the baseline already shows failures**, halt and report; we don't want to attribute a pre-existing flake to our change.

### Task A.2: Copy the 7 PNGs into `public/marketing/screenshots/`

**Files:**
- Modify (overwrite in place): `public/marketing/screenshots/{hero,motion-01-open,motion-02-research,motion-03-propose,motion-04-confirm,motion-05-lock,laptop-hero}.png`

- [ ] **Step 1: Copy all 7 PNGs**

```bash
cp /tmp/vyntechs-design-extract/vyntechs-design-system/project/marketing-visuals/screenshots/*.png \
   public/marketing/screenshots/
```

- [ ] **Step 2: Verify dimensions are retina (1170×2532 phone, 2560×1600 laptop)**

```bash
file public/marketing/screenshots/*.png
```

Expected output (one line per file):
- `hero.png: PNG image data, 1170 x 2532`
- `motion-01-open.png: PNG image data, 1170 x 2532`
- `motion-02-research.png: PNG image data, 1170 x 2532`
- `motion-03-propose.png: PNG image data, 1170 x 2532`
- `motion-04-confirm.png: PNG image data, 1170 x 2532`
- `motion-05-lock.png: PNG image data, 1170 x 2532`
- `laptop-hero.png: PNG image data, 2560 x 1600`

**Halt if any dimension is wrong.**

### Task A.3: Apply the `screenshots.config.ts` patch

**Files:**
- Modify: `components/marketing/screenshots.config.ts` (drop-in replacement, shape unchanged, alt strings + comments rewritten).

- [ ] **Step 1: Replace config file**

```bash
cp /tmp/vyntechs-design-extract/vyntechs-design-system/project/marketing-visuals/code/screenshots.config.ts \
   components/marketing/screenshots.config.ts
```

- [ ] **Step 2: Verify the diff is alt-strings + comments only (no shape change)**

```bash
git diff --stat components/marketing/screenshots.config.ts
git diff components/marketing/screenshots.config.ts | grep -E '^[+-](export|type|const SCREENSHOTS)' || echo "no structural changes — alt-only ✓"
```

Expected: the grep prints `no structural changes — alt-only ✓`. If structural lines show up, halt and reconcile (the bundle promised shape unchanged).

### Task A.4: Verify typecheck and test suite still pass

**Files:** none modified.

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: exit 0, no errors. Alt-string changes shouldn't break types.

- [ ] **Step 2: Run unit + integration tests**

```bash
pnpm test --reporter=dot 2>&1 | tail -20
```

Expected: same pass count as baseline from Task A.1 step 3, OR fewer failures (some old tests may have asserted old alt-strings). **If any test failure is new and asserts an alt string, update that test** — the alt change is intentional. If it's a non-alt-related failure, halt.

### Task A.5: Mobile + desktop visual verification

**Files:** none modified.

- [ ] **Step 1: Start dev server in background**

```bash
pnpm dev &
```

Wait for "Ready" line in output.

- [ ] **Step 2: Capture screenshots at mobile and desktop viewports**

Use the Chrome DevTools MCP (`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`) to:
1. Navigate to `http://localhost:3000/`.
2. `resize_page` to 375 × 812 (iPhone SE/12 width) — take screenshot of landing hero region.
3. `resize_page` to 1440 × 900 (desktop) — take screenshot of landing hero + motion section + laptop section.
4. Visually confirm all 7 new images render correctly. Check the V° lockup on `motion-01-open.png` — the bundle README flags it as the only image where the lockup is CSS-text instead of the production lockup.png; verify it still reads "V° / Vyntechs" at the top.

- [ ] **Step 3: Stop dev server**

Kill the background `pnpm dev` process when verification is complete.

### Task A.6: Commit and push

- [ ] **Step 1: Stage the changes**

```bash
git add public/marketing/screenshots/*.png components/marketing/screenshots.config.ts
git status --short | grep -v '^??'
```

Expected: 8 staged paths (7 PNGs + 1 .ts).

- [ ] **Step 2: Commit with message naming the visuals swap and §10 deferral**

```bash
git commit -m "$(cat <<'EOF'
feat(marketing): retina screenshots + scenario-rewritten alt text

Replaces the seven placeholder PNGs in public/marketing/screenshots/
with the retina-resolution scenario-grounded captures from the
Anthropic design-handoff bundle (marketing-visuals/screenshots/).

Phone shots: 1170 × 2532. Laptop shot: 2560 × 1600.

Alt strings in components/marketing/screenshots.config.ts rewritten
to describe the four scenarios (AC pressure / electrical citations /
oil leak observation / vibration locked-case). File shape unchanged —
heroPhone / motionPhone (×5) / laptopHero slots, same ScreenshotAsset
type.

Spec §10 (OnLaptop scroll-pinned motion section + 5 new laptop motion
screens) is deferred per Brandon's 2026-05-15 decision — see
marketing-visuals/README.md "Scope vs. the original spec" for the
reasoning. This PR ships 6 phone + 1 laptop = 7 PNGs.

Known caveat from bundle README: motion-01-open.png renders the
AppHeader V° lockup as Instrument Serif text + a CSS accent circle
(the capture sandbox can't load image bytes). The other 6 shots use
VehicleStrip, not AppHeader, and have no lockup at all. If pixel
parity matters, replace just that one shot with a live pnpm-dev
capture at /sessions/new.

Refs spec: docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md
Refs original: docs/superpowers/specs/2026-05-15-marketing-visuals-redo.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push to origin**

```bash
git push -u origin staging-marketing-visuals
```

Expected: branch pushed; first push if remote already tracked.

### Task A.7: Open PR against `main`

- [ ] **Step 1: Open PR via `gh`**

```bash
gh pr create --base main --head staging-marketing-visuals \
  --title "feat(marketing): retina screenshots + scenario-rewritten alt text" \
  --body "$(cat <<'EOF'
## Summary

Swaps the 7 placeholder landing-page screenshots for the retina-resolution scenario-grounded captures from the Anthropic design handoff. Alt strings rewritten for the four new scenarios; config file shape unchanged.

## Validation checklist — please read BEFORE merging

- [ ] **Dimensions confirmed (output of `file public/marketing/screenshots/*.png`):**
  - `hero.png`: 1170 × 2532 ✓
  - `motion-01-open.png`: 1170 × 2532 ✓
  - `motion-02-research.png`: 1170 × 2532 ✓
  - `motion-03-propose.png`: 1170 × 2532 ✓
  - `motion-04-confirm.png`: 1170 × 2532 ✓
  - `motion-05-lock.png`: 1170 × 2532 ✓
  - `laptop-hero.png`: 2560 × 1600 ✓
- [ ] **Config diff is alt-only:** Alt strings rewritten for the four new scenarios (A · AC pressure / B · electrical citations / C · oil leak observation / D · vibration). `ScreenshotAsset` type, `ScreenshotsConfig` type, and the `heroPhone` / `motionPhone[5]` / `laptopHero` slot shape are unchanged.
- [ ] **V° lockup caveat (from bundle README, verbatim):** *"the AppHeader's V° lockup is rendered as Instrument Serif text + a navy circle accent in the captures (a CSS-only equivalent of the lockup.png file). The sandbox iframe used to render the captures can't load image bytes — `<img>` and `background-image: url(...)` both silently drop. The text fallback is visually faithful (same font family, same accent color, same 'V° / Vyntechs' composition) but isn't the same PNG asset as the running app. Only **motion-01-open.png** is affected — the other 6 screens use `VehicleStrip`, not `AppHeader`, and have no lockup at all. If pixel parity matters here, replace just that one shot with a live capture from `pnpm dev` at `/sessions/new`."*
- [ ] **Scope:** §10 of the original spec (OnLaptop scroll-pinned motion section + 5 new laptop motion screens) is deferred — see `marketing-visuals/README.md` "Scope vs. the original spec" for the reasoning. This PR ships 6 phone + 1 laptop = 7 PNGs.
- [ ] **Vercel preview** renders landing page correctly at mobile (375 px) and desktop (1440 px) viewports.

## Refs

- Rollout spec: `docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md`
- Original marketing-visuals spec: `docs/superpowers/specs/2026-05-15-marketing-visuals-redo.md`
- Bundle handoff README: `marketing-visuals/README.md` (from Anthropic design-handoff URL — not committed to repo)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Capture PR URL and wait for Vercel deploy bot comment**

Capture the PR URL. Watch the PR comments for the Vercel deploy bot — note the preview URL.

**Checkpoint:** Brandon validates on Vercel preview. Phase 1 complete. Move to Phase 2.

---

## Phase 2 — PR B: Phone Follow-ups list refresh (Screen #11)

**Branch:** `feat/follow-ups-panel-refresh` — cut from `origin/main` (NOT from PR A's branch).

**Goal of phase:** Refresh `components/comeback/follow-up-panel.tsx` to the bundle's `Screens-Phone-Followups.jsx#FollowupsPanel` design. Editorial preamble + per-row curator-quote accent backplate + "Still deferred" section for cases without corpus yet + risk pill + est. time + "resume →" action.

### Task B.1: Cut branch and run recon on the live component

**Files to read (no modification yet):**
- `components/comeback/follow-up-panel.tsx`
- `tests/unit/follow-up-panel.test.tsx`
- `lib/comeback/list.ts` (data shape supplier)
- `app/(app)/today/page.tsx` (where the panel is consumed)

- [ ] **Step 1: Cut a fresh branch from origin/main**

```bash
git fetch origin
git checkout -b feat/follow-ups-panel-refresh origin/main
git log -1 --oneline
```

Expected: HEAD matches `origin/main` HEAD.

- [ ] **Step 2: Read the live component**

Use Read on `components/comeback/follow-up-panel.tsx`. Note: (a) prop contract, (b) current DOM structure, (c) callers (use Grep for `<FollowUpPanel`).

- [ ] **Step 3: Read the current tests**

Use Read on `tests/unit/follow-up-panel.test.tsx`. Note what's asserted: prop signatures, render output, click handlers.

- [ ] **Step 4: Read the bundle's target design**

Re-read `/tmp/vyntechs-design-extract/vyntechs-design-system/project/claude_code_handoff/v2_designs/Screens-Phone-Followups.jsx` lines 13–114 (`FollowupsPanel`). Compare with reference PNG `claude_code_handoff/screenshots/11-phone-followups.png`.

- [ ] **Step 5: Read the consuming Today page**

Use Read on `app/(app)/today/page.tsx`. Verify the follow-ups banner / entry point already exists; if absent, this phase adds it.

### Task B.2: Update the tests RED — new DOM structure assertions

**Files:**
- Modify: `tests/unit/follow-up-panel.test.tsx`

- [ ] **Step 1: Add a test for the editorial preamble**

In `tests/unit/follow-up-panel.test.tsx`, add a test that renders `<FollowUpPanel cases={[...]} />` with at least one resolvable case and asserts the editorial preamble copy appears: *"The corpus has new answers for cases you couldn't close. Tap one to pick up where the bay left off."*

- [ ] **Step 2: Add a test for the "Resolvable now" section with curator quote backplate**

Assert: when a case has a `corpus_quote` (or whatever the live data shape calls the curator update), the row renders the quote in an italic-serif block with the curator's name + relative time. Use `getByText` for the curator name from the test fixture.

- [ ] **Step 3: Add a test for the "Still deferred" section**

Assert: when a case has no corpus quote, it renders in a separate section labeled "Still deferred" with "no ETA" copy.

- [ ] **Step 4: Run tests, confirm they FAIL**

```bash
pnpm test follow-up-panel --reporter=verbose 2>&1 | tail -30
```

Expected: the three new assertions fail (red). Existing assertions may still pass or may need migration — note any pre-existing tests that now make outdated assertions.

### Task B.3: Refactor the component GREEN

**Files:**
- Modify: `components/comeback/follow-up-panel.tsx`

- [ ] **Step 1: Port the bundle design**

Rewrite `follow-up-panel.tsx` using the bundle's structure: AppHeader/eyebrow wrapper if the component owns its own header (otherwise just the body); editorial preamble; Module per case with `num`+`label`+optional status pill; queue-row internals (queue-meta with vehicle + DTC chip, queue-complaint, accent-backplate quote block for resolvable, plain meta for still-deferred); risk pill + est. time + resume link.

Keep the existing prop contract (`cases` and any other props from recon) — do not break callers. Pull values from each case's existing fields; if the live data lacks a field the design needs (e.g., `corpus_quote_author`), default it to undefined and conditionally render.

Reference: `Screens-Phone-Followups.jsx` lines 13–114.

- [ ] **Step 2: Run tests, confirm GREEN**

```bash
pnpm test follow-up-panel --reporter=verbose 2>&1 | tail -30
```

Expected: all assertions pass. Pre-existing tests that now fail with stale assertions: update them to the new DOM (they should match new design intent, not old).

- [ ] **Step 3: Run the broader test suite to verify no regression**

```bash
pnpm test --reporter=dot 2>&1 | tail -20
```

Expected: no test in any other file regresses. If a consumer test fails because the panel's DOM changed, update that test as part of this PR.

### Task B.4: Mobile viewport visual verification

**Files:** none modified.

- [ ] **Step 1: Start dev server**

```bash
pnpm dev &
```

- [ ] **Step 2: Navigate to the panel and capture mobile screenshot**

Using Chrome DevTools MCP, navigate to whatever route renders the panel (likely `/today` if banner-gated, or `/follow-ups` if newly added). Resize to 375 × 812. Capture screenshot. Compare to bundle reference `claude_code_handoff/screenshots/11-phone-followups.png`.

- [ ] **Step 3: Stop dev server**

### Task B.5: Commit, push, open PR

- [ ] **Step 1: Stage and commit**

```bash
git add components/comeback/follow-up-panel.tsx tests/unit/follow-up-panel.test.tsx
# Add any consuming-file updates discovered during refactor:
# git add app/(app)/today/page.tsx (if banner was missing and added)
git status --short | grep -v '^??'
git commit -m "$(cat <<'EOF'
feat(comeback): refresh follow-ups panel to bundle design #11

Ports components/comeback/follow-up-panel.tsx to the design from
vyntechs-design-system/project/claude_code_handoff/v2_designs/
Screens-Phone-Followups.jsx#FollowupsPanel.

New structure:
- Editorial italic-serif preamble at top
- Resolvable-now section: Module per case with curator-quote accent
  backplate (amber-tinted bg, left-rule, curator name + relative
  time + projected-confidence callout)
- Still-deferred section for cases without published corpus yet
- Risk pill + est. time + resume → action per row

Prop contract unchanged. Tests updated for new DOM structure.

Refs spec: docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/follow-ups-panel-refresh
gh pr create --base main --head feat/follow-ups-panel-refresh \
  --title "feat(comeback): refresh follow-ups panel to bundle design #11" \
  --body "$(cat <<'EOF'
## Summary

Refreshes `components/comeback/follow-up-panel.tsx` to the bundle design (Screen #11 of the Anthropic design handoff). New editorial preamble + per-row curator-quote accent backplate + "Still deferred" section + risk pill + est. time + resume → action.

## Validation checklist — please read BEFORE merging

- [ ] Tests pass (`tests/unit/follow-up-panel.test.tsx`).
- [ ] No regression in other tests (`pnpm test`).
- [ ] Mobile viewport (375 px) renders correctly — compare to bundle reference `claude_code_handoff/screenshots/11-phone-followups.png`.
- [ ] Today page banner / entry point still routes to the panel correctly.
- [ ] No props changed — callers unaffected.

## Refs

- Rollout spec: `docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md`
- Bundle source: `claude_code_handoff/v2_designs/Screens-Phone-Followups.jsx#FollowupsPanel`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Checkpoint:** Brandon validates on Vercel preview. Phase 2 complete. Move to Phase 3.

---

## Phase 3 — PR C: Phone Outcome confirm refresh (Screen #12)

**Branch:** `feat/outcome-confirm-refresh` — cut from `origin/main` (NOT from PR B's branch).

**Goal of phase:** Refresh `components/screens/outcome-capture.tsx` to the bundle's `Screens-Phone-Followups.jsx#OutcomeConfirm` design. Editorial italic-serif AI question headline + timestamped procedure-step ledger + three outcome buttons (Fixed = primary amber / Partial = ghost / Couldn't verify = ghost) + mono caps "next state" footer. **Preserve any existing AI outcome-validator behavior** — the visual refresh adds calibration-loop closure on top, doesn't replace validation.

### Task C.1: Cut branch and run recon on the live screen

**Files to read (no modification yet):**
- `components/screens/outcome-capture.tsx`
- `tests/unit/outcome-capture.test.tsx`
- `lib/ai/outcome-validator.ts`
- `tests/unit/outcome-validator.test.ts`
- `app/(app)/sessions/[id]/outcome/page.tsx`
- `docs/superpowers/specs/2026-05-07-outcome-validator-deadend-design.md` (prior outcome design — confirm what to preserve)

- [ ] **Step 1: Cut a fresh branch from origin/main**

```bash
git fetch origin
git checkout -b feat/outcome-confirm-refresh origin/main
git log -1 --oneline
```

- [ ] **Step 2: Read the live screen + validator + their tests**

Use Read on each of the files above. Identify: (a) the current outcome shape (free-text + validator? trichotomy? something else?), (b) the AI validator integration points, (c) what data the screen POSTs on confirm (this is what feeds the calibration drift dashboard).

- [ ] **Step 3: Read the bundle's target design**

Re-read `/tmp/vyntechs-design-extract/vyntechs-design-system/project/claude_code_handoff/v2_designs/Screens-Phone-Followups.jsx` lines 123–249 (`OutcomeConfirm`). Compare with reference PNG `claude_code_handoff/screenshots/12-phone-outcome.png`.

- [ ] **Step 4: Identify the reconciliation strategy**

If current shape is **free-text + AI validator** (matches `outcome-validator.ts` existing): the bundle's three-button shape may COEXIST with validation — "Fixed" might still require a specific text confirmation that gets validated; "Partial" routes to a note sheet (with validation); "Couldn't verify" routes to defer-to-curator. **Decide and document inline:** preserve validator on the Fixed path, OR remove validator entirely. Default decision per spec: **preserve validation**, refresh visuals.

If current shape is already a button-based outcome: simpler — refresh visuals only.

### Task C.2: Update the tests RED — new DOM + preserved behavior

**Files:**
- Modify: `tests/unit/outcome-capture.test.tsx`

- [ ] **Step 1: Add a test for the headline question rendering**

Assert: renders an italic-serif `<h2>` with copy formatted as a question — exact copy is configurable per session but the rendering shape is fixed (serif, 26px, italic underline of supporting line).

- [ ] **Step 2: Add a test for the procedure-step ledger**

Assert: given a list of procedure steps (with `text` + `timestamp` + optional `attachment`), renders one row per step with a check glyph + serif text + mono timestamp.

- [ ] **Step 3: Add tests for the three outcome buttons**

Three separate tests:
- Renders "Fixed." button as primary (amber-filled).
- Renders "Partial — symptom returned." button as ghost.
- Renders "Couldn't verify — defer back to curator." button as ghost.
- Clicking "Fixed" triggers the existing outcome-confirm handler (or its validator-preserving wrapper).
- Clicking "Partial" or "Couldn't verify" routes to the appropriate next-step sheet (per reconciliation decision in C.1).

- [ ] **Step 4: Add a test for the mono caps footer**

Assert: renders the next-state footer with copy in the shape *"On confirm: corpus calibration ↑ · {tech-name} paged · WO closed"* in mono caps. Tech name pulled from session data.

- [ ] **Step 5: Run tests, confirm FAIL**

```bash
pnpm test outcome-capture --reporter=verbose 2>&1 | tail -30
```

Expected: new assertions fail. Note any pre-existing tests that now assert old DOM — those will need migration in C.3.

### Task C.3: Refactor the screen GREEN

**Files:**
- Modify: `components/screens/outcome-capture.tsx`
- Possibly modify: `app/(app)/sessions/[id]/outcome/page.tsx` (if the new component contract requires it)

- [ ] **Step 1: Port the bundle design**

Rewrite `outcome-capture.tsx` using the bundle's structure: VehicleStrip up top (existing component); editorial italic-serif eyebrow + headline + supporting line; Module "What you did" with timestamped procedure-step ledger; Module "Outcome" with three buttons (Fixed primary amber / Partial ghost / Couldn't verify ghost); mono caps next-state footer.

**Preserve outcome-validator integration** per the C.1 reconciliation decision: clicking "Fixed" still invokes the AI validator if it currently does so. If the validator rejects (per `lib/ai/outcome-validator.ts`), surface the rejection in the existing rejection UI — don't drop that behavior.

Reference: `Screens-Phone-Followups.jsx` lines 123–249.

- [ ] **Step 2: Run targeted tests, confirm GREEN**

```bash
pnpm test outcome-capture --reporter=verbose 2>&1 | tail -30
pnpm test outcome-validator --reporter=verbose 2>&1 | tail -20
```

Expected: outcome-capture tests pass; outcome-validator tests still pass (validator behavior preserved).

- [ ] **Step 3: Run full test suite to verify no regression**

```bash
pnpm test --reporter=dot 2>&1 | tail -20
```

Expected: no other test regresses.

### Task C.4: Mobile viewport visual verification

**Files:** none modified.

- [ ] **Step 1: Start dev server**

```bash
pnpm dev &
```

- [ ] **Step 2: Navigate to the outcome confirm screen and capture mobile screenshot**

Using Chrome DevTools MCP, sign in (use a test account that has an active session), navigate to `/sessions/[id]/outcome`. Resize to 375 × 812. Capture screenshot. Compare to bundle reference `claude_code_handoff/screenshots/12-phone-outcome.png`.

If a test session isn't easily available, render the component standalone via the design page route (`app/design/page.tsx` already exists per main's tree — verify it has an outcome-capture preview slot, or skip this step and rely on the test assertions + visual diff at PR review time).

- [ ] **Step 3: Stop dev server**

### Task C.5: Commit, push, open PR

- [ ] **Step 1: Stage and commit**

```bash
git add components/screens/outcome-capture.tsx tests/unit/outcome-capture.test.tsx
# Add page-level changes if any:
# git add "app/(app)/sessions/[id]/outcome/page.tsx"
git commit -m "$(cat <<'EOF'
feat(outcome): refresh outcome-confirm screen to bundle design #12

Ports components/screens/outcome-capture.tsx to the design from
vyntechs-design-system/project/claude_code_handoff/v2_designs/
Screens-Phone-Followups.jsx#OutcomeConfirm.

New structure:
- Editorial italic-serif headline question + supporting line
- "What you did" module: timestamped procedure-step ledger
- "Outcome" module: three buttons (Fixed primary amber, Partial
  ghost, Couldn't verify ghost)
- Mono caps next-state footer

Existing outcome-validator AI rejection behavior preserved — the
Fixed path still invokes the validator and surfaces rejection UI.
The bundle's design adds calibration-loop closure on top, doesn't
replace validation.

Refs spec: docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md
Refs prior outcome design: docs/superpowers/specs/2026-05-07-outcome-validator-deadend-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/outcome-confirm-refresh
gh pr create --base main --head feat/outcome-confirm-refresh \
  --title "feat(outcome): refresh outcome-confirm screen to bundle design #12" \
  --body "$(cat <<'EOF'
## Summary

Refreshes `components/screens/outcome-capture.tsx` to the bundle design (Screen #12 of the Anthropic design handoff). Editorial italic-serif headline + procedure-step ledger + three outcome buttons + mono caps next-state footer. Outcome-validator AI rejection behavior preserved on the "Fixed" path.

## Validation checklist — please read BEFORE merging

- [ ] `tests/unit/outcome-capture.test.tsx` passes.
- [ ] `tests/unit/outcome-validator.test.ts` still passes — validation behavior unchanged.
- [ ] No regression in other tests (`pnpm test`).
- [ ] Mobile viewport (375 px) renders correctly — compare to bundle reference `claude_code_handoff/screenshots/12-phone-outcome.png`.
- [ ] Clicking "Fixed" with an invalid free-text input still surfaces the AI validator rejection UI (no silent bypass).
- [ ] Clicking "Fixed" with valid input POSTs the calibration data point that feeds the drift dashboard.

## Refs

- Rollout spec: `docs/superpowers/specs/2026-05-15-design-bundle-rollout-design.md`
- Bundle source: `claude_code_handoff/v2_designs/Screens-Phone-Followups.jsx#OutcomeConfirm`
- Prior outcome design: `docs/superpowers/specs/2026-05-07-outcome-validator-deadend-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Checkpoint:** Brandon validates on Vercel preview. Phase 3 complete. All three PRs open.

---

## Self-review (run at end)

**Spec coverage:**
- PR A → Phase 1 ✓
- PR B → Phase 2 ✓
- PR C → Phase 3 ✓
- Each spec acceptance criterion has a corresponding task step (dimensions check, typecheck, tests, mobile validation, PR description content) ✓
- Out-of-scope items (standalone marketing folder, foundation token diff, curator viz refresh) stay out ✓

**Placeholder scan:**
- No "TBD", "TODO" in the plan body ✓
- Reconciliation steps in B.1 and C.1 are explicit instructions to read specific files and decide, not placeholders ✓
- Commit messages are written in full, not "fill in later" ✓
- PR body templates are written in full ✓

**Type consistency:**
- "outcome-confirm" / "outcome-capture" / "outcome-validator" — distinct things, used consistently. `outcome-capture` is the live component name; `outcome-confirm` is the bundle's screen name; `outcome-validator` is the existing AI validation lib. The plan keeps the codebase name (`outcome-capture.tsx`) when referencing files.
- Branch names: `staging-marketing-visuals` (existing), `feat/follow-ups-panel-refresh` (new), `feat/outcome-confirm-refresh` (new). Consistent.

**Architecture:** three sequential PR branches, each from `origin/main`, validated independently. ✓
