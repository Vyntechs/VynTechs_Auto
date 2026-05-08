# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server (Next.js)
pnpm build        # production build
pnpm test         # run unit tests (Vitest)
pnpm test:watch   # watch mode
pnpm test:e2e     # Playwright e2e tests (requires running dev server)
pnpm exec tsc --noEmit   # type-check
pnpm db:generate  # regenerate Drizzle schema snapshots in drizzle/migrations/meta/
```

Run a single unit test file:
```bash
pnpm exec vitest run tests/unit/sessions.test.ts
```

**End-of-phase verification** (mandatory before declaring any phase done):
```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
```

## Architecture

### Handler pattern (load-bearing convention)

Every API route follows the same structure:
- **Handler** lives in `lib/` (e.g., `lib/sessions.ts`). It takes `db: AppDb` plus injected dependencies and returns a discriminated union (`{ ok: true; ... } | { ok: false; status: ...; error: string }`).
- **Route shim** in `app/api/.../route.ts` is ~30 lines: reads the authenticated user, calls the handler with production dependencies, maps the result to `NextResponse`.

This makes all business logic testable with PGlite without touching Next.js. Never put logic in route files; never import `db` globally inside handlers — always pass it in.

### Database

- **Production**: `lib/db/client.ts` exports `db` (Drizzle over postgres-js). Uses pooled URL (`DATABASE_URL`, port 6543) in production; direct URL (`DATABASE_URL_DIRECT`, port 5432) in dev.
- **Tests**: `tests/helpers/db.ts` exports `createTestDb()` — spins up an in-memory PGlite instance with the pgvector extension, stubs the Supabase `auth.uid()` function, and runs all Drizzle migrations. Use this for any test that needs DB access.
- **`AppDb` type**: `PostgresJsDatabase<schema> | PgliteDatabase<schema>` — every query function takes this as its first argument.
- **Migration workflow**: Write SQL in `drizzle/migrations/NNNN_<slug>.sql`, apply to live Supabase via MCP `apply_migration` (NOT `pnpm drizzle-kit migrate` — the live DB's `__drizzle_migrations` table is empty; Supabase manages its own history). Then run `pnpm db:generate` to update schema snapshots used by PGlite tests.

### Session lifecycle and routing

A session moves through: `open` → `closed` | `declined` | `deferred`.

The tree state (`sessions.treeState: TreeState`) carries a `phase` field (`diagnosing` | `repairing`) and `gateDecision`. `lib/session-routing.ts` encodes the pure routing decision (no Next.js dependencies) that `app/(app)/sessions/[id]/page.tsx` uses to dispatch to the correct screen.

Flow:
1. Intake → `POST /api/sessions` → corpus retrieval (pgvector) + `generateInitialTree` → session created
2. Advance → `POST /api/sessions/[id]/advance` → artifact fetch → `updateTree` → `classifyAction` (risk gate) → `gateProposedAction` → tree saved
3. If `gateDecision.allow === false`: server page redirects to `/sessions/[id]/decline`
4. On diagnosis complete (`treeState.done === true`): tech locks diagnosis → `POST /api/sessions/[id]/lock-diagnosis` → `phase: 'repairing'`
5. Repair phase: `POST /api/sessions/[id]/repair-observation` → `getRepairGuidance`
6. Close → `POST /api/sessions/[id]/outcome` → outcome validator → corpus promotion → follow-up scheduling → novel-pattern enqueue

### AI layer (`lib/ai/`)

- `tree-engine.ts`: `generateInitialTree` / `updateTree` call Claude Sonnet via `cachedSystem()` (prompt caching). Model is `process.env.ANTHROPIC_MODEL` (default `claude-sonnet-4-6`).
- `repair-guidance.ts`: separate prompt for the repair-phase chat loop.
- `risk-classifier.ts`: hardcoded regex rules evaluated first; falls back to Claude Haiku for novel actions. **Changes to hardcoded rules require code review, not LLM judgment.** Failure defaults to `high` risk (safety bias).
- `embeddings.ts`: Voyage AI `voyage-3` (1024-dim vectors). Used for corpus retrieval.
- `vision.ts`: multimodal extraction from captured artifacts.
- `cachedSystem()`: wraps system prompts for Anthropic prompt caching. Always use for system prompts.

### Corpus and calibration (`lib/corpus/`, `lib/calibration/`)

- `corpus_entries` table has a `vector(1024)` column (`embedding`) declared as `jsonb` in Drizzle (see comment in schema); real column type is enforced in migration SQL.
- `retrieveCorpus`: structured prefilter (make/model/year ±2 + DTC/symptom overlap) then HNSW cosine vector rank.
- Promotion: on session close, `inferSymptomTags` + extracted DTCs → new corpus entry.
- Decay: comeback recorded → `recordCorpusComeback()` decays matching entries.
- Calibration: weekly cron runs `runCalibrationAnalysis` → writes `drift_alerts` rows when threshold would move ≥5 points on ≥10-sample cells. Curator reviews and approves on the drift dashboard before `confidence_calibration` is updated.

### Risk gating (`lib/gating/`)

- `getThreshold()` looks up per-(risk_class × vehicle_family × symptom_class) threshold from `confidence_calibration`; falls back to spec §8.3 constants in `SPEC_8_3_FALLBACK`.
- If `confidence < threshold`: `gateProposedAction` returns `allow: false` with `gap` and `options`. Attached to `treeState.gateDecision`; the session page redirects to `/decline`.
- **Rung-2 (Tech-Assisted Retrieval)**: budget capped at 3 requests per node (`TECH_ASSIST_RUNG_2_BUDGET`). `recordTechAssistRequest` enforces it; on budget exhaustion the requestedArtifact is stripped and a notice appended to `message`.

### Retrieval (`lib/retrieval/`)

Five adapters: NHTSA, manufacturer recall, forum, Reddit, YouTube. `runRetrieval` runs them sequentially (by weight, descending), respects a wall-clock budget, and caches results in `retrieval_cache`. Results are injected into `updateTree` calls.

### Route groups

- `app/(app)/` — authenticated tech-facing UI (sessions, intake, billing, today)
- `app/(auth)/` — sign-in / sign-up
- `app/api/` — REST handlers (sessions, artifacts, intake, stripe, cron, curator, follow-ups)
- `app/curator/` — curator console (corpus, cases, drift, novel, deferred, calibration)

Middleware (`middleware.ts`) handles Supabase session refresh and guards `/curator` routes via `guardCuratorRoute`.

### Design system (`components/vt/`, `app/globals.css`)

- Primitives are exported from `components/vt/index.ts`. Use existing primitives before creating new ones.
- OKLCH color tokens are the canonical source: `--vt-graphite-*`, `--vt-bone-*`, `--vt-signal-*` (navy accent). The handoff CSS uses the legacy `--vt-amber-*` name — always translate to `--vt-signal-*` when porting designs.
- Derive hex values from OKLCH tokens for non-CSS surfaces (PWA manifest, etc.).
- Mobile-first: test at 390×844 (iPhone 14). Tap targets ≥44×44pt. Voice: calm/technical/imperative. No emoji in product UI.

## Testing conventions

- Unit tests: `tests/unit/*.test.ts(x)`, run with Vitest + happy-dom.
- DB-coupled tests: call `createTestDb()` from `tests/helpers/db.ts` and close in `afterEach`.
- Use `vi.stubEnv` (not `Object.defineProperty`) for `NODE_ENV`.
- E2E: `tests/e2e/*.spec.ts`, Playwright. Requires `pnpm dev` running. Auth state saved to `STORAGE_STATE_PATH` by `global-setup.ts`.

## Key env vars

See `.env.example` for all vars. Critical ones:
- `DATABASE_URL` — pooled Supabase connection (port 6543). In dev, `DATABASE_URL_DIRECT` (port 5432) takes precedence.
- `ANTHROPIC_MODEL` — defaults to `claude-sonnet-4-6`
- `VOYAGE_API_KEY` — required for corpus embedding
- `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` — feature flag for desktop intake form (default `false`)

## Additional references

- `AGENTS.md` — authoritative agent conventions (supersedes older handoffs)
- `docs/superpowers/plans/` — phase-by-phase implementation plan; "Implementation corrections" callouts are authoritative when plan and code diverge
- `docs/superpowers/ui-design-toolkit.md` — mandatory pre-read for any UI/frontend task
- `docs/superpowers/sessions/` — latest handoff file has current branch/state
