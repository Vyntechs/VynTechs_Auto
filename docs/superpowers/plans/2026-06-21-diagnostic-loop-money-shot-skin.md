# Diagnostic Loop — Money-Shot Skin (Instrument Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pair with the **frontend-design** skill throughout (screenshot-critique each visual task).

**Goal:** Reskin the live, honest diagnostic loop screen to the polished dark "pro scanner" look from Brandon's Figma money-shot — mobile-first — WITHOUT re-introducing any of the three elements he killed (confidence badge, fabricated tech-count, "N causes" counter), and WITHOUT touching the diagnostic engine.

**Architecture:** Pure visual layer. The honest engine (`lib/diagnostics/diagram/*`) and the data it produces are untouched. We (1) add a **dark "instrument-mode" token scope** under the `.topo` root only — so the rest of the warm "bone" app is unaffected and the change is fully reversible; (2) restructure the loop screen into mobile-first regions matching the Figma (header bar → dark circuit canvas → bottom-sheet check console → answer card); (3) recolor the existing **data-driven** diagram-kit templates to the dark instrument palette (we apply the Figma's visual *language* to the real scalable schematic — we do NOT hardcode the Figma's one hand-drawn PCM↔FRP case).

**Tech Stack:** Next.js App Router, vanilla CSS with `--vt-*` custom properties (NO Tailwind), `next/font` (Inter Tight + JetBrains Mono already loaded), SVG diagram templates on a scaled fixed stage. Local browser verification via a Node `@playwright/test` script (see Global Constraints).

## Global Constraints

- **HONEST-ONLY (hard invariant, project memory `no-user-facing-confidence`).** The rendered loop must NEVER show: any confidence percent/word/badge; any "high confidence" cue; any fabricated "N techs / field match" count; any "N causes in play / N left" count or fixed-denominator progress that implies a known cause-count. Verbatim killed strings to never render: `HIGH CONFIDENCE`, `confirmed by N techs`, `techs saw this`, `field confirms`, `causes in play`, `causes left`, `CAUSES LEFT`.
- **Prior-fix count** ("N shops fixed it this way") renders ONLY when `priorFixCount > 0` (real data); otherwise the element is omitted and its column collapses gracefully. Never fabricate it.
- **Progress is worded, never numbered:** the worded states `Narrowing it down` → `Getting clearer` → `Answer found` are allowed (no numbers). A segmented/indeterminate momentum affordance is allowed ONLY if it carries no denominator/count.
- **Suppression over fabrication:** if the curator didn't author a half (no expected value, no branch routing, no safety note), omit that element — never invent placeholder content.
- **Scope the dark palette to `.topo` only.** Do not change `app/globals.css` `:root` tokens or any other screen's appearance. The warm "bone" identity stays everywhere else; the diagnostic tool is dark "instrument mode" by deliberate design.
- **Do NOT touch logic files:** `lib/diagnostics/diagram/*` (confidence, progress-line, show-rule, slot-interface, slot-resolver, step-sequence, verdict-from-reading, verdict-gate, verdict-vocab), `lib/diagnostics/load-system-topology.ts`, `components/diagram-kit/templates/registry.ts` (wiring only). Preserve the screen's props contract exactly.
- **Preserve the props contract** of `TopologyDiagnostic`: `{ topology, layout, vehicleName, sessionId, symptoms, activeSymptomSlug, priorFixCount? }`. Both call sites (`app/(app)/sessions/[id]/page.tsx`, `app/curator/topology/*`) keep working.
- **Local browser verify:** glob `~/Library/Caches/ms-playwright/chromium_headless_shell-*` and pass it as `executablePath` (memory `local-browser-verification`); log in as `e2e@vyntechs.com` (pwd in `.env.local`); drive at a 430px viewport.
- **Mobile-first.** Design at 430px; enhance up. Quality floor: visible keyboard focus, `prefers-reduced-motion` respected, tap targets ≥ 44px.

---

## Design Direction (the token system — derived from the Figma, not invented)

