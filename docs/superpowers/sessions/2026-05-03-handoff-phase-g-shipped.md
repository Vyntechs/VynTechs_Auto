# Vyntechs MVP — Handoff (2026-05-03, Phase G shipped)

Supersedes `2026-05-03-handoff-phase-k-shipped.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if next phase has UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **282/282 tests**, exit 0, build clean.
4. Pick next phase per "Next session" below. Recommended: **Phase I (Multi-Modal Capture)** to close the two-way evidence channel UX gap.

## State

- Branch `feature/mvp-implementation`, **~99 commits ahead of `main`**, working tree clean after this session's commits.
- Tests **282/282**, tsc clean, `pnpm build` clean.
- Stripe live account `acct_1SDW6rQptdIv3B1M` (VynTechs) reset: 4 legacy products archived, **Vyntechs Pro** created at `price_1TT0POQptdIv3B1MzfCwgZjd` ($700/mo USD recurring, `prod_URuDaNByWT83H0`).

## What shipped this session

- **A5** (Phase A leftover): Stripe SDK 22.1.0 installed. `lib/stripe.ts` with lazy-Proxy client (mirrors `lib/ai/client.ts` pattern). Webhook route at `app/api/stripe/webhook/route.ts` is a thin shim around `handleStripeWebhook` per AGENTS.md handler-in-lib convention. Plan's pinned `apiVersion: '2025-08-27.basil'` dropped — SDK 22 ships with `2026-04-22.dahlia` as `LatestApiVersion` and the older string fails the type guard. Omitted to use SDK default.
- **G1**: `ensureStripeCustomer({ db, shopId, email, createCustomer? })` in `lib/stripe.ts` — idempotent (returns existing row's `stripeCustomerId` before calling Stripe). `requireUserAndProfile` takes optional `ensureCustomer` DI; default uses real `ensureStripeCustomer`. Failures swallowed in caller so sign-in never blocks on Stripe.
- **G2**: `createBillingPortalSessionForUser({ db, userId, origin, createPortalSession? })` handler. Thin `POST /api/stripe/portal` shim. `/billing` page is a server component that renders `BillingClient` (client component) — button → fetch portal URL → `window.location.href = url`. Uses existing `.btn-primary` and `Module`/`AppHeader` from `components/vt`; the plan's reference to `@/components/ui/button` (shadcn) was stale (no shadcn in repo).
- **G3**: `handleStripeWebhook` now takes `db: AppDb`. Subscription lifecycle events (`customer.subscription.created`/`updated`/`deleted`) update `stripe_customers.subscription_status` and `currentPeriodEnd`. `readSubscriptionPeriodEnd` reads top-level `current_period_end` first, falls back to `items.data[0].current_period_end` (forward-compat for API versions where the field moved). Non-subscription events pass through.

## New env vars (Vercel preview/prod)

All three still empty in `.env.local` — pre-Phase G they were placeholders, post-Phase G the code uses them at runtime:

- `STRIPE_SECRET_KEY` — required for `stripe.customers.create` (G1) and `stripe.billingPortal.sessions.create` (G2).
- `STRIPE_WEBHOOK_SECRET` — required for `stripe.webhooks.constructEvent` (A5/G3). Obtainable only after registering the webhook endpoint in the Stripe dashboard.
- `STRIPE_PRICE_ID` — set to `price_1TT0POQptdIv3B1MzfCwgZjd` for live. Phase G code does not consume it (no subscribe CTA yet); becomes relevant in a future phase that mounts a Checkout link.

## Carryovers

- **Test mode product/price not yet created** — only live mode exists. For local dev the next session either creates a test-mode equivalent (Stripe dashboard → toggle "Test mode" → re-run product/price creation) or accepts that local dev cannot exercise the live Stripe API. Code is DI-friendly so unit tests don't need either.
- **Stripe webhook endpoint not registered.** Until it is (Stripe dashboard → Developers → Webhooks → add `https://<host>/api/stripe/webhook`, subscribe to `customer.subscription.*`), `STRIPE_WEBHOOK_SECRET` is unobtainable.
- **Webhook idempotency / replay protection not implemented.** Stripe redelivers events on receiver-error; current handler is last-write-wins on identical fields, which is fine for the three subscription event types but should track `event.id` once we add anything with side effects beyond a row update.
- **Billing page a11y audit deferred.** `(app)` group requires auth; full audit needs an authenticated browser session. Static a11y verified via component tests (button has accessible name, error region has `role="alert"`). Add to the next a11y sweep alongside `OutcomeCapture` (Phase F a11y carryover).
- **First test run was flaky** when `pnpm test` ran in parallel with `pnpm build` (filesystem contention on `.next/`). 19 false failures in first run, 0 in second run. Run gates serially or wait for build to finish.
- **All earlier carryovers from `2026-05-03-handoff-phase-k-shipped.md`** still apply (latency stack-up, observability hook missing, comeback workflow not wired, RLS policies, etc.).

## Next session — likely focus

Ask Brandon; don't pick. Recommended order through the remaining phases:

1. **Phase I — Multi-Modal Capture** (10 tasks). Wires the visually-present-but-unwired Voice/Photo/Video/Scan buttons (the two-way evidence channel UX gap Brandon flagged 2026-05-02).
2. **Phase O — Desktop Intake** (5 tasks). Front-counter screen for starting a session. *(Reactivated 2026-05-03 — was previously deferred.)*
3. **Phase P — Curator Console** (7 tasks).
4. **Phase Q — Calibration Engine** (5 tasks).
5. **Phase R — Comeback Follow-Up Automation** (5 tasks).

## STOP-AND-ASK phases (deferred, decided 2026-05-03)

**Do not start Phases J, N, or S without explicit go-ahead from Brandon.** Brandon wants to be notified when those phases come up so he can decide whether to greenlight or keep deferred.

- **Phase J — Photo Storage Tiering** (6 tasks). Deferred for AWS cost-surprise concerns (2026-05-02).
- **Phase N — Tablet Layout + Real-Time Sync** (6 tasks). Deferred — phone-first, tablet later.
- **Phase S — End-to-End + Production Deploy** (4 tasks). Deferred until Brandon greenlights real-world launch. Don't deploy production without him.

If a future session reaches a natural point where one of these is the next step, **stop, surface it to Brandon, get explicit approval before touching it.**

Recommend `/clear` before starting next phase.
