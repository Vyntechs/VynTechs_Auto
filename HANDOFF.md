# HANDOFF — Topology gate fully wired; interactive diagnostic live on prod

**Last updated:** 2026-06-20
**Active branch:** none (all work merged to `main`)
**Main tip:** `00058e6` (PR #109 merged)

---

## WHAT SHIPPED THIS SESSION (all on `main`, verified merged)

| PR | Title | Status |
|---|---|---|
| #106 | Phase 1 beachhead — 6.7 PSD resolver + Gates A/B + citation chunking | MERGED earlier |
| #107 | Phase 3 topology gate — sessions route to graph when data exists | MERGED earlier |
| #108 | Hotfix — intake maxDuration 60→300 (real-shop 504 fix) | MERGED earlier |
| **#109** | **Fix intake topology gate + DTC extraction from complaint text** | **MERGED 13:34 UTC** |

---

## WHERE WE ARE

**The interactive diagnostic is now live and correctly wired for real users.**

**Bug that PR #109 fixed (two bugs, one commit):**
1. `/api/intake/submit` never called the platform/symptom resolvers — every session went straight to AI regardless of vehicle. The topology gate only existed in the older `/api/sessions` route, which the intake form doesn't use.
2. The session page passed only `complaintText` to `resolveSymptomSlug` — DTC codes embedded in complaint prose (e.g. "truck died, has p0087 low rail pressure") were never extracted, so the lookup returned null and fell to AI.

**What the session page routing looks like now (in order):**
1. Curator wizard interception — published curator flow for this vehicle/symptom → `CuratorGuidedWizard`
2. **Topology gate** — `loadSystemTopology` non-null → `TopologyDiagnostic`
3. AI wizard fallback — `ActiveSession`

**What routes to topology TODAY:**
- 2017-2022 F-250/350 6.7 PSD + `no-start-cranks-normally-fuel-system-suspect` slug
- Same trucks + complaint text containing "p0087" (now extracted via `extractDtcCodes`)
- Nothing else — no other topology data seeded yet

**What does NOT yet work:**
- 2011-2016 6.7 PSD + DEF/limp-mode — no graph data seeded (`ford-super-duty-3rd-gen-67-psd` platform row doesn't exist in topology tables)
- DTC-keyed routing for other codes — topology `symptoms` table uses descriptive slugs; resolver outputs bare codes for everything except p0087 (which now extracts from prose)

---

## IMMEDIATE NEXT STEP

**Task 3 — Seed 2011-2016 6.7 DEF system topology data (Brandon-gated)**

Plan: `docs/superpowers/plans/2026-06-20-phase3-topology-to-customers.md` → Task 3.

This is DATA authoring, not code:
1. Read the Phase-1 DEF research run (`f92e438e-f009-488a-adfa-8c67bb30da4a` in throwaway DB `cojmftuuukcsaxvcntls`)
2. Write seed SQL: `platforms` row for `ford-super-duty-3rd-gen-67-psd`, `symptoms` row for `reduced-power-limp-mode-emissions-suspect` (system = `emissions-def`), DEF system components + connections + test actions
3. Present SQL to Brandon → his go → apply via Supabase MCP to prod `ynmtszuybeenjbigxdyl`

**Also pending (lower priority):**
- Long-term async intake fix: tree gen + retrieval should fire async. The 300s cap (PR #108) is a band-aid; the `tree-generating` loading state already exists for this pattern.
- DTC slug mismatch (other codes): topology `symptoms` table uses descriptive slugs (`p0087-fuel-rail-pressure-too-low`); resolver outputs bare codes. Fix: either update topology symptom slugs to bare codes, or add a DTC-prefix expand step in the session page.

---

## HARD CONSTRAINTS

- **NEVER touch live DB `ynmtszuybeenjbigxdyl`** without Brandon's explicit go
- **NEVER merge to main** without Brandon's approval (main auto-deploys to vyntechs.dev + vyntechs.com)
- **Throwaway DB** `cojmftuuukcsaxvcntls` is safe to read/write; `.env.development.local` points to it
- **Prod DB migrations:** apply via Supabase MCP `apply_migration` only (not `drizzle-kit migrate`)

---

## RESUME PROMPT

```
Read HANDOFF.md in full and tell me where we left off.
```
