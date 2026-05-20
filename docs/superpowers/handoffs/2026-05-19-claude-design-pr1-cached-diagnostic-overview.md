# Claude Design Handoff — PR 1: Cached Diagnostic Overview

**For:** Claude Design instance (separate Claude session)
**From:** Brandon (Vyntechs founder, non-engineer)
**Context:** Phase 3 PR 1 of the orchestration build. Brandon will paste the section below into a fresh Claude Design session.

---

## What you're designing

A **cached diagnostic overview screen** for Vyntechs — the diesel-shop diagnostic tool.

The setup: in Phase 2 we built a knowledge base of diagnostic procedures for a 2017-2022 Ford Super Duty 6.7L Power Stroke Diesel (PSD). Three full diagnostics live in the database: **P0087** (fuel rail pressure too low), **P0088** (fuel rail pressure too high), and **no-start, cranks normally**.

PR 1 surfaces these to techs. When a tech enters a matching vehicle + complaint on the existing intake form, instead of waiting 30-60 seconds for AI to generate a diagnostic tree, the system pulls the cached one from the database and renders it instantly. This screen is what they see.

**PR 1 is the overview — the test list at a glance. Per-step interactive walk is PR 2 (separate).** Out of scope here: tech enters their reading, branch fires, route to next step. That's the next PR. PR 1 just shows the plan.

## The three pieces of UI

### 0. Intake form additions — the trigger surface

The existing intake form at `/sessions/new` (rendered by `components/intake/new-session-form.tsx`) gets two new pieces:

- A **DTC code(s) input** — optional, sits between engine and mileage. Tech types `P0087` (or multiple codes comma-separated) if they have a scan.
- A **"Common complaints for this vehicle" picker** — appears progressively after year/make/model/engine are filled. The form fetches cached symptoms for the resolved platform and renders them as clickable chips (e.g., `[ No-start cranks normally ]`). Tech picks one if it matches their case. If no chips fit, they continue to the free-text customer-complaint textarea as today.

Loading / empty states for the chip picker:
- **Loading** (after vehicle fields filled, fetch in flight): small inline loading indicator near where the chips will appear
- **Empty** (vehicle resolves but no cached complaints exist): the chip row simply doesn't appear — no "0 cached complaints" message; just absent
- **Vehicle unresolved** (year/make/model/engine doesn't match a known platform): same — chips don't appear

Design tenets carried into this:
- The chip picker is **self-disclosure** — it shows the tech what's cached for THIS truck without them having to know to ask. The first time Mac sees chips on his F-250 intake will be the first moment he understands "oh, we have these cases pre-built."
- The DTC field and chip picker are **independent signals** — tech can use either or both or neither. Free-text complaint still works as today.

### 1. Cached diagnostic overview (the main screen)

Renders for a matched vehicle + symptom. Tech sees:

- **Header** — vehicle (`2018 Ford F-250 · 6.7L Power Stroke Diesel`), matched symptom (`P0087 — Fuel Rail Pressure Too Low`)
- **Confidence gate marker** — the cumulative confidence threshold this diagnostic requires before it'll recommend a commit (varies by diagnostic; for P0087 it's 0.85)
- **Ordered test list** — each row is one diagnostic step. The data per row:
  - Priority number (1, 2, 3, …)
  - Test name (e.g., "Read Fuel Rail Pressure PID at idle")
  - Scenario chip (e.g., `IDLE` or `CRANKING` — same observable can require different tests under different operating conditions)
  - Observation method chip (`PID`, `VISUAL`, `AUDIBLE`, `SMELL`, `MEASUREMENT`, etc.)
  - Expected reading (e.g., "23,000–24,500 psi within 10s of start")
  - Invasiveness rating (1–5: 1 = read a PID, 5 = remove a part)
- **A "start the walk" call to action** — the button that takes the tech into the per-step interactive flow (PR 2 will build that flow; PR 1 stubs the destination)

**Volumes to design for:** P0087 has 13 tests, P0088 has 12, no-start has 19. So the list can be long — 8 to 20 rows. Should scan well on mobile (techs hold their phone over the fender).

### 2. Empty state — no cached diagnostic for this combo

Renders when the tech enters a vehicle + complaint we don't have cached.