**Palette (dark instrument):** bg `#0e1116`, diagram-surface `#12161c`, sheet-surface `#161b22`, node-fill `#1c232c`, your-reading-fill `#212832`, border `#333c48`, sheet-edge `#2a323d`. Semantic: accent-blue `#3b9eff` (active/primary), success-green `#4cce87`, fault-red `#ff5c54`, warning-amber `#fabf4d`, wire-grey `#8c99a8`. Text: primary `#f2f5f7`, secondary `#98a4b3`, muted `#6b7585`. Active-wire glow `0 0 10px 1px rgba(59,158,255,0.6)`. (Full alpha/tint table lives in the design-spec note attached to this plan; reproduce those values.)

**Type:** Inter Tight (`--font-inter-tight`) for chrome/labels; **JetBrains Mono** (`--font-jetbrains-mono`) for readings, voltages, expected values, ranges — it is already the app's measurement face and is a perfect fit. No new fonts. Instrument Serif is NOT used in instrument mode. Scale (key roles): screen title 18/600; vehicle 12.5/500; eyebrow 11/700 ls .88; big EXPECTED number 30/800 (mono); your-reading 23/700 (mono); section eyebrow 10.5/700 ls .84; body 13.5/500.

**Radii (scoped instrument exception):** sheet top `22px`, nodes `13px`, EXPECTED/reading cards `12px`, routing rows `10px`, pills/tags `7px`. This intentionally departs from the app's tight "no pillows" convention — it is the brief's look, scoped to `.topo` only.

**Signature element (the one memorable thing):** the **probed wire lights up and shows its live reading** — the active wire goes full-opacity with the blue glow, its voltage pill fills with the live/expected value, and on the answer the fault wire snaps to red with an "open feed" tag. Everything else stays quiet and dim. This is the moment the diagram *is* the diagnosis.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `components/topology/topology.css` | `.topo` dark token scope; mobile-first region layout (header bar, canvas, console sheet, answer); all `.topo*` restyles | Modify (large) |
| `components/diagram-kit/diagram-kit.css` | Wire/part/pill colors → dark tokens; active-wire glow | Modify |
| `components/diagram-kit/templates/templates.css` | Template-level part/label/pill treatment in dark mode | Modify |
| `components/diagram-kit/diagram-mobile.css` | Meter sheet dark + mobile detents | Modify |
| `components/diagram-kit/meter.css` | Gauge visual in dark | Modify |
| `components/screens/topology-diagnostic.tsx` | Region restructure: header bar; console as the primary bottom sheet; relocate dock controls (symptom/scenario/whole-system) into a compact header control | Modify |
| `components/topology/reading-entry.tsx` | Rebuild into the Figma console anatomy (grabber, ask row + key-state tag, instruction, safety strip, EXPECTED\|YOUR-READING, routing list, source, skip) | Modify |
| `components/topology/progress-line.tsx` | Ruled-out line styled for the dark sheet | Modify |
| `components/topology/verdict-panel.tsx` | Answer-card anatomy (Found it + verdict sentence + YOUR CHECKS N/N + FIX/THEN + source; NO badge/count) | Modify |
| `components/topology/loop-header.tsx` | NEW: pinned header bar (back + title + vehicle + worded progress eyebrow + control button) | Create |
| `components/topology/key-state-tag.tsx` | NEW: the "KEY ON · ENGINE OFF" tag derived from `step.scenarioRequired` | Create |
| `tests/unit/topology-honest-only.test.tsx` | NEW: asserts no killed strings render in any loop state | Create |

**Untouched (logic):** all `lib/diagnostics/diagram/*`, `lib/diagnostics/load-system-topology.ts`, `components/diagram-kit/templates/registry.ts` and the template SVG geometry components.

---

## Task 1: Dark instrument-mode token scope

**Files:**
- Modify: `components/topology/topology.css` (top of file, the `.topo` rule ~`:19-56`)

**Interfaces:**
- Produces: a `.topo { … }` block overriding `--vt-bg`, `--vt-surface`, `--vt-fg`, `--vt-rule`, `--role-signal`, `--role-12v`, `--role-ground` with the dark palette, plus new `--instr-*` tokens (`--instr-sheet`, `--instr-node`, `--instr-reading-fill`, `--instr-edge`, `--instr-blue`, `--instr-green`, `--instr-red`, `--instr-amber`, `--instr-wire`, `--instr-text`, `--instr-text-2`, `--instr-text-muted`, `--instr-glow`) consumed by all later tasks.

