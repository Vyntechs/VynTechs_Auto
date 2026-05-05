# Vyntechs Platform Split — Design Spec

**Date:** 2026-05-05
**Author:** Session 6 brainstorm (Brandon + Claude)
**Status:** Draft, pending Brandon's approval before writing-plans
**Supersedes:** Implicit single-product assumption in `2026-05-01-vyntechs-implementation-plan.md`

---

## Plain-English summary

Today, the Vyntechs codebase is one Next.js app that has accidentally grown two distinct product surfaces: an AI diagnostic tool (used by bay technicians on phones) and a shop management front-end (used by service advisors on desktops). The shop management surface was built into the diagnostic codebase as if it were "Phase O" of the diagnostic product, but it's actually the entry point of a separate product line.

This spec authorizes splitting the codebase into a **two-product platform** sharing a common identity layer, where each shop can independently subscribe to the diagnostic product, the shop management product, or both. The spec covers the architectural decisions and boundary rules. The phased migration steps live in a separate plan document produced by the writing-plans skill after this spec is approved.

The user-visible site does not change during the split. Production traffic to `vyntechs.dev` continues uninterrupted. What changes is internal organization.

---

## Goals

1. **Two independently-deployable products** sharing a common identity layer (auth, shops, profiles, customers, vehicles).
2. **Shop-level entitlements** — each shop subscribes to one or both products via Stripe; the apps enforce access at request time.
3. **No production downtime during the migration.** Every phase is independently rollback-able. The diagnostic product behaves byte-equivalently before, during, and after the split.
4. **Clean architectural boundaries** that prevent the future "we shipped a hack and now have to unhack it" tax. Specifically: no app importing from another app's code; all shared logic in named packages; one source of truth for the database schema.
5. **Forced correctness via a real second-app shell.** The shop management app exists as a deployable shell (auth-gated placeholder) from the moment of the split, even though no shop-management features are built. This validates the architecture under real conditions instead of theoretical ones.

## Non-Goals

- **Building any shop management features.** The shop management product is a placeholder shell only. All RO/estimate/parts/payments/DVI work is deferred to a future series of sessions, none of which are scoped here.
- **Re-architecting the diagnostic product internally.** Tree engine, corpus, retrieval, risk gating, comeback automation, multi-modal capture — all stay structurally as-is, just relocated into the diagnostic app's folder within the new layout.
- **Changing user-visible behavior.** Same URLs, same routes, same database, same Vercel project ID, same env vars, same Stripe integration. The split is a refactor, not a feature change.
- **Migrating data.** No row in the database moves. Schema additions for entitlements are minimal and additive (a new table, no breaking changes).
- **Eliminating the existing `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` flag mid-migration.** The flag stays in the code throughout stages 1-5. At the start of stage 1 it is set to `false` in production (turning off the partially-built shop management UI on `vyntechs.dev/intake/*`), but the flag itself remains until stage 6 where it is removed in favor of the entitlements check.

---

## Strategic context

Three distinct buyer types emerged from category research (Tekmetric, Shopmonkey, Mitchell1, AutoLeap, Shop-Ware):

- Shops who already have a shop management system (running their estimates, repair orders or "ROs", parts ordering, and customer billing) but want better diagnostic AI for their bay techs.
- Shops who want a shop management system replacement and don't care about AI.
- Shops who want both, integrated.

A single bundled product loses two of three. A split lets us address all three. The diagnostic product is a working AI tool today; the shop management product is a Tekmetric-class build-out that will take 3-6 months to be category-credible. Splitting now lets the diagnostic product ship and start generating revenue while the shop management product is built without architectural debt.

The cost of *not* splitting now is well-documented: shared layouts, shared middleware, one bundle, accidental coupling at the layer of shared session state, no clean way to sell or scope per-product access. By the time someone tries to extract a product later, the coupling is implicit and pervasive.

---

## Architectural decisions

Each decision below is a pinned commitment. An ADR (architecture decision record) document is written for each as part of the implementation plan.

### Decision 1: Monorepo (one git repository) over multi-repo

**Chosen:** Single git repository containing both products and their shared code.

