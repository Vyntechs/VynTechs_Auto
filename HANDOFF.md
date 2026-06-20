# HANDOFF — Phase 3 topology gate + hotfix shipped; data seeding is next

**Last updated:** 2026-06-20
**Active branch:** `revert/pr-96-6.0-psd-canonical-seed` (root worktree — stale, nothing active here)
**Main tip:** `3236f01` (PR #108 hotfix merged)

---

## WHAT SHIPPED THIS SESSION (all on `main`, verified merged)

| PR | Title | Status |
|---|---|---|
| #106 | Phase 1 beachhead — 6.7 PSD resolver + Gates A/B + citation chunking | MERGED 05:00 UTC |
| #107 | Phase 3 topology gate — sessions route to graph when data exists | MERGED 12:29 UTC |
| #108 | Hotfix — intake maxDuration 60→300 (real-shop 504 fix) | MERGED 12:38 UTC |

---

## WHERE WE ARE

**The session page now has three gates (in order):**
1. Curator wizard interception — published curator flow for this vehicle/symptom → `CuratorGuidedWizard`
2. **Topology gate (NEW, PR #107)** — `loadSystemTopology` non-null → `TopologyDiagnostic`
3. AI wizard fallback — `ActiveSession`

**What routes to topology TODAY (existing prod data):**
- 2017-2022 F-250/350 6.7 PSD + `no-start-cranks-normally-fuel-system-suspect` slug (must be set via curator UI or explicit slug — free-text complaint routing to this slug is a dead branch by design)
- Nothing else has topology data seeded yet

**What does NOT yet work:**
- 2011-2016 6.7 PSD + DEF/limp-mode — no graph data seeded (`ford-super-duty-3rd-gen-67-psd` platform row doesn't exist in topology tables)
- DTC-keyed routing (e.g. P0087) — resolver outputs `p0087` but topology DB has `p0087-fuel-rail-pressure-too-low` (slug mismatch → falls through to AI, safe)

---

## IMMEDIATE NEXT STEP

**Task 3 — Seed 2011-2016 6.7 DEF system topology data (Brandon-gated)**

Plan: `docs/superpowers/plans/2026-06-20-phase3-topology-to-customers.md` → Task 3.

This is DATA authoring, not code:
1. Read the Phase-1 DEF research run (`f92e438e-f009-488a-adfa-8c67bb30da4a` in throwaway DB `cojmftuuukcsaxvcntls`)
2. Write seed SQL: `platforms` row for `ford-super-duty-3rd-gen-67-psd`, `symptoms` row for `reduced-power-limp-mode-emissions-suspect` (system = `emissions-def`), DEF system components + connections + test actions
3. Present SQL to Brandon → his go → apply via Supabase MCP to prod `ynmtszuybeenjbigxdyl`

**Also pending (lower priority):**
- Long-term async intake fix: tree gen + retrieval should fire async (create session → return → generate in background). The hotfix (300s cap) is a band-aid; the `tree-generating` loading state already exists for this pattern.
- DTC slug mismatch: topology `symptoms` table uses descriptive slugs (`p0087-fuel-rail-pressure-too-low`); resolver outputs bare codes (`p0087`). Fix: either update topology symptom slugs to bare codes, or add a DTC-prefix expand step in the session page.

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
