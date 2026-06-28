# HANDOFF — LIVE-VALIDATION SESSION: real shop trucks → field-case library → Ram recognition built. Escalade diagnosis IN PROGRESS.

**Last updated:** 2026-06-22 (Brandon ran real trucks through the tool as live validation while working his actual shop day)
**Work branch:** `feat/diagnostic-loop` — HEAD `eac4076`. **Uncommitted working-tree changes** (see below). NOT committed, NOT merged, NOT deployed.

## WHAT THIS SESSION WAS
Brandon validated the diagnostic tool against **real trucks in his own bay**, feeding cases as he diagnosed them. The big reframe he drilled in: **his field data is FUEL to grow coverage toward predicting/pre-filling what he'll see — NOT a "should we cover this" fork.** Capture every case, structure it, build coverage from his reality. (Lesson + memory recorded.)

## SCOREBOARD: 3 real trucks, 0 inside current coverage
The tool today only covers **Ford 6.7/6.0 PSD diesel** fuel concerns. All three real trucks fell outside it — which is the validation *working* (it honestly has nothing for them) and the ranked map of what to seed next.

1. **2024 Ram 3500 6.7 Cummins (recently un-deleted)** — root cause: **DEF (reductant) supply line physically broken/separated.** Was OUT → now **RECOGNIZED** (resolver emits `ram-heavy-duty-5th-gen-67-cummins`). Open Q to Brandon: did the U0140/U0422 comm codes clear when the line was fixed, or separate? → `docs/field-cases/2026-06-22-ram-3500-67-undeleted-def-line.md`
2. **~2011/12 Ram 3500 6.7 Cummins (68RFE)** — TCC won't lock under load → trans over-temp; converter already replaced by prior shop. **RECOGNIZED** (`ram-heavy-duty-4th-gen-67-cummins`). Flow completes when Brandon **pins the apply-side cause** (solenoid / valve-body / pressure / wiring / control). → `docs/field-cases/2026-06-22-ram-3500-67-68rfe-tcc-overtemp.md`
3. **2019 Cadillac Escalade 6.2 gas — IN PROGRESS (the active diagnosis).** Intermittent ABS warning (not active now). Codes: **EBCM U0422-71** (invalid serial data from BCM) + **BCM C0750/55/60/65-03** (4 TPMS corner sensors, -03=low voltage; C0760=LR, C0765=RR) + **C0775** (TPMS system). OUT of coverage (Cadillac, resolver null). → `docs/field-cases/2026-06-22-cadillac-escalade-2019-network.md`

## IMMEDIATE NEXT STEP (resume here)
**The Escalade is mid-elimination and waiting on Brandon.** Elimination state:
- ✅ **Wheel speed sensors RULED OUT** — all four clean, tracking together, no dropout at any speed → the ABS light is NOT a brake-input fault; it's the EBCM reacting to the U0422 (data/network), exactly as the verified read predicted.
- ⏳ **OPEN: one cause vs two.** Is it ONE shared **BCM data-path** fault (power/ground or the SDGM gateway/connectors corrupting traffic — the leading read, MEDIUM confidence) OR are the **4 TPMS sensors genuinely weak** (-03 = low voltage; 6-7yr-old truck on likely-original sensors = real competing answer) plus a separate network gremlin?
- **The splitting test (Brandon to run):** trigger each wheel's TPMS sensor with his tool while watching live data. All four answer good at the wheel but BCM shows them missing/invalid → **one cause, upstream** (go to BCM power/grounds + SDGM software PI/TSB). One+ genuinely weak at the wheel → **two problems.** When Brandon reports what the sensors do at the wheel, lock the root cause + update the case doc's elimination log.

Doctrine flagged (GM): on U0422, fix the source/network — do NOT lead by replacing the EBCM (the reporter), BCM, or sensors; check for a BCM/SDGM software update first.

## WHAT GOT BUILT THIS SESSION
- **Ram HD 6.7 Cummins resolver recognition** (`lib/diagnostics/resolve-platform.ts`). Recognizes Ram/Dodge 2500/3500/4500/5500 6.7 Cummins: 2010–2018 → `ram-heavy-duty-4th-gen-67-cummins`, 2019–2025 → `ram-heavy-duty-5th-gen-67-cummins`. **TDD, 15 new tests, all 75 pass, tsc clean, Ford regressions intact.** Flipped the old deliberate "Ram→null" guard test to the new behavior. **⚠️ Branch-only, MUST NOT MERGE until content is seeded behind those slugs** — else a real Ram session resolves to an empty flow (the dead-gate trap).
- **Field-case library** at `docs/field-cases/` — README (capture schema + the verified case→coverage "on-ramp") + the 3 case files above. This is the growing seed-source material.
- **On-ramp recon** (in the README): to turn one captured case into live coverage you author DB rows — `platforms` + resolver code, `symptoms`, `components`/connections/pins, `test_actions` (the checks), `branch_logic` (the routing), `symptom_test_implications` (the chain the coverage gate counts). Every row carries `source_provenance` and **FIELD-VERIFIED is the highest tier** — Brandon's real cases outrank AI-guessed data. **`platform_equivalents`** (per-system) is the reuse shortcut (answers the open "is 2011-16 Ford 6.7 fuel == 2017-22" question).

