# Agent guide — Vyntechs MVP

This file holds load-bearing conventions for any agent working on the repo. The full session-by-session record lives in `docs/superpowers/handoffs/` — the most recent `*-handoff*.md` supersedes earlier handoffs and is the source of truth for current state.

> **Active work may live in a git worktree.** Root `HANDOFF.md` points to the current canonical handoff — read it first. As of 2026-06-17 the live Phase-1 work is on branch `feat/system-data-ingest` at `.claude/worktrees/system-data-ingest/`. **IGNORE `.worktrees/` (the older worktree dir) entirely.**

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml`). All scripts below exist in `package.json`:

```bash
pnpm dev            # next dev (http://localhost:3000)
pnpm build          # next build
pnpm start          # next start (prod server)
pnpm test           # vitest run — unit tests (tests/unit/**)
pnpm test:watch     # vitest in watch mode
pnpm test:e2e       # playwright test (tests/e2e/**) — boots `pnpm dev` automatically
pnpm db:generate    # drizzle-kit generate — write migration SQL + meta snapshots
pnpm db:migrate     # drizzle-kit migrate — see Database migrations caveat below
```

Type-check (no script — run directly):

```bash
pnpm exec tsc --noEmit
```

## Stack

- **Next.js 16** App Router + **React 19**.
- **Drizzle ORM** (`drizzle-orm`) over **postgres.js** (`postgres`); schema in `lib/db/schema.ts`.
- **Supabase** SSR auth (`@supabase/ssr`, `@supabase/supabase-js`); admin via service role.
- **Stripe** (`stripe`) for billing/subscriptions.
- **@xyflow/react** + **@dagrejs/dagre** for the electrical-topology diagnostic UI (auto-layout).
- **@anthropic-ai/sdk** for all LLM calls; **Zod** (`zod`) for validation.
- **@phosphor-icons/react** icons; **@vercel/analytics**.
- **Testing:** Vitest 4 + Testing Library + **happy-dom** for unit (`tests/unit`), Playwright for e2e (`tests/e2e`). pglite (`@electric-sql/pglite`) backs in-memory DB tests.
- `@` path alias → repo root (configured in `vitest.config.ts` and `tsconfig.json`).

## Environment

Copy `.env.example` to `.env.local`. Keys (see `.env.example` for the full annotated list):

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- DB: `DATABASE_URL`, `DATABASE_URL_DIRECT`
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
- Retrieval / curator: `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `VOYAGE_API_KEY`
- Ops: `CRON_SECRET`, `FOUNDER_EMAIL`, `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED`

**Gotcha:** `drizzle.config.ts` reads `DATABASE_URL_DIRECT` and falls back to `DATABASE_URL`. The direct (non-pooled) URL is what migrations want.

## Architecture

```
app/
  (app)/            authed product: intake, sessions, settings, subscribe, today, vehicles, whats-new
  (auth)/           sign-in, sign-up, forgot-password, reset-password
  api/              route shims: sessions, intake, diagnostics, curator, stripe, team, cron, health, …
  curator/  design/ checkout/  deactivated/  auth/
  layout.tsx  page.tsx  manifest.ts  globals.css
components/          presentational React components (shared UI)
lib/
  ai/               Anthropic client, prompts, tree-engine, vision, embeddings, extraction-worker
  db/               client.ts, schema.ts, queries.ts (helpers take db: AppDb), unwrap-rows.ts
  gating/           risk-classifier.ts, gap-handler.ts, decline-language.ts (Phase-M safety floor)
  calibration/      confidence-threshold refit (aggregate, refit, run-weekly, manual-trigger)
  curator/          corpus/novel/drift/deferred actions, role-gate, queries
  corpus/ retrieval/ intake/ comeback/ diagnostics/ founder/ external/ storage/
  sessions.ts  session-routing.ts  auth.ts  auth-access.ts  stripe.ts  feature-flags.ts
middleware.ts       Supabase session refresh + route protection
drizzle/            migrations/ (SQL + meta), seed/, data/, tests/
supabase/           storage-setup.sql (storage schema — Drizzle does NOT manage this)
docs/               flow.md (system flow), RESTORE.md, superpowers/{plans,specs,handoffs,…}
tests/              unit/ (144 tests), e2e/ (Playwright), helpers/, setup.ts
```

**Data flow (request):** browser → `middleware.ts` (Supabase auth) → `app/.../page.tsx` server component or `app/api/.../route.ts` shim → `lib/*` handler (`db: AppDb` + injected deps, returns discriminated union) → `lib/db/queries.ts` → postgres.js → Supabase Postgres.

