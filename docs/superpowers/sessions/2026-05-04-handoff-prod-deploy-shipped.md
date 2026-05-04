# Vyntechs MVP — Handoff (2026-05-04, manual session controls + prod deploy on vyntechs.dev)

Supersedes `2026-05-04-handoff-phase-f-corrections-shipped.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if doing UI.
3. Verify baseline: `pnpm exec tsc --noEmit && pnpm build`. Tests: `pnpm test` (316/316 last run, no flake — pglite test-DB flake mentioned in earlier handoffs has gone quiet since 2026-05-04 promotion.ts fix).
4. **Production lives at https://vyntechs.dev** — Vercel project `vyntechs-dev` (id `prj_AUOvrvGmXuTtQNvI1rMgMH4TjkNx`, team `team_pIz2bArnD9WKAfzxYWoPtvSd`), connected to `Vyntechs/VynTechs_Auto`, production branch `main`. Auto-deploys on push.
5. Local dev: `pnpm exec next dev --webpack -H 0.0.0.0 -p 3000` for iPhone-on-LAN. (Turbopack still hits the cross-origin Client-Manifest bug.)
6. **Open thread, owed by Brandon: Task 5 phone smoke** on vyntechs.dev — walk new diagnosis → close case → outcome → corpus row check. Plan: `docs/superpowers/plans/2026-05-04-manual-session-controls.md`. Until that's ratified, "manual session controls" stays in "shipped-pending-validation" status.
7. **Default next phase after Task 5:** continuing Phase O — Counter 02 (HERO plan tree instrument). Active queue: O Counter 02-03 → R → Q → P. **J / N / S still parked — stop and ask before touching.**

## State

- Branch `main` and `feature/mvp-implementation` both at the same tip after this session's no-ff merges. Push history goes through feature → no-ff merge → main.
- Tests **316/316** clean, twice. `tsc --noEmit` clean. `pnpm build` clean.
- Production env: Voyage AI for embeddings (1024-dim, free tier 200M tokens, key `VOYAGE_API_KEY` set on Vercel + local). OpenAI fully removed from the codebase.
- Live Supabase project `ynmtszuybeenjbigxdyl` ("Vyntechs Auto") — schema in sync with repo. Migration 0008 (`vector(1536)` → `vector(1024)`) applied via Supabase MCP.
- `corpus_entries` row count: still 0 on live (Brandon's force-closed F-150 from 2026-05-04 didn't promote). Expected to land first row on Task 5 close.

## What this session covered

- **Manual session controls (plan file `2026-05-04-manual-session-controls.md`) Tasks 1–4 shipped.** Task 5 (phone smoke) is Brandon's, owed. Headline:
  - Persistent "+ New diagnosis" CTA on `TodayHome` header (replaces dead `<Bell>` icon)
  - "Close case" Module on `ActiveSession` after the Plan tree → links `/sessions/[id]/outcome`
  - Automated session-loop integration test (`tests/unit/manual-session-loop.test.ts`) — walks intake → close → corpus row
  - **Caught + fixed a real corpus-promotion SQL bug**: drizzle's `sql` template renders empty arrays as `()`, which is invalid Postgres `text[]` syntax. Every previous close in production wrote zero corpus rows, swallowed by the `try/catch` in `closeSessionForUser`. Fix: `toPgTextArrayLiteral()` in `lib/corpus/promotion.ts` builds canonical `{a,b}` literals; `unwrapRows()` normalizes pglite `{ rows: Row[] }` vs mocked `Row[]` results.
- **Embeddings provider swap: OpenAI → Voyage AI.** `lib/ai/embeddings.ts` now hits `https://api.voyageai.com/v1/embeddings` with model `voyage-3` (1024 dim). Schema migrated to match. `OPENAI_API_KEY` references removed everywhere; `VOYAGE_API_KEY` is the new sole embedding key. Free tier covers shop indefinitely.
- **Production deploy stood up at vyntechs.dev.** Repurposed the existing stale `vyntechs-dev` Vercel project (which previously hosted a marketing landing): swapped connected repo to `VynTechs_Auto`, imported env vars from `.env.local`, fixed a critical pooler-host trap (see Carryovers).
- **`/api/health` diagnostic endpoint added** (`app/api/health/route.ts`). Surfaces Postgres connection-error cause when Vercel's log viewer truncates Drizzle errors. **Should be removed** once Task 5 confirms the loop works — left in until then in case more diagnostic is needed.

## Carryovers

- **Pooler-hostname trap (durable lesson):** `.env.example` originally hardcoded `aws-0-us-east-1.pooler.supabase.com`. Newer Supabase projects (incl. this one's "Vyntechs Auto", created 2026-05-01) live on `aws-1`, not `aws-0`. Same project ref, same password, different physical pooler — wrong host returns `Tenant or user not found` (code XX000). Fix is always: copy the pooled URL directly from Supabase Dashboard → Settings → Database → Connection string → Transaction tab. **Never assume the pooler hostname.** The template now warns about this.
- **`/api/health` endpoint left in repo** — diagnostic only, no secrets exposed (env-key presence flags + DB host fragment + ping result), but it's an unauthenticated public endpoint. Remove after Task 5 ratification.
- **Phase L (internet retrieval — Brave / Reddit / YouTube / NHTSA) still deferred.** No env vars set in prod for these adapters; they degrade gracefully.
- **Phase F's auto-redirect-to-outcome** is still wired alongside the new manual Close case button. Both rails functional.
- **All earlier carryovers** from `2026-05-04-handoff-phase-f-corrections-shipped.md` still apply unless superseded above. Pglite test-DB flake has gone quiet (likely a side effect of the corpus promotion fix, as some failing tests were corpus-touching).

## Suggested next session

If Brandon's Task 5 phone smoke went well: query `corpus_entries` via Supabase MCP to confirm the first real row landed with a Voyage embedding, delete `/api/health`, write a fresh handoff, then resume Phase O Counter 02.

If Task 5 surfaced a bug: triage from the runtime logs. Use `/api/health` first if it's a connection issue.

Recommend `/clear` before starting either.

## Reference — production stack

- **Domain:** vyntechs.dev (Vercel)
- **Vercel project:** `prj_AUOvrvGmXuTtQNvI1rMgMH4TjkNx` (`vyntechs-dev`), team `team_pIz2bArnD9WKAfzxYWoPtvSd`
- **GitHub repo:** `Vyntechs/VynTechs_Auto`, production branch `main`, auto-deploy on push
- **Supabase project:** `ynmtszuybeenjbigxdyl` ("Vyntechs Auto"), region us-east-1, pooler host `aws-1-us-east-1.pooler.supabase.com:6543`
- **AI providers:** Anthropic (chat completions: Sonnet for plan, Haiku for gating), Voyage AI (embeddings: `voyage-3`, 1024 dim)
