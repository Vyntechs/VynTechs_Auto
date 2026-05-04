# Agent guide — Vyntechs MVP

This file holds load-bearing conventions for any agent working on the repo. The full session-by-session record lives in `docs/superpowers/sessions/` — the most recent `*-handoff-*.md` supersedes earlier handoffs and is the source of truth for current state.

## Where to look first

- **Plan:** `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md` — phase-by-phase tasks. Each phase has an "Implementation corrections" callout at its end if reality drifted from the plan; those callouts are authoritative.
- **Spec:** `docs/superpowers/specs/2026-05-01-vyntechs-design.md`
- **UI conventions:** `docs/superpowers/ui-design-toolkit.md` — mandatory pre-read for any UI/frontend task.
- **Latest handoff:** `docs/superpowers/sessions/` — pick the newest file, paste it as the first message of a fresh session.

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
- For new tables, also run `pnpm drizzle-kit generate` to update `lib/db/schema.ts` snapshots in `drizzle/migrations/meta/` — these are read by the local pglite tests.

## Risk gating + Decline-or-Defer (Phase M)

- Every action the AI proposes that the tech will physically perform must include a `proposedAction` block with `confidence` (0-1) on the `TreeState`.
- The `advanceSession` handler runs `classifyAction()` (`lib/gating/risk-classifier.ts`) — hardcoded rules first, Haiku LLM judge for novel actions.
- `getThreshold()` (`lib/db/queries.ts`) looks up the per-(`risk_class` × `vehicle_family` × `symptom_class`) threshold from `confidence_calibration`. Seeded from spec §8.3 starting values; falls back to those values if the table is empty. Refit weekly by the calibration engine in Phase Q.
- If `confidence < threshold`, `gateProposedAction()` (`lib/gating/gap-handler.ts`) returns `allow: false` with `gap` and `options: ['gather_more_low_risk', 'decline', 'defer']`. The `advanceSession` handler attaches the result as `treeState.gateDecision` and the `(app)/sessions/[id]/page.tsx` server component redirects to `/decline` when blocked.
- The `/decline` route uses the live `DeclineOrDeferLive` wrapper around the Phase E presentational `DeclineOrDefer` screen. Decline/Defer POST to `/api/sessions/[id]/decline-or-defer`, which calls `declineOrDeferSessionForUser` (DI'd `generateDeclineLanguage` for customer-facing copy).
- **Tech-Assisted Retrieval (Rung 2)** is bounded to 1 + 2 follow-ups per node. `recordTechAssistRequest` enforces the budget; on the third follow-up `advanceSession` strips `requestedArtifact` and appends a Rung-2 budget exhausted notice to `message`. Audit trail in `tech_assist_requests` table.
- **Any change to a hardcoded risk rule must be reviewed by code review (not LLM-judged)** — these are the safety floor.

## Handoff format

Per-session handoffs in `docs/superpowers/sessions/` are **slim**. They carry only what can't live in this file or the plan: current branch + baseline numbers, what shipped, carryover findings (audit results, TODOs not on the plan), and the recommended next phase. Workflow rules, conventions, and verification commands stay here in `AGENTS.md` — do not duplicate them into the handoff.

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
