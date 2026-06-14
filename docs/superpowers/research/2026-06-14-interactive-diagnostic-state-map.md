# Interactive diagnostic — true state map (vs the vision)

**Date:** 2026-06-14 · **Branch:** `feat/system-data-ingest` · **Method:** 14-agent research workflow over the worktree, every claim verified by an adversarial second pass + a completeness critic. This is the "depth" doc; the short version went to Brandon in chat.

## The vision (what we're measuring against)
When a tech enters a **vehicle + concern**, the interactive diagram **becomes the diagnostic** and replaces the AI checklist. On entry: **reuse** it if we have it; if not, figure out **what's missing** and **build it on demand** — no hand-seeding, no curator button. As more get built, branches **connect across concerns** (P0087 ↔ P0088), **gaps fill from similar diagnostics**, branches reach into **other systems**, and coverage **compounds** over time. Must work across **many** vehicles/concerns — not one truck. (Curator = back-office authoring; users never go there.)

## What's actually live today (plain)
A tech enters a vehicle + complaint at intake → the app calls an AI to write a **question-and-answer checklist** ("tree") and shows that. If a curator hand-authored and published a click-through **wizard** for that exact vehicle+symptom, the user sees that instead. That's the whole live experience.

The **interactive circuit-diagram diagnostic** is real and renders — but **only** as a curator-only back-office preview (`/curator/topology`), hard-wired to **one Ford 6.7L diesel truck** and three fuel concerns (P0087/P0088/no-start). **No diagnosing user can reach it.** New code exists that *could* turn AI research into the diagram's data, but **nothing in the running app calls it** — it's exercised only by tests. The live "build" that does run produces the **old AI checklist**, not the diagram.

## Capability scorecard

| Capability (from the vision) | Status | One-line reality |
|---|---|---|
| Topology IS the user diagnostic (replaces AI checklist) | **built but unwired** | Renderer works; mounted only on the curator route. User session page never imports it. |
| Reuse an already-built diagnostic (read-if-present) | **built but unwired** | `loadSystemTopology` reads the saved graph if rows exist; only caller is the curator preview. No freshness check. |
| On-entry decision "do I HAVE this / what's MISSING?" | **partial** | Only a binary "is there a published wizard?" then fall back to AI. No coverage check, no missing-data inventory. |
| Build-as-needed on demand (no curator) | **built but unwired** | `synthesizeSystemData` + `promoteSystemDataDraft` have **zero production callers**. Live build is curator-triggered and emits a draft Flow, not graph data. |
| Works across MANY vehicles/concerns | **partial** | Vehicle→platform is hard-coded to **two** Ford diesels; symptom = two regexes + DTC pass-through. Renderer is generic; data + resolvers are the bottleneck. |
| Persisted per-session progress in the topology | **partial** | Read side wired (`last_scenario_slug`); **write route doesn't exist** and caller uses `sessionId='preview'` — saves fail silently. No fork-navigation UI. |
| Cross-system branches (wire reaching another system) | **wrong artifact** | Schema allows it, but the loader **drops** any connection whose endpoints aren't both in the current system. |
| Compounding / self-connecting graph (P0087 ↔ P0088) | **not built** | No symptom↔symptom / shared-branch model. Each Flow is a self-contained island. Net-new. |
| Gap-fill from SIMILAR diagnostics | **not built** | No similarity/embedding substrate on the graph. Reuse tables (`platform_equivalents`, `parent_platform_id`) are modeled but **dead code**. Net-new. |

## Data-model verdict
The schema is a **solid foundation for a single-system graph** (platforms, components with multi-system tags, typed connections, pins, observable properties, test_actions, branch_logic with real routing, scenarios, per-row "GAP" provenance for honest unknowns; the promote write path is idempotent/accretive). But the **interconnecting / similarity / gap-closing layer is net-new schema + logic on top**: no symptom-relations or shared-branch concept, no similarity substrate on the graph, cross-system reach is filtered out by the loader, the cross-platform reuse tables are unused, and "what's missing for this vehicle+concern" is computed nowhere.

## Biggest risks (honest)
- The headline capability — topology becoming the user diagnostic — is **zero lines wired** into the user path. Treat it as effectively unbuilt, not "almost there."
- The branch's namesake build pipeline (`synthesizeSystemData`/`promoteSystemDataDraft`) is **building blocks, not a running pipeline** — no caller. A "build-on-demand" demo today would be false.
- The live build produces the **wrong artifact** (draft decision-tree Flow), so wiring "build" is a redirect into the graph tables + an approval gate with no UI, not a toggle.
- The one populated truck's data lives **only in the live DB** — the hand-seed SQL was reverted on this branch, so a DB reset empties it and there's no runnable seed in the repo.
- The vision's differentiators (self-connecting branches, gap-fill) have **no code and no data-model support** — the largest net-new build, at zero.
- Cross-system branches are **silently dropped** at load — a correctness trap if someone assumes the graph traverses systems.

## Open design questions (only Brandon can answer)
- Where does takeover happen — at the **session page** (a 4th branch beside the wizard) or earlier at **intake**? (Decides whether the AI tree still runs and burns credits.)
- When an auto-built draft has **no curator**, who approves it? The only write path refuses non-approved drafts and there's no approval UI. Does the gate change, or stay human?
- Does topology **replace** the curator wizard too, or coexist?
- How is "similar diagnostic" defined for gap-fill (embeddings? the existing `platform_equivalents` verdicts? both?)?
- Is cross-system traversal in scope for v1 (the loader currently forbids it by design)?
- How is the one truck's DB repopulated post-revert — restore a runnable seed, or is live data canonical?
- Two intake paths exist (`/intake` and `/sessions/new`) with near-duplicate AI pipelines — which is canonical?

## What I verified myself (not just the agents' word)
- **Full test suite is green** earlier this session: 1375 tests / 176 files. So the build-block code is sound — but note its end-to-end test had to **manually flip the approval gate** to exercise promote, because no production path does (confirms "building blocks, not a pipeline").
- **The renderer drew real data** for the truck in the 2026-06-10 screenshots (`.design-shots/out/topology-fullscreen_*`), so "renderer works" is observed, not assumed — for that one seeded truck.

## Still assumption (the critic's honest flags — not yet re-checked)
- **Exact live DB row counts** for the truck (e.g. "126 components") — inferred from the 06-10 render, not re-queried. Supabase MCP could settle it.
- **Whether "takeover" is a small routing change or a big rebuild** — depends on `routeForSession` and whether the topology screen needs the full diagnose→lock→repair→close lifecycle the AI tree/wizard have. This is the **days-vs-months** question and is not yet answered.
- `slot-resolver` scene-walk depth (one-hop vs transitive) and `topology-layout` were not read in full — they scope the cross-system/compounding estimates.
