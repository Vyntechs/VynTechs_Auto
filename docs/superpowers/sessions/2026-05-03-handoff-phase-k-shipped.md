# Vyntechs MVP — Handoff (2026-05-03, Phase K shipped)

Supersedes `2026-05-03-handoff-phase-l-shipped.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if next phase has UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **260/260** tests, exit 0, build clean.
4. Pick next phase per "Next session" below. Recommended: **Phase G (Stripe Billing Skeleton)** or **Phase I (Multi-Modal Capture)** — both first-class shipping surfaces; the corpus + retrieval flywheel now serves them.

## State

- Branch `feature/mvp-implementation`, **95 commits ahead of `main`**, working tree clean.
- Tests **260/260**, tsc clean, `pnpm build` clean.
- Supabase project `ynmtszuybeenjbigxdyl` ACTIVE_HEALTHY. Migration 0006 (`corpus_entries` + pgvector) applied. pgvector 0.8.0 enabled in `extensions` schema.
- 8 commits this session — Phase K (Cross-Shop Corpus + Retrieval, Rung 0). Plan section updated with `Phase K — Implementation corrections (2026-05-03)`.

## What shipped this session

- **K1**: `corpus_entries` table with HNSW + GIN indexes; pgvector 0.8.0 enabled.
- **K2**: `lib/ai/embeddings.ts` — OpenAI `text-embedding-3-small` (single + batch, sorts by `data[i].index`).
- **K3**: `lib/corpus/retrieval.ts` — structured prefilter (vehicle + DTC overlap OR symptom-tag overlap) → pgvector cosine rank. Plan template's WHERE OR-chain had a short-circuit bug; restructured to explicit AND/OR pairs. Smoke-tested against real DB.
- **K4**: Replaced L10's placeholder `CorpusMatch` with real type re-export. `generateInitialTree(intake, corpus)` now renders a "Corpus context" block with confidence/success/comebacks/similarity/rootCause/summary. `updateTree`'s existing corpus block (placeholder shape) upgraded to render real fields. `TREE_ENGINE_SYSTEM` extended with CORPUS-FIRST RETRIEVAL guidance. POST `/api/sessions` calls `retrieveCorpus` before tree generation.
- **K5**: `lib/corpus/promotion.ts` (`promoteSessionToCorpus` + `inferSymptomTags`). Hooked into `closeSessionForUser` (handler-in-lib, NOT route shim) with DI'd `promoteToCorpus`. DTCs flat-mapped from `done` scan_screen artifacts; tags from complaint heuristic. Failures non-fatal.
- **K6**: `confirmSimilarCorpusEntries` + N-way short-circuit in `promoteSessionToCorpus`. Plan template had divergent embedding fingerprints between confirm and promote — fixed by extracting `buildEmbeddingTarget`, single fingerprint, single embed call per close.
- **K7**: `lib/corpus/decay.ts` (`recordCorpusComeback`). Auto-retires when comebacks ≥ 3 AND comebacks > successes (strict). Building block only — no caller wired in K (deferred comeback workflow).
- **K8**: Extended L10's `buildUpdateTreeWithRetrieval` to optionally take `retrieveCorpus`; runs corpus + internet retrieval in parallel via `Promise.all`. Advance route now injects both. Stale "Phase K not built yet" comments removed.

Test infra: `tests/helpers/db.ts` now loads PGlite's `@electric-sql/pglite/vector` extension before drizzle migrate (without it, every PGlite-based handler test hangs on migration 0006).

## New env vars (for Vercel preview/prod)

- `OPENAI_API_KEY` — required for K2/K5/K6/K7. Without it, `embed()` throws and corpus growth + N-way confirmation stop. Retrieval (K8 wrapper) catches and falls through to `corpus: []`, so tree generation still works without it; corpus just stays empty.

## Carryovers (track or address next session)

- **No RLS policies on `corpus_entries`** — same project-wide gap as every other public table. Address as a single sweep when policies are designed; do not retro-fit corpus alone.
- **Comeback workflow not wired** — `recordCorpusComeback` is a building block. Future work: detect rebooks (same vehicle + similar complaint within 30d) and call it. Likely a nightly cron job or a `/api/sessions/[id]/comeback` endpoint.
- **K7 fingerprint divergence** — decay uses `rootCause + dtcs` while promote/confirm use the richer fingerprint. Intentional but worth revisiting when Phase Q calibration runs against real comeback data.
- **Latency stack-up** — every advance now does internet retrieval (5 adapters, sequential) + LLM grader + corpus pgvector + Sonnet updateTree. Cache-miss tail can still hit 30s+. The Phase L carryover note about trimming `maxWallClockMs` to 10-15s is now more pressing; corpus adds <100ms but the Sonnet validator is the real culprit. Still defer until production telemetry exists.
- **Observability hook missing** — `runRetrieval`'s `{ queriesUsed, wallClockMs, tokensUsed, cacheHits, errors }` is still thrown away. Phase L carryover unchanged.
- **All earlier carryovers from `2026-05-03-handoff-phase-l-shipped.md`** still apply (DeclineOrDeferLive defaults, today-home DTC chip, I8 audio transport, two-way evidence channel UX gap, hook false-positives, etc.) — see that handoff for the full list.

## Next session — likely focus

Ask the user; don't pick. Recommended order:

1. **Phase G — Stripe Billing Skeleton** (3 tasks). First payment surface; the corpus + retrieval is now feature-complete and a paying-customer story is the next gate.
2. **Phase I — Multi-Modal Capture** (10 tasks). Wires the visually-present-but-unwired Voice/Photo/Video/Scan capture buttons (the "two-way evidence channel UX gap" Brandon flagged 2026-05-02).
3. **Phase J (Photo Storage Tiering)** still deferred — Brandon flagged AWS cost-surprise concerns 2026-05-02. Revisit only if storage costs become real.
4. **Phase N tablet, Phase O desktop** — still deferred per Brandon.

Recommend `/clear` before starting the next phase and resume from this handoff in a fresh session.
