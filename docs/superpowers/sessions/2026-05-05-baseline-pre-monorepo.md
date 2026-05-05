# Pre-monorepo baseline (2026-05-05)

Captured before Stage 1 of the platform split migration. Reference for regression testing throughout migration stages.

## Test suite
- Total: 378 passing
- Test files: 64
- Run command: `pnpm test`
- Duration: 91.89s (transform 2.95s, setup 6.04s, import 37.05s, tests 369.14s, environment 25.64s)

## Typecheck
- `pnpm exec tsc --noEmit`: clean (0 errors)

## Build
- `pnpm build`: clean (`✓ Compiled successfully in 3.6s`)
- Route count: 31 (across `app/` and `app/api/`)
- Static prerendered: `/`, `/_not-found`, `/design`, `/icon.svg`, `/manifest.webmanifest`, `/sign-in`, `/sign-up`
- Dynamic (server-rendered): `/api/*`, `/billing`, `/intake`, `/intake/confirmed/[workOrderId]`, `/intake/plan-quote/[draftId]`, `/sessions`, `/sessions/[id]`, `/sessions/[id]/decline`, `/sessions/[id]/outcome`, `/sessions/new`, `/today`

## Production
- Branch: main
- HEAD commit: `b7509268b64e4b83c380a130a8d1cab7dfa05fb9`
- Production URL: https://vyntechs.dev
- Production deployment (most recent Ready, 2026-05-05 ~11 minutes pre-baseline): https://vyntechs-1keci19cs-brandon-nichols-projects-f7e6d2a9.vercel.app

## Tag
- `pre-monorepo-baseline` tagged at HEAD (`b7509268`)

## Notes
This is the rollback line. If any stage of the migration fails irrecoverably,
`git reset --hard pre-monorepo-baseline` returns the repo to this exact state.

Route response samples for anonymous endpoints captured at `/tmp/vyntechs-baseline/*.headers`
(local-only; not committed). Re-capture with the curl block from Stage 0.3 of the migration plan.
