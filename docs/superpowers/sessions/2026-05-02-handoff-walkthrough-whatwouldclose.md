# Vyntechs MVP — Handoff (2026-05-02, walkthrough validated + whatWouldClose shipped)

Supersedes `2026-05-02-handoff-env-wired-prewalkthrough.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if the chosen task has UI.
3. **There are 8 modified files + 1 new directory uncommitted from this session** — `git status` first. Decide whether to commit (recommended; fully verified) or review.
4. Verify baseline: `pnpm test && pnpm exec tsc --noEmit`. Expect **148/148**, exit 0.
5. Dev server may still be running on :3000 — `lsof -i :3000`. Restart for fresh env if `.env.local` changed.
6. **Pick next phase per "Next session" below.** Recommended: **G → I → N → J**.

## State

- Branch `feature/mvp-implementation`, 47 commits ahead of `main`, **8 uncommitted file changes from today** (4 lib + 1 schema + 3 component/page).
- Tests **148/148**, tsc clean.
- Supabase project `ynmtszuybeenjbigxdyl` ("Vyntechs Auto") us-east-1 ACTIVE_HEALTHY. Migrations 0000–0006 applied. RLS on every `public` table.
- DB has **3 test sessions** from walkthrough: 1 closed (Camry fuel pump scenario), 1 declined (Tahoe IPC scenario, force-declined to free the open-session slot), 1 active blocked at gate (`41d6c2a0`, Tahoe IPC, sitting on `/decline`). Delete or keep as evidence.
- Dev user: `brandon@vyntechs.com` / `Benny0812`. Force-confirmed (no SMTP yet). Profile id `5ce0f1a5…`, role `owner`, attached to shop "brandon@vyntechs.com's Shop".

## What shipped this session

- **Full end-to-end walkthrough validated** via chrome-devtools-mcp. Sign-in → `/sessions/new` → POST `/api/sessions` (real Anthropic, ~30s) → `/sessions/[id]` (16-node tree rendered) → POST `/advance` (real Anthropic, ~18s) → `/today` → `/outcome` → POST `/close`. All routes 200, all DB writes verified.
- **Bug: `/sessions/new` page never created** despite Phase C plan requiring it. New file `app/(app)/sessions/new/page.tsx`. Phase C corrections section added.
- **Bug: pooler `DATABASE_URL` rejected by Supavisor** with `Tenant or user not found`. `lib/db/client.ts` now prefers `DATABASE_URL_DIRECT` in dev. **Pooler URL still broken — fix before Vercel deploy.** Phase M corrections #17.
- **Bug: AI response truncation** at `max_tokens=1024`. Bumped to 4096; `parseTreeJson` hardened with recovery + diagnostic context. Phase D corrections #9, #10.
- **Migrations 0005 + 0006**: 0005 added an unsolicited auto-create-profile trigger that broke `ensureProfileAndShop`'s canonical first-touch. 0006 reverts + backfills. Phase M corrections #16 documents the lesson.
- **`whatWouldClose` + `confidenceGap` fields shipped end-to-end.** When Sonnet's `proposedAction.confidence < 0.95`, the prompt requires it to articulate (a) the SPECIFIC uncertainty and (b) the cheapest tech-providable input that would close it. Decline-or-Defer screen renders Sonnet's actual ask instead of generic copy. Verified live: Tahoe IPC scenario shows *"Quote or photograph the ground pin numbers for IPC connectors C1 and C2 from the 2007 Tahoe GMT900 service manual wiring section."* Phase M corrections #15.

## Carryovers (track or address next session)

- **Pooler URL broken** — local dev fine on direct, Vercel deploy will fail. Investigate before Phase S.
- **No integration test crosses the auth+DB+AI seam.** 148 unit tests would not have caught any of today's bugs. Promote `/tmp/verify_login_flow.mjs` (or rebuild) as `tests/integration/` once test-DB strategy is decided.
- **NewSessionForm swallows fetch errors silently** + has no loading state during the ~30s AI call. User hit it during walkthrough. ~10 min UX fix.
- **Phase L (web retrieval) not yet shipped** — `whatWouldClose` requires the tech to provide data; Sonnet cannot search for it. Real product gap, scheduled.
- **Phase I (multi-modal capture) not yet shipped** — Capture toolbar buttons (Voice/Photo/Video/Scan) are decorative. Tech can answer `whatWouldClose` only by typing. Real product gap, scheduled.
- **TreeState type duplicated** between `lib/db/schema.ts` (jsonb mirror) and `lib/ai/tree-engine.ts` + `lib/gating/gap-handler.ts` (runtime). `whatWouldClose` change had to be applied to both. **Collapse next time you touch TreeState** — pick `tree-engine.ts` as canonical, schema imports via `import type`.
- **Sign-up + sign-in pages still unstyled** — from prior handoff. Add `autoComplete="email"` / `autoComplete="current-password"` to inputs to fix autofill cross-pollination from other localhost dev projects.
- **Phase F a11y** — 2 unlabeled fields in `OutcomeCapture`, from prior handoff.
- **Custom SMTP for `support@vyntechs.com`** — from prior handoff, unchanged.
- **`createProfile` in `lib/db/queries.ts:50` is dead code** — only `ensureProfileAndShop` is the live path. Delete next time you touch the file.

## Next session — likely focus

Per the plan, recommended phase order: **G → I → N → J**.

- **Phase G — Stripe Billing Skeleton (3 tasks):** light, gates first paying customer.
- **Phase I — Multi-Modal Capture Pipeline (10 tasks):** wires the decorative Capture toolbar to real upload paths. Direct synergy with `whatWouldClose` — once the tech can paste a service-manual photo, gate-clearance becomes seamless.
- **Phase N — Tablet Layout + Realtime Sync (6 tasks):** desktop dashboard view.
- **Phase J — Photo Storage Tiering (6 tasks):** cost discipline once I lands.

Phases K (Cross-Shop Corpus) and L (Bounded Internet Retrieval) remain blocked behind these per the original plan.