**Alternatives considered:**
- Multi-repo: separate git repos per product, shared code published as private npm packages. Rejected because the products share a database schema; a multi-repo setup forces coordinated PRs across repos for every schema change, which the documented experience of teams (Drizzle community, Supabase docs) shows breaks down quickly with a small team.
- Single-app with feature flags: the current state. Rejected because it produced the present situation — accidental coupling, can't sell or scope per-product access.

**Reasoning:** Vercel, Linear, Stripe, Shopify, Dub.co, and the `next-forge` template all converge on monorepo for two-or-more related products with shared identity. Vercel's documentation treats the monorepo case as the first-class deployment shape.

### Decision 2: Turborepo + pnpm workspaces

**Chosen:** Turborepo as the build orchestrator, pnpm as the package manager, pnpm workspaces for inter-package linking.

**Alternatives considered:**
- pnpm workspaces alone: no build caching, no "skip unaffected" support on Vercel. Loses the operational benefit of monorepo at scale.
- Nx: feature-rich but heavier than the team needs. Module-boundary enforcement and code generators are valuable for 50-engineer teams; not for a solo founder.
- Lerna / Rush / Yarn Berry: superseded by Turborepo for the Vercel + Next.js stack.

**Reasoning:** Turborepo is Vercel's own tool, ships first-class with Vercel deployments, integrates natively with Vercel's "automatic skip-unaffected projects" feature. `next-forge` (Vercel's reference SaaS template) uses this exact combination. Documented as the default in 2025-2026 monorepo write-ups across the ecosystem.

### Decision 3: Layout

**Chosen:**

```
vyntechs/
  apps/
    diagnostic/          ← all the AI tool's code, behaves identically to today
    shop/                ← deployable Next.js shell with auth + placeholder page
  packages/
    db/                  ← Drizzle schema, client factory, migrations, RLS policies
    auth/                ← Supabase auth helpers, middleware utilities, session shapes
    ui/                  ← shared shadcn primitives used by both apps
    billing/             ← Stripe client, entitlements logic, webhook handlers
    config/              ← shared tsconfig, eslint, tailwind, prettier presets
    types/               ← shared domain types (Shop, Profile, Customer, Vehicle, Entitlement)
  turbo.json
  pnpm-workspace.yaml
  ARCHITECTURE.md        ← living architecture reference (created as part of migration)
  docs/decisions/        ← ADRs (one per pinned decision)
```

**Alternatives considered:**
- All shared code in one mega-package: simpler to start, but rebuilding the entire shared package on any change defeats Turborepo's caching. Splitting by concern (db / auth / ui / billing) is the documented best practice.
- Putting Drizzle schema inside the diagnostic app: works today but commits the original sin of "the database belongs to one app." Future Brandon would have to extract it later.

### Decision 4: Deployment topology — two Vercel projects, one repo

**Chosen:**
- The existing `vyntechs-dev` Vercel project is retargeted to deploy from `apps/diagnostic`. Domain (`vyntechs.dev`), aliases (`staging-rc.vercel.app`), env vars, Stripe webhook URLs, and Cron job registrations are preserved. Production deployment continuity is the highest constraint.
- A second Vercel project (working name: `vyntechs-shop-dev`) is created, pointing at the same repo, root directory `apps/shop`. It deploys an auth-gated placeholder page on `shop.vyntechs.dev` until shop management features begin.

**Alternatives considered:**
- One Vercel project with multiple deploys: documented as unsupported by Vercel for separate apps from one repo.
- Re-creating the diagnostic Vercel project from scratch: would lose env vars, aliases, Stripe webhook config, and prod history. Rejected.

**Implications:**
- Team-level env vars hold shared values (`SUPABASE_URL`, `DATABASE_URL`, `ANTHROPIC_API_KEY`).
- Project-level env vars hold app-specific values (`NEXT_PUBLIC_APP_URL`, app-specific Stripe price IDs).
- Vercel's auto skip-unaffected is enabled on both, so a PR touching only `apps/diagnostic` does not redeploy `apps/shop`.

### Decision 5: Schema ownership — `packages/db` is the source of truth, migrations run from CI

**Chosen:** The Drizzle schema (table definitions, relations, RLS policies, inferred types) lives in `packages/db`. Both apps consume it via `@repo/db`. Migrations are applied to the live Supabase database via a single GitHub Action gated on changes under `packages/db/migrations/**`.

**Alternatives considered:**
- Migrations bundled into one app's deploy hook: simpler, but couples deployment timing of the two apps. Rejected to keep the apps as peers.
- Schema duplicated across both apps: rejected on basic correctness grounds.

**Implications:**
- The existing AGENTS.md note that "migrations are applied via the Supabase MCP `apply_migration` tool, not Drizzle's CLI" continues to apply for ad-hoc / interactive migrations. The CI job is the new mechanical path; the MCP tool is the manual escape hatch when needed.
- Both apps must declare `@repo/db` as a workspace dependency and add it to their `transpilePackages` config. Forgetting this is the documented #1 break point for this kind of migration.
- `drizzle-orm` is installed exactly once at the repo root and hoisted via pnpm. Multiple installs cause `instanceof` failures across workspace boundaries.

### Decision 6: Entitlements model

**Chosen:** A four-layer model with both shop-level (paid-for) and per-profile (admin-granted) access:

1. **Stripe Entitlements API as source of truth for what the shop has paid for.** Define two `Feature`s in Stripe (`diagnostic_access`, `shop_mgmt_access`); attach them to Stripe Products; customer subscriptions automatically grant entitlements at the shop level.

2. **Cached shop-level projection in our database.** A new `shop_entitlements` table — `(shop_id, feature_key, status, stripe_subscription_id, granted_at, expires_at)` — updated by Stripe webhooks on `customer.subscription.*` events. RLS policy: a row is visible only to members of that shop.

3. **Per-profile overrides administered by the shop owner.** A second new `profile_entitlements` table — `(profile_id, feature_key, status, granted_at, revoked_at, granted_by_profile_id)`. This is set by the shop owner via an admin UI (not built in this spec; lives in the future shop settings surface). Lets a shop owner say "Marcus has access to diagnostic; Diana doesn't" within a shop that pays for diagnostic_access.

4. **Enforcement at each app's middleware via a single helper.** A `hasEntitlement(shopId, profileId, featureKey)` helper in `packages/auth` evaluates:
   - If the shop does not have the feature → **deny**.
   - If the profile has an explicit `'revoked'` row for the feature → **deny**.
   - Otherwise → **allow**. (Shop entitlement is the floor; per-profile rows opt OUT, not opt IN.)

   Each app calls this helper in middleware: `apps/diagnostic` checks `'diagnostic_access'`; `apps/shop` checks `'shop_mgmt_access'`. Missing entitlement redirects to the upgrade page. Neither app references the other's feature key.

**Why "default-allow with opt-out" instead of "default-deny with opt-in":** Brandon's expected v1 use case is shops with 5-10 techs where most techs use the AI tool. Default-allow means a shop owner doesn't have to manually grant every new hire — they're auto-included when the shop pays for the feature. Revocations are the exception, not the rule. Modeling exceptions as the rule (default-deny) creates ongoing admin overhead for every shop.

**Alternatives considered:**
- A `shops.products` JSONB column: simpler shape, but loses per-feature `expires_at` and Stripe subscription linkage. Rejected.
- Per-tech entitlements deferred to v2: rejected based on Brandon's explicit input — beta-tester techs are ready and need the per-tech granularity from day one.
- Default-deny per-tech (techs must be explicitly granted access): rejected as creating admin overhead without offsetting benefit for v1.

**Note:** This deliberately does not use feature flags. Feature flags are for gradual rollout of code; entitlements are for who paid for what and who has been granted access. Conflating them is a common architectural mistake and creates a mess in both surfaces.

### Decision 7: App-to-app boundary rule (no cross-imports)

**Chosen:** Apps may import from any package in `packages/*`. Apps may NOT import from another app's code. If two apps need shared logic, that logic moves to a package.

**Enforcement:** ESLint rule (`no-restricted-imports`) configured in the shared `packages/config` to error on imports matching `apps/*` from another `apps/*`. Build fails on violation.

**Alternatives considered:** trust + code review. Rejected because the documented failure mode of monorepos is exactly cross-app imports sneaking in over time. The lint rule is non-negotiable.

---

## Data shape — schema additions

Two new tables:

```
shop_entitlements
  id                       uuid (pk)
  shop_id                  uuid (fk → shops.id, ON DELETE CASCADE)
  feature_key              text (e.g., 'diagnostic_access', 'shop_mgmt_access')
  status                   text ('active' | 'past_due' | 'canceled' | 'trialing')
  stripe_subscription_id   text (nullable; null for manually-granted entitlements)
  granted_at               timestamptz
  expires_at               timestamptz (nullable)
  created_at               timestamptz default now()
  updated_at               timestamptz default now()

  unique (shop_id, feature_key)
  index on (shop_id, feature_key)  -- middleware lookup pattern
```

```
profile_entitlements
  id                       uuid (pk)
  profile_id               uuid (fk → profiles.id, ON DELETE CASCADE)
  feature_key              text (e.g., 'diagnostic_access', 'shop_mgmt_access')
  status                   text ('active' | 'revoked')  -- 'revoked' overrides shop access
  granted_at               timestamptz
  revoked_at               timestamptz (nullable)
  granted_by_profile_id    uuid (fk → profiles.id; the shop owner / admin who set this)
  created_at               timestamptz default now()
  updated_at               timestamptz default now()

  unique (profile_id, feature_key)
  index on (profile_id, feature_key)  -- middleware lookup pattern
```

RLS policies:
- `shop_entitlements`: members of `shop_id` may select; service role only may write (Stripe webhook).
- `profile_entitlements`: members of the same shop as `profile_id` may select; only profiles with `role = 'owner'` in that shop may insert/update (admin-only writes).

No other schema changes. No data migrations.

---

## Migration approach (high level)

The full step-by-step plan is produced by the writing-plans skill after this spec is approved. The high-level shape, drawn from the documented best-practices research:

**Stage 0 — Pre-migration baseline (no code changes).**
Tag current `main` as the rollback line. Snapshot Vercel env vars. Capture build size and key route response samples for regression checks. Confirm tests are 378/378 green.

**Stage 1 — Reshape the repo, no logic changes.**
Add `pnpm-workspace.yaml`. Move the entire current app into `apps/diagnostic/` verbatim. Add a minimal root `package.json`, `turbo.json`, shared `tsconfig.base.json`. Verify `pnpm install` and `pnpm --filter diagnostic dev` bring up the existing app exactly as before. **Tests still 378/378.** Deploy to staging-rc, run the gap audit on staging-rc as today, do not touch prod yet.

**Stage 2 — Extract shared packages, one at a time, in dependency order.**
Each package extraction is a separate commit:
1. `packages/config` (tsconfig, eslint, tailwind, prettier presets — extracted first because everything depends on these).
2. `packages/types` (shared domain types).
3. `packages/db` (Drizzle schema, client, migrations, RLS).
4. `packages/auth` (Supabase helpers, middleware utilities).
5. `packages/billing` (Stripe client, entitlements logic, webhook handlers).
6. `packages/ui` (shared shadcn primitives).

After each extraction: run tests, deploy to staging-rc, verify the diagnostic product behaves identically, then proceed.

**Stage 3 — Add the entitlements layer.**
Create `shop_entitlements` and `profile_entitlements` tables via Drizzle migrations. Add Stripe webhook handler for `customer.subscription.*` events that maintains `shop_entitlements`. Add `hasEntitlement(shopId, profileId, featureKey)` helper in `packages/auth` (default-allow with per-profile opt-out semantics from Decision 6) and wire it into the diagnostic app's middleware. **At this stage, the diagnostic app starts requiring `diagnostic_access` entitlement to use.** Pre-grant the shop-level entitlement to existing test shops (Brandon's shop and Angel's shop) so prod traffic is not affected. Per-profile rows are not pre-populated; default-allow means existing techs continue to work without per-row admin action.

**Stage 4 — Create the shop placeholder app.**
Scaffold `apps/shop` with Next.js 16, auth via `@repo/auth`, a single placeholder page. Add the `requireEntitlement('shop_mgmt_access')` check. Create the second Vercel project pointing at `apps/shop`. Confirm both apps deploy independently from the same PR.

**Stage 5 — Operational wiring.**
Set up the migration CI job (GitHub Action gated on `packages/db/migrations/**`). Configure team-level Vercel env vars. Enable auto skip-unaffected on both projects. Add the cross-app no-imports lint rule. Update `AGENTS.md` to reflect the dual-product model.

**Stage 6 — Production cutover.**
Final staging-rc validation. Brandon's eyeball. Merge to `main`. Vercel auto-deploys both projects. Verify diagnostic product works end-to-end on prod (the existing gap-audit checklist). Confirm `apps/shop` placeholder is reachable but auth-gated. Remove the `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` flag (replaced by entitlement check, no longer needed). Tag the post-migration commit as the new baseline.

**Each stage is independently rollback-able.** Reverting any single stage's commit returns the repo to a working state. This is the property the migration sequence was designed to preserve.

**Estimated effort:** 8-12 hours of focused work, expected to span 2-3 sessions with explicit stop points between stages. No single session attempts to do all six stages.

---

## What this spec does NOT decide

These are deliberately punted to keep the spec focused:

- **The admin UI for managing per-profile entitlements.** The `profile_entitlements` table is in v1, but the screen the shop owner uses to grant/revoke access lives in a future shop settings surface. Until that screen exists, per-profile entitlements can be administered via direct database write (`apply_migration` or service-role insert). Default-allow semantics mean this is rare in practice.
- **The shape of the shop management product.** Separate spec, separate brainstorm, separate research (already partially captured in the Session 6 conversation transcript covering Tekmetric, category competitors, and parts integration ecosystem).
- **The bridge contract** (how the AI tool's `/api/intake/plan` endpoint gets called from the shop management app when both products are enabled). This becomes relevant when shop management features begin; designing it now without a real consumer is premature.
- **Customer-facing pricing.** Strategic / product question.
- **Multi-shop / chain support.** The current schema already supports `shop_id` per row, but the explicit modeling of "an organization owning multiple shops" is deferred.
- **What happens at `/intake/*` after stage 1.** The route is gated to 404 by the existing feature flag (set to `false` in production). The diagnostic product's tech intake form remains at `/sessions/new` — unchanged from today. The `/intake/*` route returns when the shop management product begins shipping; it then lives on `shop.vyntechs.dev` instead of `vyntechs.dev`.

---

## Boundary rules summary

The four rules that prevent future architectural debt:

1. **No `apps/X` may import from `apps/Y`.** Enforced by lint rule. If two apps need the same logic, it goes in a package.
2. **`packages/db` is the source of truth for the schema.** No schema definitions, migration files, or RLS policies anywhere else in the codebase. Migrations run from a CI job, not from app code.
3. **Each app's `transpilePackages` config must list every workspace package it uses.** Forgetting this is the documented #1 build failure mode and worth a checklist item per app.
4. **`drizzle-orm` is installed once at the root and hoisted.** Never installed inside a package or app.

---

## References

Research synthesized for this spec is summarized in the conversation transcript of session 6. Key sources cited inline:

- [Vercel: Using Monorepos](https://vercel.com/docs/monorepos)
- [Vercel: Deploying Turborepo](https://vercel.com/docs/monorepos/turborepo)
- [Vercel `next-forge` template](https://github.com/vercel/next-forge)
- [Dub.co: Migrating to Turborepo](https://dub.co/blog/turborepo-migration)
- [Drizzle + Supabase RLS in a monorepo (Zenn)](https://zenn.dev/azuma317/articles/drizzle-supabase-rls-monorepo?locale=en)
- [Stripe Entitlements API](https://docs.stripe.com/billing/entitlements)
- [Schematic: Feature flags vs entitlements](https://schematichq.com/blog/feature-flag-management)
- [Next.js: `transpilePackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)
- [shadcn/ui: Monorepo docs](https://ui.shadcn.com/docs/monorepo)

---

## Approval

This spec is the brainstorm's terminal artifact. The implementation plan, ADR set, and `ARCHITECTURE.md` document are produced by the writing-plans skill **only after Brandon approves this spec**.