- [ ] **Step 1:** Add the dark token overrides + `--instr-*` definitions scoped under `.topo` (verbatim hex from Design Direction). Do NOT edit `app/globals.css`.
- [ ] **Step 2:** Verify scope isolation — load `/curator` (the bone shell) and confirm it is still warm/light; load `/curator/topology` and confirm the canvas background is now `#0e1116`.

Run: launch dev (`npx next dev -p 3210`), screenshot both routes at 430px.
Expected: `/curator` unchanged warm; `.topo` dark.

- [ ] **Step 3:** Commit. `git commit -m "feat(loop-skin): add scoped dark instrument-mode token layer"`

---

## Task 2: Honest-only guard test (write FIRST, keep red until the UI is honest)

**Files:**
- Create: `tests/unit/topology-honest-only.test.tsx`

**Interfaces:**
- Consumes: `TopologyDiagnostic` + a seeded test `topology` fixture (reuse the one in `tests/unit/topology-diagnostic-assembled.test.tsx`).

- [ ] **Step 1: Write the failing test.** Render `TopologyDiagnostic` in three states (initial check, after a reading, after close), and assert the rendered text contains NONE of: `/high confidence/i`, `/confirmed by \d+ techs/i`, `/techs saw this/i`, `/field confirms/i`, `/field match/i`, `/causes? (in play|left)/i`, `/\d+%/`. Also assert: when `priorFixCount={0}` no "shops fixed" line renders; when `priorFixCount={7}` it does.

```tsx
// pseudocode shape
const KILLED = [/high confidence/i, /confirmed by \d+ techs/i, /techs saw this/i,
  /field (confirms|match)/i, /causes? (in play|left)/i, /\d+%/]
for (const re of KILLED) expect(container.textContent).not.toMatch(re)
```

- [ ] **Step 2:** Run it. Run: `npx vitest run tests/unit/topology-honest-only.test.tsx`. Expected: PASS for the current screen (it is already honest) — this test is a REGRESSION GUARD that must stay green through every later task.
- [ ] **Step 3:** Commit. `git commit -m "test(loop-skin): honest-only regression guard for the loop UI"`

---

## Task 3: Pinned header bar + worded progress (no count)

**Files:**
- Create: `components/topology/loop-header.tsx`
- Modify: `components/screens/topology-diagnostic.tsx` (replace the `.topo__dock-head` block + relocate Back), `components/topology/topology.css`

**Interfaces:**
- Produces: `<LoopHeader title vehicleName platformName progressLabel onToggleWholeSystem showingWholeSystem />`. `progressLabel` is derived in the screen: before any check → `Narrowing it down`; after ≥1 confirmed and not closed → `Getting clearer`; closed+gate → `Answer found`; closed+handoff → `Checks complete`. NO numbers.

- [ ] **Step 1:** Build `LoopHeader` — back chevron (Link to `/curator`), title (`formatSymptomTitle(topology.symptom.slug)`), vehicle line (`${vehicleName} · ${topology.platform.name}`), worded progress eyebrow (colored: blue→blue→green), and a compact control button (opens the symptom/scenario controls — Task 7). Style per Design Direction; pin `position: sticky/absolute; top:0` over the canvas.
- [ ] **Step 2:** Wire `progressLabel` derivation in `topology-diagnostic.tsx` from existing state (`confirmedCount`, `closed`, `gateReached`). Add NO new engine calls.
- [ ] **Step 3:** Verify honest-only test still passes + screenshot the header at 430px vs Figma L1/L2/L3 headers (minus the killed count). Run: `npx vitest run tests/unit/topology-honest-only.test.tsx`.
- [ ] **Step 4:** Commit. `git commit -m "feat(loop-skin): pinned header with worded progress (no count)"`

---

## Task 4: Dark circuit canvas — recolor the data-driven templates