## Key files

- `lib/db/schema.ts` — single source of truth for all tables (sessions, diagnostic, curator, calibration, stripe, corpus, …).
- `lib/sessions.ts` + `lib/session-routing.ts` — the diagnostic session state machine + which screen a session routes to.
- `lib/ai/tree-engine.ts`, `lib/ai/prompts.ts` — LLM-driven diagnostic tree.
- `lib/gating/risk-classifier.ts` — the risk/safety floor (see Risk gating below).
- `middleware.ts` — auth gating for all routes.
- `docs/flow.md` — full system flow as a branch-tree diagram (the preferred explanation format).

## Where to look first

- **Latest handoff:** root `HANDOFF.md` → then the newest file in `docs/superpowers/handoffs/`; paste it as the first message of a fresh session.
- **Plans:** `docs/superpowers/plans/` — phase/PR-by-PR tasks. Each phase may have an "Implementation corrections" callout at its end if reality drifted; those callouts are authoritative.
- **Specs:** `docs/superpowers/specs/`
- **UI conventions:** `docs/superpowers/ui-design-toolkit.md` — mandatory pre-read for any UI/frontend task.

## Working rules

Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

### Rule 1 — Think before coding
- State assumptions explicitly. If uncertain, ask rather than guess.
- Present multiple interpretations when ambiguity exists.
- Push back when a simpler approach exists.
- Stop when confused. Name what's unclear.

### Rule 2 — Simplicity first
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked. No abstractions for single-use code.
- Test: would a senior engineer say this is overcomplicated? If yes, simplify.

### Rule 3 — Surgical changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor what isn't broken. Match existing style.

### Rule 4 — Goal-driven execution
- Define success criteria. Loop until verified.
- Don't follow steps. Define success and iterate.
- Strong success criteria let you loop independently.

### Rule 5 — Use the model only for judgment calls
- Use me for: classification, drafting, summarization, extraction.
- Do NOT use me for: routing, retries, deterministic transforms.
- If code can answer, code answers.

### Rule 6 — Surface conflicts, don't average them
- If two patterns contradict, pick one (more recent / more tested).
- Explain why. Flag the other for cleanup.
- Don't blend conflicting patterns.

### Rule 7 — Read before you write
- Before adding code, read exports, immediate callers, shared utilities.
- "Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

### Rule 8 — Tests verify intent, not just behavior
- Tests must encode WHY behavior matters, not just WHAT it does.
- A test that can't fail when business logic changes is wrong.

### Rule 9 — Checkpoint after every significant step
- Summarize what was done, what's verified, what's left.
- Don't continue from a state you can't describe back.
- If you lose track, stop and restate.

### Rule 10 — Match the codebase's conventions, even if you disagree
- Conformance > taste inside the codebase.
- If you genuinely think a convention is harmful, surface it. Don't fork silently.

### Rule 11 — Fail loud
- "Completed" is wrong if anything was skipped silently.
- "Tests pass" is wrong if any were skipped.
- Default to surfacing uncertainty, not hiding it.

## Architecture conventions

- **Handler-in-`lib/` + thin route shim.** Every API route follows this pattern: handler in `lib/sessions.ts` (or similar) takes `db: AppDb` plus injected dependencies, returns a discriminated union. The `app/api/.../route.ts` shim is ~30 lines: read user, call handler with prod deps, map result to `NextResponse`. Makes everything pglite-testable without mocking Next.js.
- **Queries take `db: AppDb` as first arg.** No global `db` import inside `lib/db/queries.ts` helpers — always passed in.
- **422 + JSON `{error, feedback}`** for AI-validation rejections.
- **Tokens are the source of truth** even outside CSS — derive hex from `--vt-*` OKLCH values for non-CSS surfaces (PWA manifest, etc.) and document the conversion.
- **Plan-vs-reality reconciliation:** when a plan task references components that don't exist (e.g. Phase F's shadcn assumption), wire the existing screen rather than building a parallel component. Document via a "Phase X — Implementation corrections" callout in the plan.
- **`vi.stubEnv` not `Object.defineProperty`** for `NODE_ENV`.
- **Calm/technical/imperative voice; no emoji in product UI.**

## Database migrations