- Don't make it feel like an error. The product premise is "AI builds once, library compounds" — the empty state is just "not built yet."
- One clear CTA: "Generate a diagnostic for this with AI." (PR 4 wires the actual generation — PR 1's empty state is the placeholder + the CTA.)
- Plain-English explanation of what'll happen when they click (1-2 short sentences: "We'll spend 30-60 seconds building a custom diagnostic for this. Future identical complaints will load instantly.")

## Brandon's leanings (open to push-back — these are starting points, not specs)

- **Mobile-first.** Techs use phones in the shop. Validate at 375px (iPhone SE-ish) before desktop polish.
- **The test list should answer "what do I do next?" at one glance.** Priority + test name + expected should be readable without scrolling within a row.
- **Confidence gate is visible but not scary.** It's there so the tech knows "no single test commits us" — not so they panic about percentages.
- **Empty state shouldn't read as failure.** It's the runway for AI to build something — feels like "first time we've seen this one" not "we don't know."
- **Invasiveness matters more than it sounds.** A 1 is "look at a screen," a 5 is "pull a head." Cheap tests should look visually cheap to commit to. Brandon wants this to be obvious without reading.
- The design system already in place (Workshop Instrument aesthetic, bone canvas, signal navy, Instrument Serif body face) should carry. **Don't redesign foundations.** Reuse `components/vt/` primitives where they fit — `ConfidenceBlock`, `DtcChip`, `Pill`, `AppHeader`, `Module`, etc.

Push back on any of these if you see a better path.

## Reference points in the repo

- **Design system foundations:** `app/globals.css` (look for `--vt-bone-*`, `--vt-graphite-*`, `--vt-signal-*` tokens and the comment block at top describing the aesthetic).
- **Existing primitives:** `components/vt/` — especially `confidence-block.tsx`, `dtc-chip.tsx`, `pill.tsx`, `app-header.tsx`, `module.tsx`, `tree-rail.tsx`.
- **Existing intake form (where this slots in after match):** `components/intake/new-session-form.tsx`.
- **Existing session view (current AI flow):** `app/(app)/sessions/[id]/page.tsx` and `components/screens/active-session.tsx`.
- **Past locked layout for a related surface (style reference, not direct precedent):** `docs/interactive-diagnostics/layouts/layout-meter.md`.

## What to deliver back

- Mockups of the two screens at mobile (375px) + desktop widths
- Component breakdown — which primitives to reuse from `components/vt/`, which new ones to add
- A short "design decisions you made" note covering anything Brandon's leanings didn't predetermine

Brandon will validate, then hand it back to the orchestrating Claude session to plan implementation (PR 1's code work — wiring the resolver, DB query, and rendering pieces).

## Integration point — locked

The cached overview surface intercepts the existing `/sessions/[id]` route. When the tech submits the intake form at `/sessions/new`, the server's `POST /api/sessions` handler checks the database for a cached diagnostic that matches `(vehicle → platform, complaint → symptom)`. On a **cache hit**, the new session row gets marked with a `cache-hit` routing state, the redirect lands on `/sessions/[id]`, and the page renders this cached overview screen instead of the AI tree-generation state. On a **cache miss**, today's AI flow runs unchanged — the tech sees the existing `tree-generating` loading state and lands on the AI-built tree.

Practical implication for the design:

- The overview screen sits inside the existing app shell (uses `AppHeader` with back navigation to `/sessions`).
- There's a small but meaningful UX moment at the redirect: the tech submits the form and **immediately** lands on the overview — no 30-60s loading state. The contrast with the AI loading screen ("Looking through past cases and pulling reference info. Usually 5-15 seconds.") matters. Make instant feel instant.
- The empty state (no cache hit, going to AI) is actually rendered **by the existing `TreeGenerating` screen** today — not by a new "empty state" screen on the cache side. So the PR 1 empty state design is more accurately "the not-yet-matched state of the cached overview surface, where we tell the tech we're about to ask AI to build one." It still ships in this PR, but it's a fallback panel inside the overview surface, not a separate page.

---

*This handoff was generated 2026-05-19 by the orchestrating Claude session during Phase 3 PR 1 brainstorming. The orchestrating session continues at `docs/superpowers/handoffs/2026-05-19-orchestration-phase-3-kickoff.md`.*