**Files:**
- Modify: `components/diagram-kit/diagram-kit.css`, `components/diagram-kit/templates/templates.css`, `components/topology/topology.css` (`.topo__assembled`, `.topo__stage`)

**Interfaces:**
- Consumes: existing `dk-part[data-tier|data-active|data-provenance]`, `dk-wire[data-role]` attributes (unchanged — styling only).

- [ ] **Step 1:** Recolor canvas + parts + wires to instrument tokens: canvas `--vt-bg`/`#12161c`; node fills `#1c232c`, borders `#333c48`, labels `--instr-text`; inactive wires `opacity .34`; active wire (`[data-active]`) full opacity + `--instr-glow`. Voltage/value pills → tinted bg+border+bold colored text per role (blue active, grey/dim inactive, red fault). This applies to ALL templates (data-driven) — every case gets the dark look, not just the Figma one.
- [ ] **Step 2:** Style the probe callout + fault treatment (red wire + "open feed"-style tag) using existing template hooks where present; if a hook is missing, note it for the curator rather than hardcoding geometry.
- [ ] **Step 3:** Verify: load P0087 at 430px, screenshot the canvas, compare wire/pill/glow treatment to Figma L1. Confirm honest-only test green.
- [ ] **Step 4:** Commit. `git commit -m "feat(loop-skin): dark instrument canvas — recolor data-driven templates"`

---

## Task 5: Bottom-sheet check console (the rich rebuild)

**Files:**
- Modify: `components/topology/reading-entry.tsx`, `components/topology/progress-line.tsx`, `components/topology/topology.css`
- Create: `components/topology/key-state-tag.tsx`

**Interfaces:**
- Consumes: `step: TopologyTestAction` (`.description`, `.scenarioRequired`, `.expectedValue/.expectedUnit/.expectedTolerance`, `.branches[]` with `{condition, verdict, nextAction, reasoning}`), `onSubmit`, `onSkip`.
- Produces: `<KeyStateTag scenario={step.scenarioRequired} />` → "KEY ON · ENGINE OFF" style label; null when `scenarioRequired === 'none'`.

