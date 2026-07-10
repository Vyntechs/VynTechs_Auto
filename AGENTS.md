# Agent guide — Vyntechs MVP

This file holds load-bearing conventions for any agent working on the repo. The source of truth for current state is the **active plan's status table** (see below) — not session handoff files; those were removed from the public tree in PR #111 along with the rest of `docs/superpowers/`. Do not go looking for `docs/superpowers/*` paths referenced by older docs.

## Where to look first

- **Active plan (shop OS — the current line of work):** `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md` — the single source of truth for all shop-OS work. Resume from its §11 session protocol and status table; pick a pending workstream, work it in a parallel worktree lane, update the table in the shipping PR. Its "Implementation corrections" callouts are authoritative over original phase text.
- **Engine work:** `docs/interactive-diagnostics/MASTER-BUILD-BRIEF.md` — governs the diagnostic engine itself. The engine is frozen with respect to shop-OS work (no engine tables or code paths change; see plan §2/§11).
- **UI/product doctrine:** `docs/strategy/2026-05-29-customer-interaction-doctrine.md` — mandatory pre-read for any UI/frontend task, including customer-facing surfaces.

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
- If `confidence < threshold`, `gateProposedAction()` (`lib/gating/gap-handler.ts`) returns `allow: false` with `gap` and `options: ['gather_more_low_risk', 'defer']`. The `advanceSession` handler attaches the result as `treeState.gateDecision` and the `(app)/sessions/[id]/page.tsx` server component redirects to `/decline` when blocked. **(`'decline'` was removed from the option set 2026-05-09 — defer is the only escalation. The `session.status` enum still carries `'declined'` for back-compat with rows closed before the change.)**
- The `/decline` route uses the live `DeclineOrDeferLive` wrapper around the Phase E presentational `DeclineOrDefer` screen. Defer POSTs to `/api/sessions/[id]/decline-or-defer` (URL kept for back-compat), which calls `declineOrDeferSessionForUser` (DI'd `generateDeclineLanguage` for customer-facing copy). Yes/No on the hero confirm card POSTs to `/advance`; Snap-it POSTs to `/capture`; all three (plus the Gather spoke) then POST to `/api/sessions/[id]/release-gate` to clear the stale `gateDecision` so the session-routing layer doesn't bounce the user right back to `/decline`.
- **Tech-Assisted Retrieval (Rung 2)** is bounded to 1 + 2 follow-ups per node. `recordTechAssistRequest` enforces the budget; on the third follow-up `advanceSession` strips `requestedArtifact` and appends a Rung-2 budget exhausted notice to `message`. Audit trail in `tech_assist_requests` table.
- **Any change to a hardcoded risk rule must be reviewed by code review (not LLM-judged)** — these are the safety floor.

## Handoff format

Handoff files are retired (the `docs/superpowers/sessions/` directory was stripped in PR #111). State now lives in exactly two places, updated **in the PR that ships the work**: the active plan's §11 status table (workstream → status → PR#), and an "Implementation corrections" callout at the end of the relevant phase when reality drifted from the plan. Workflow rules, conventions, and verification commands stay here in `AGENTS.md` — do not duplicate them into the plan.

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
