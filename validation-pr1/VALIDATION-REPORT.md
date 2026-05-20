# Phase 3 PR1 — Live UI Validation Report

**Date:** 2026-05-20
**Branch:** `feat/phase3-pr1-platform-resolver` (draft PR #81)
**Method:** Signed into the real app as Brandon (magic-link via the project's
own admin key — no password reset, no new account), drove the actual
authenticated flow with Playwright against the live Supabase data, screenshotted
every surface at mobile/tablet/desktop widths.

## Verdict

The earlier code review called PR1 "merge-ready." It was not. Code review checked
logic against the plan; the plan's sketches assumed clean data shapes. Driving the
real UI surfaced **7 genuine bugs** — one of them broke a headline feature
entirely. All 7 are now fixed, committed, and re-verified live.

---

## Bugs found and fixed

| # | Severity | Bug | Fix | Evidence |
|---|----------|-----|-----|----------|
| 1 | **High** | Intake "common complaints" chips and the cached-overview headline rendered the full 200-character scenario paragraph instead of a short label | New `symptomLabel()` helper humanizes the symptom slug (`p0087-fuel-rail-pressure-too-low` → `P0087 — Fuel rail pressure too low`) | `val-intake-1280-chips-BEFORE.png` vs `val-FINAL-intake-375.png`; `val-overview-1280-top-BEFORE.png` vs `val-FINAL-overview-1024.png` |
| 2 | **High** | The DTC field on the intake form never produced a cache hit. The resolver compared the bare code `p0087` against descriptive slugs like `p0087-fuel-rail-pressure-too-low` with an exact match — so typing a DTC silently fell through to a 30-60s AI generation every time | Resolver now matches a DTC against `slug = code OR slug starts with code-`. Unit tests rewritten with realistic descriptive slugs (they were self-consistent with fake `p0087` slugs before, which is why this was missed) | Live: typing `P0088` → cache hit in **1.5s** (session `035307a4`, resolved `p0088-fuel-rail-pressure-too-high`, 0 AI nodes). Same path pre-fix → cache miss, 9 AI nodes (session `ab9cd071`) |
| 3 | Medium | Cached-overview test rows were keyed by `priority`, which is not unique → React "duplicate key" console errors, risk of mis-rendered rows | Key by array index | Console: 6 errors before → **0 errors** after |
| 4 | Low | "expect" label ran straight into the reading text: `EXPECTFuel gauge needle...` | Explicit space between label and text | `EXPECT Fuel gauge needle...` confirmed live |
| 5 | Medium | Method chips showed raw enum strings (`SCAN_TOOL_PID`, `ELECTRICAL_MEASUREMENT_AT_PIN`) — the icon map keys didn't match any real data value, so every chip got the fallback icon | Remapped `MethodChip` to the 9 real `observation_method` values with short Title-Case labels + correct icons | Chips now read "Scan PID", "Visual", "Pin measure" |
| 6 | Medium | The "matched symptom" chip showed the entire slug `P0087-FUEL-RAIL-PRESSURE-TOO-LOW` | `dtcDisplay` extracts just the leading DTC code | Chip now reads `P0087` |
| 7 | Low | "1 prior fixes" / "1 corpus matches" — count of 1 not singularized | Pluralization on all 4 spots (mobile + desktop) | "1 prior fix" / "1 corpus match" |

## Commits (on `feat/phase3-pr1-platform-resolver`)

- `efc4b03` — Bug 2 (DTC resolver + tests)
- `383f9d9` — Bug 1 (symptom-label helper + picker + overview)
- `733f9fe` — Bugs 3+4+5 (row keys, method chips, expect spacing)
- `69c9fc9` — Bug 6 (DTC chip)
- `582c784` + `c333a1d` — Bug 7 (pluralization)

## What was confirmed WORKING (no fix needed)

- Sign-in, intake form layout, vehicle fields, the cached-complaint chip picker fetch + debounce.
- Cache **hit** end to end: F-250 6.7 PSD + chip/DTC → instant cached-overview, no AI wait.
- Cache **miss**: a non-cached vehicle still runs the normal AI flow (verified — 9-node tree generated, normal active-session screen).
- The cached-overview screen — mobile ledger + desktop table layouts, scenario chips, invasiveness dots, confidence gate, the disabled "Start diagnosis" CTA.
- Mobile (375px) through desktop (1440px) — all layouts hold.

## Test evidence

- The `symptom-resolver` unit tests were rewritten to seed **realistic descriptive slugs**. Against the old resolver the DTC test returns `null` (the bug); against the fix it resolves `p0087-fuel-rail-pressure-too-low`. This test would have caught Bug 2.
- `pnpm tsc --noEmit` — clean.
- Full `pnpm test` regression — see final summary.

## Test sessions created during validation (cleanup note)

Three sessions were created in the live DB exercising the flow. They sit in the
open-session queue and can be closed/deleted at will:
- `ab9cd071-7b70-4c2f-9fee-ae399d345dae` — cache-miss AI session (pre-fix evidence)
- `3f4590af-37dc-4d38-a8f9-be626532e747` — cache-hit (P0087) — **viewable: this is the real cached-overview screen**
- `035307a4-3dc8-42b1-a61e-c755def0647b` — cache-hit (P0088, DTC-path) — Bug 2 fix evidence