- [ ] **Step 1:** Restructure `ReadingEntry` into the Figma console anatomy as a bottom sheet: grabber → ask row (status dot + `step.description` title + `KeyStateTag`) → instruction (omit if absent) → safety strip (only if the step carries a safety note; else omit) → **EXPECTED\|YOUR-READING** two-column when `expectedValue != null` (mono number + unit + tolerance range | input), ELSE the three tap-outcome buttons (Matches / Borderline / Out of spec) — keep the honest degrade → **routing list** from `step.branches` ("If it reads wrong — where I'll take you": each branch's value-chip + `nextAction`/`reasoning`), omit entirely if no branches → **source line** (`Source: <provenance>` — NO tech count) → skip link.
- [ ] **Step 2:** Style `ProgressLine` (the ruled-out line) for the dark sheet (green ✓ + secondary text).
- [ ] **Step 3:** Verify honest-only test green (the source line must have NO "confirmed by N techs"); screenshot the console vs Figma L1 (numeric) AND a prose-only step (tap mode) to confirm the degrade.
- [ ] **Step 4:** Commit. `git commit -m "feat(loop-skin): bottom-sheet check console matching the money-shot"`

---

## Task 6: Answer card (honest verdict)

**Files:**
- Modify: `components/topology/verdict-panel.tsx`, `components/topology/topology.css`

**Interfaces:**
- Consumes: `{ mode, confirmedCount, priorFixCount, direction: {reasoning, nextAction} | null, onRunAgain }` (unchanged props).

- [ ] **Step 1:** Rebuild the card to the Figma answer anatomy MINUS the killed bits: ask row = dot + ("Found it" | "Checks complete") with **NO confidence badge** → verdict sentence (`direction.reasoning` or honest fallback) → result block: left `YOUR CHECKS {confirmedCount}/{confirmedCount}` "all line up" (green, mono); right column = prior-fix line "{priorFixCount} shops fixed it this way" ONLY if `priorFixCount > 0`, else the left column goes full-width → `RECOMMENDED NEXT`: FIX row (`direction.nextAction`) + THEN row (re-test) → source line (no count) → "Run again".
- [ ] **Step 2:** Verify honest-only test green for BOTH `priorFixCount={0}` (no second column, no count) and `={7}` (honest line shows). Screenshot vs Figma L3 with the badge + field-match removed.
- [ ] **Step 3:** Commit. `git commit -m "feat(loop-skin): honest dark answer card (no badge, no fabricated count)"`

---

## Task 7: Relocate dock controls + mobile-first layout pass

**Files:**
- Modify: `components/screens/topology-diagnostic.tsx`, `components/topology/topology.css`, `components/diagram-kit/diagram-mobile.css`, `components/diagram-kit/meter.css`

- [ ] **Step 1:** Move the symptom switcher, `ScenarioBar` (ignition/fault), and whole-system toggle out of the old left dock into the header control affordance (a compact menu/sheet opened from `LoopHeader`). Remove the old `.topo__dock` left-rail framing.
- [ ] **Step 2:** Set the mobile-first stack at 430px: header (top) → canvas (fills) → console sheet (bottom, ~46dvh, draggable detent) → answer overlays canvas on close. Enhance to wider screens (canvas grows; console can dock right or stay bottom — keep it simple, bottom is fine).
- [ ] **Step 3:** Recolor MeterSheet + Meter to instrument tokens.
- [ ] **Step 4:** Accessibility pass: visible focus rings on all controls/inputs; `@media (prefers-reduced-motion: reduce)` disables the wire glow pulse + sheet slide; tap targets ≥44px.
- [ ] **Step 5:** Verify: full 430px walkthrough screenshots (first check → reading → ruled-out → answer) vs Figma L1/L2/L3; honest-only test green; `npx tsc --noEmit` clean on touched files; `npx vitest run tests/unit/topology-diagnostic-assembled.test.tsx tests/unit/topology-honest-only.test.tsx` green.
- [ ] **Step 6:** Commit. `git commit -m "feat(loop-skin): mobile-first layout + relocated controls + a11y"`

---

## Task 8: End-to-end browser verification + Brandon gut-click handoff

**Files:** none (verification only)

- [ ] **Step 1:** Node `@playwright/test` script: `executablePath` from the ms-playwright cache glob; log in as `e2e@vyntechs.com`; navigate `/curator/topology?symptom=p0087-fuel-rail-pressure-too-low` at 430×932; capture: initial console, after a numeric reading, after a tap-outcome, the ruled-out line, and the answer card. Save screenshots to `/tmp/loop-skin-*.png`.
- [ ] **Step 2:** Side-by-side the captures with Figma L1/L2/L3. Confirm: dark instrument look matches; NONE of the three killed elements present; prose-only steps degrade to tap mode; rest of app still bone (spot-check `/curator`).
- [ ] **Step 3:** Report to Brandon with the screenshots for his gut-click on the dark version. Do not merge to main (stays on `feat/diagnostic-loop`).

---

## Self-Review

- **Spec coverage:** header (T3) · dark canvas (T4) · console (T5) · answer (T6) · controls+mobile+a11y (T7) · honest-only (T2 + every task's gate) · scoped dark tokens (T1) · e2e (T8). All Figma regions covered; all three killed elements explicitly omitted with honest replacements.
- **Logic untouched:** no task edits `lib/diagnostics/**` or the template registry/geometry; props contract preserved.
- **Open sub-decisions flagged for Brandon (do not silently resolve the first one):**
  1. **Dark instrument-mode is scoped to the loop only** (the rest of the app stays warm/bone). The diagnostic tool will look intentionally different from the curator/marketing surfaces. Confirm this "the scanner is dark, the office is light" split, or say if you want the whole app dark (much larger, separate plan).
  2. Larger "pillow" radii inside `.topo` intentionally break the app's tight-radius convention — acceptable as a scoped instrument exception.
  3. We apply the Figma's visual *language* to the existing data-driven schematic (every case gets the dark look) rather than hardcoding the one Figma circuit — this is the resilient/scalable choice.