## TEED UP, NOT STARTED — first content authoring
The **2024 Ram DEF flow** is the cleanest first case to seed (it has a confirmed root cause, minimal fabrication risk — visual/physical inspection chain). Plan: draft it from Brandon's real findings **for his verify**, then it goes live WITH the resolver recognition (so the slug has content behind it). **Never fabricate diagnostic specs/readings — FIELD-VERIFIED means Brandon verified it.**

## HARD CONSTRAINTS / INVARIANTS
- **Honest-only:** never fabricate a check, expected reading, or spec. Field-verified content must trace to Brandon's real findings. (No percent/confidence/fake counts either — prior invariant still holds.)
- **Ram recognition stays branch-only** until content lands behind the slugs.
- **Don't dev during Brandon's workday** unless he says so; he feeds cases as he works.
- Branch only — no commit/merge/deploy without his OK.
- Don't touch the diagnostic engine internals (`lib/diagnostics/diagram/*`, `load-system-topology.ts`) or the close-time "N techs confirmed" counter (Brandon-gated).

## UNCOMMITTED WORKING-TREE CHANGES (this session)
```
 M lib/diagnostics/resolve-platform.ts      # Ram recognition
 M tests/unit/resolve-platform.test.ts      # +15 Ram tests, flipped Ram-null guard
 M tasks/lessons.md                         # +2 lessons
 M HANDOFF.md                               # this file
?? docs/field-cases/                        # new library: README + 3 case files
```
(`docs/superpowers/plans/2026-06-21-...money-shot-skin.md` was already untracked from the prior session.)

## PRIOR STATE (still true, from before this session)
The topology diagnostic screen got its **dark "instrument-mode" / Figma money-shot look** (commits `a6dcdb2` focused wired circuit + `eac4076` dark skin, scoped to `.topo`; `/curator` stays warm). Phase 5 Task 3 polish (exact-Figma console/answer anatomy, worded progress eyebrow, voltage pills, focus-tightening) is still **gated on Brandon's gut-click**. That gut-click + walking the SEEDED loop still needs an **in-coverage truck** (a Ford 6.7 PSD, or a now-recognized Ram once content is seeded) — none of the 3 real trucks so far could exercise it. Plan doc: `docs/superpowers/plans/2026-06-21-diagnostic-loop-money-shot-skin.md`. Ledger: `.superpowers/sdd/progress.md`.

## LESSONS ADDED THIS SESSION (tasks/lessons.md)
- `flag-missing-data-in-an-image-immediately` — if a shared image doesn't contain the data the user expects (codes), say so IN THAT TURN (they may discard the source). (Cost real data this session — Brandon cleared the Escalade code photos.)
- `field-data-is-fuel-to-build-from-not-a-fork` — capture/structure his field cases to grow coverage; never gate them behind a strategy fork.

## MEMORIES WRITTEN (auto-memory)
`field-data-is-fuel-not-a-fork`, `real-truck-validation-1-ram-cummins`, `real-truck-validation-2-ram-trans`, `real-truck-validation-3-escalade-network`.

## RESUME PROMPT
```
Read HANDOFF.md in full. Branch feat/diagnostic-loop, HEAD eac4076, UNCOMMITTED changes (Ram resolver recognition + 15 tests, field-case library at docs/field-cases/, 2 lessons). This was a LIVE-VALIDATION session: Brandon ran 3 real shop trucks through the tool — 2 Ram Cummins (DEF line broke; 68RFE TCC won't lock) + a 2019 Escalade — all OUT of current coverage (tool = Ford 6.7/6.0 PSD only). Core reframe: his field data is FUEL to grow coverage toward predict/prefill, NOT a fork. I BUILT Ram HD 6.7 Cummins recognition into the resolver (branch-only, must not merge until content is seeded behind the slug) and a field-case library. THE ACTIVE THING: the 2019 Escalade diagnosis is mid-elimination — wheel speed sensors ruled out; waiting on Brandon's per-wheel TPMS-trigger result to split "one BCM-data-path cause" vs "weak TPMS sensors + separate network fault." First content to author = the 2024 Ram DEF flow, drafted from his findings FOR HIS VERIFY (never fabricate specs). Invariants: honest-only, Ram recognition branch-only until content lands, don't dev during his workday, branch only. Then ask Brandon what the Escalade sensors did at the wheel, and whether to start seeding the DEF flow.
```
