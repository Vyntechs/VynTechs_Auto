# Vyntechs MVP — Handoff (2026-05-02, env wired, walkthrough pending)

Supersedes `2026-05-02-handoff-phase-m-a11y-closed.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if the chosen task has UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **148/148 tests**, exit 0, build clean.
4. Verify env: `.env.local` has live Supabase keys + Anthropic API key + DB password. Project ref `ynmtszuybeenjbigxdyl` ("Vyntechs Auto"). Migrations 0000–0004 applied to remote, RLS on every `public` table. confidence_calibration seeded.
5. Dev server may still be running from prior session — check `lsof -i :3000`. If so, restart for fresh env.
6. **Ask the user how the walkthrough went.** Troubleshoot what they hit. Probable areas listed in "Next session" below.

## State

- Branch `feature/mvp-implementation`, **~47 commits ahead** of `main` (was 43; +4 from this session after the handoff commit lands).
- Tests **148/148** (was 146; +2 for landing-page nav links pinned via TDD).
- Supabase project "Vyntechs Auto" `ynmtszuybeenjbigxdyl` us-east-1 ACTIVE_HEALTHY. 7 tables on `public`, all RLS-enabled.
- Anthropic: real Sonnet 4.6 via `@anthropic-ai/sdk`, key live in `.env.local`. User funded $100 of API credits.
- Vercel: `vyntechs` project linked, but **env vars NOT pushed to Vercel yet** — local-only secrets.

## What shipped this session

- **Wired Supabase end-to-end.** `.env.local` now has live `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy JWT format — see carryover), `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`. Password (`Vyntechs.0812`) is URL-safe as-is. JWTs verified by decoding role + ref claims, no values echoed to chat.
- **Applied Phase M migrations to remote DB.** `0002_phase_m_confidence_calibration`, `0003_phase_m_tech_assist_requests`, `0004_phase_m_rls_hardening`. The 0004 was a no-op at the SQL level because Supabase's `rls_auto_enable` event trigger pre-empted RLS on new tables; kept as documented intent.
- **Seeded `confidence_calibration`.** 5 baseline rows from spec §8.3 (zero=0.0 / low=0.7 / medium=0.8 / high=0.9 / destructive=0.95) on `(vehicle_family='*', symptom_class='*')`. Run via MCP `execute_sql` rather than the deferred `tsx drizzle/seed/calibration-seed.ts` runner. The seed file remains as documentation of the canonical baseline.
- **Wired Anthropic API key.** Real Sonnet 4.6 routes through existing `lib/ai/client.ts` — no SDK changes. **Same key works in dev and prod**; no swap needed when shipping.
- **Installed agent skills locally.** `npx skills add supabase/agent-skills` deposited skills at `.agents/skills/{supabase,supabase-postgres-best-practices}` plus 36 per-tool symlink dirs. **Lockfile-only commit pattern**: `skills-lock.json` tracked, `.agents/` + every tool symlink dir gitignored. Run `npx skills experimental_install` after a fresh clone to restore.
- **Fixed landing-page dead-end (TDD).** `app/page.tsx` now has Sign up / Sign in nav links. `tests/unit/landing.test.tsx` pins both via `getByRole('link', { name: /sign up|in/i })`.
- **Force-confirmed first user.** Supabase default SMTP didn't deliver the confirmation email. Used `UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = '<uuid>' AND email_confirmed_at IS NULL` via MCP. Reusable pattern for any unconfirmed dev account. Never run this in prod.

## Conventions reinforced this session

- **MCP control-plane vs data-plane.** Supabase MCP can `apply_migration` + `execute_sql` (data plane) but **cannot retrieve service role keys, DB passwords, or change auth/SMTP config** (control plane). Force-confirm-via-SQL is the data-plane workaround for SMTP issues in dev. Never apply to prod.
- **`.env.local` is the current source of truth.** Vercel env vars are empty. When ready to deploy, push secrets via `vercel env add` (interactive — paste in your terminal, never in chat). Do NOT run `vercel env pull` first or it overwrites `.env.local`.
- **Anthropic key strategy: same key in dev and prod.** Lazy `Proxy` in `lib/ai/client.ts` means the key is only validated on first call, not at boot. So a missing/bad key shows up at first AI call, not on `pnpm dev` boot.
- **Stub mode for AI is rejected.** AI reasoning IS the product. Faking it produces a useless walkthrough. If a future scenario requires reduced AI cost (e.g., heavy local iteration), use a low-budget API key, not a stub. **Phase T** (production fallback engine for offline / API-down) is potentially a real product feature down the line — but NOT a dev tool.

## Carryovers (track or address next session)

- **Sign-up + sign-in pages are bare unstyled forms** (Phase A placeholders). User flagged the dead-end pattern; landing CTA fixed, but the auth pages themselves still need Workshop Instrument styling. Match Phase E surfaces.
- **Custom SMTP for `support@vyntechs.com`.** User owns the domain with email infrastructure already configured. Set up at `https://supabase.com/dashboard/project/ynmtszuybeenjbigxdyl/auth/templates` → SMTP Settings. Required before production email auth. ~5 min once SMTP creds are known.
- **Anon key is legacy JWT format**, not modern `sb_publishable_...`. Both work; modern format preferred for independent rotation. Re-grab from dashboard when convenient.
- **Phase F a11y carryover (still open).** 2 unlabeled form fields in `OutcomeCapture` per Chrome a11y audit. Fix when next touching Phase F.
- **TreeState duplication (still open).** `lib/db/schema.ts` (JSONB column type) vs `lib/ai/tree-engine.ts` (runtime contract). Collapse to one source. ~15 min, ride along with any phase that touches `TreeState`.
- **Vercel env vars are empty.** Push before deploy via `vercel env add` per var. The bootstrap-flow note above stands: don't `vercel env pull` first.
- **Plan still says "calibration seed deferred until DATABASE_URL wired"** in Phase M corrections — that's now resolved. Updated in this session's plan edit.

## Next session — likely focus

Troubleshooting whatever the user hit during walkthrough. Probable failure modes:

1. **First AI call** (POST `/api/sessions` → `generateInitialTree`). Surfaces SDK auth, JSON parsing, prompt-cache header behavior. If the response shape is wrong, `parseTreeJson` throws "invalid tree response shape".
2. **Tree advance** (POST `/api/sessions/[id]/advance`). Exercises `updateTree` + `classifyAction` + `gateProposedAction` against real seeded thresholds. First place the `risk_class × vehicle_family × symptom_class` lookup actually fires against real DB data.
3. **Outcome capture.** `validateSpecificity` against live Anthropic. Returns `ok: false` for vague text — UX should surface feedback inline.
4. **Decline-or-Defer.** Only fires if Sonnet proposes a destructive action with confidence < 0.95 on a real intake. May not trigger in casual walkthrough; can deliberately submit a complaint that invites it (e.g., "no codes, intermittent, customer wants reflash").
5. **Sign-up page UX** — bare form may confuse but functionally works. Force-confirm pattern available if SMTP still failing.