- **Apply migrations to live Supabase via the MCP `apply_migration` tool, not `pnpm drizzle-kit migrate`.** Drizzle's `__drizzle_migrations` table on the live DB is empty — Drizzle filenames (`0006_known_maximus.sql`, `0007_chief_bushwacker.sql`, …) are decorative. The source of truth on prod is Supabase's own migration history (list via MCP `list_migrations`).
- Workflow when adding a migration: (1) write the SQL in `drizzle/migrations/NNNN_<random>.sql` so the schema change survives in source control, (2) call MCP `apply_migration` with a descriptive snake_case name (e.g. `index_artifacts_session_id`) and the same SQL, (3) run MCP `get_advisors` after to catch new lints (unindexed FKs, etc.).
- For new tables, also run `pnpm drizzle-kit generate` (or `pnpm db:generate`) to update `lib/db/schema.ts` snapshots in `drizzle/migrations/meta/` — these are read by the local pglite tests.
- **NEVER touch the live DB `ynmtszuybeenjbigxdyl`.** Throwaway/scratch Supabase projects (e.g. `cojmftuuukcsaxvcntls`) are used for ingest-pipeline testing — confirm the project ref before any write.

## Risk gating + Decline-or-Defer (Phase M)

- Every action the AI proposes that the tech will physically perform must include a `proposedAction` block with `confidence` (0-1) on the `TreeState`.
- The `advanceSession` handler runs `classifyAction()` (`lib/gating/risk-classifier.ts`) — hardcoded rules first, Haiku LLM judge for novel actions.
- `getThreshold()` (`lib/db/queries.ts`) looks up the per-(`risk_class` × `vehicle_family` × `symptom_class`) threshold from `confidence_calibration`. Seeded from spec §8.3 starting values; falls back to those values if the table is empty. Refit weekly by the calibration engine (`lib/calibration/`).
- If `confidence < threshold`, `gateProposedAction()` (`lib/gating/gap-handler.ts`) returns `allow: false` with `gap` and `options: ['gather_more_low_risk', 'defer']`. The `advanceSession` handler attaches the result as `treeState.gateDecision` and the `(app)/sessions/[id]/page.tsx` server component redirects to `/decline` when blocked. **(`'decline'` was removed from the option set 2026-05-09 — defer is the only escalation. The `session.status` enum still carries `'declined'` for back-compat with rows closed before the change.)**
- The `/decline` route uses the live `DeclineOrDeferLive` wrapper around the Phase E presentational `DeclineOrDefer` screen. Defer POSTs to `/api/sessions/[id]/decline-or-defer` (URL kept for back-compat), which calls `declineOrDeferSessionForUser` (DI'd `generateDeclineLanguage` for customer-facing copy). Yes/No on the hero confirm card POSTs to `/advance`; Snap-it POSTs to `/capture`; all three (plus the Gather spoke) then POST to `/api/sessions/[id]/release-gate` to clear the stale `gateDecision` so the session-routing layer doesn't bounce the user right back to `/decline`.
- **Tech-Assisted Retrieval (Rung 2)** is bounded to 1 + 2 follow-ups per node. `recordTechAssistRequest` enforces the budget; on the third follow-up `advanceSession` strips `requestedArtifact` and appends a Rung-2 budget exhausted notice to `message`. Audit trail in `tech_assist_requests` table.
- **Any change to a hardcoded risk rule must be reviewed by code review (not LLM-judged)** — these are the safety floor.

## Handoff format

Per-session handoffs in `docs/superpowers/handoffs/` are **slim**. They carry only what can't live in this file or the plan: current branch + baseline numbers, what shipped, carryover findings (audit results, TODOs not on the plan), and the recommended next phase. Workflow rules, conventions, and verification commands stay here in `AGENTS.md` — do not duplicate them into the handoff.

Target ~25-40 lines. The file `2026-05-02-handoff-phase-m-a11y-closed.md` is the canonical example. Older handoffs (Phase D/F/H/M) follow the verbose pre-2026-05-02 format and are kept as historical record; do not mirror their structure for new sessions.

## Verification before shipping

End of every phase, before declaring done:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

UI-touching phases also need `chrome-devtools-mcp:a11y-debugging` on the wired surfaces.

**Fresh Supabase projects** also need `supabase/storage-setup.sql` applied via Supabase MCP `execute_sql` — Drizzle doesn't manage the `storage` schema.

## Communication preferences

When explaining technical changes, code flow, or system architecture to the
project owner (Brandon), use **ASCII branch-tree diagrams**: a vertical tree
with `│ ├── └──` connectors, every user choice as a branch, every AI/API
call annotated inline (`[AI #N]`, `[API]`). Plain English on the labels —
the reader is non-technical. The full system flow is documented this way in
[`docs/flow.md`](./docs/flow.md); reuse that style for any explanation that
touches more than two hops.

Avoid long prose paragraphs for system-flow questions. A diagram + a short
"headline numbers" section + a "where current pain points live on the map"
section is the preferred shape.
