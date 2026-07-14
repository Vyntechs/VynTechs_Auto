# Diagnostics as a per-shop add-on + AutoEYE fact-layer integration — plan

Status: DRAFT for founder review. Docs only — this document changes no code,
no schema, no behavior. Merging this PR accepts the plan into the backlog;
each phase below still has its own approval gate before any build starts.

Spec-amendment flag: the Shop OS spec
(`docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`, line 5) treats the
diagnostic engine as the always-on centerpiece with behavior frozen. The
founder has directed that diagnostics become an optional per-shop add-on.
Accepting this plan amends that assumption. Engine *behavior* stays frozen —
this plan gates access to the engine; it does not change what the engine does.

## 1. The product decision this encodes

Founder direction (2026-07-13): diagnostics becomes an add-on option — not
every shop will have it. Requirements, verbatim in intent:

- It must be surgically selectable/optional per shop.
- The flow must be smooth **without** it — no dead ends, no amputated product.
- **With** it, it must be completely integrated and feel as one — not bolted on.

Design principle that satisfies all three: **gate the capability, not the
flow — both paths produce the same object on the ticket.** The flow is defined
by the data shape; the add-on only changes who fills it.

## 2. Ground truth (verified on main @ `743f7df`, 2026-07-13)

What already exists and is load-bearing for this plan:

| Fact | Where |
| --- | --- |
| Paywall is binary per shop: `stripe_customers` (shopId PK, `subscriptionStatus`, `currentPeriodEnd`); no plan/tier/entitlement column anywhere | `lib/db/schema.ts:1674` |
| Enforcement is global middleware → `checkAccess()` (deactivated → comp bypass → Stripe status), plus `paywallReject()` defense-in-depth in handlers | `middleware.ts:74`, `lib/auth-access.ts:73,117` |
| A per-surface gate pattern already exists: `guardCuratorRoute` (founder-only curator) | `middleware.ts:50` |
| The ticket is the spine; the session is an optional attachment (spec §3.1/§3.2) | spec line 124; `lib/db/schema.ts:251,372` |
| Only `ticket_jobs.kind='diagnostic'` may carry a nullable, unique `sessionId` | `lib/db/schema.ts:465` |
| Plain-language findings live on the job regardless of session: `customerStory` JSONB (`whatYouTold Us` / `whatWeFound` / `howWeKnow` / `whatWeRecommend`) + `workNotes` | `lib/db/schema.ts:32` |
| Quote lines already flow from a locked diagnostic session: `job_lines.source='diagnosis_seed'`, `getQuoteBuilder()` reads locked-session events (Row 30, complete) | `lib/db/schema.ts:611`, `lib/shop-os/quotes.ts:442-555` |
| Sessions/intake are entered from the ticket/job flow, not top-level nav; nav is My Jobs / Settings / Curator(founder) | `components/vt/app-header-menu.tsx` |
| Existing feature flags are global env booleans, not per-shop | `lib/feature-flags.ts` |

Consequence: this is an **extension, not a refactor**. The with/without split
already exists in the data model (`sessionId` nullable, `customerStory` always
present). What is missing is only (a) a per-shop entitlement representation,
(b) gates on the diagnostic surfaces, (c) the manual-findings affordance in
the slot where "Start diagnosis" lives today.

## 3. Phase 0 — the entitlement seam (VynTechs_Auto)

The only phase that touches billing/access. Smallest change that supports
more than one add-on later (AutoEYE metering will want the same rail):

1. **`shop_entitlements` table** — `shopId` (PK/FK), `diagnostics boolean
   not null default false`, `stripePriceId`, timestamps. Migration applied via
   Supabase MCP per house rules (Drizzle files decorative).
2. **Resolution in one place** — extend `checkAccess()`'s result with an
   `entitlements` object; single helper `hasDiagnostics(shopId)`. `isComp`
   implies all entitlements. No Stripe checks scattered anywhere else.
3. **Stripe** — diagnostics add-on as a subscription item on the existing
   per-shop subscription; the existing webhook maps subscription items →
   `shop_entitlements`. Pricing amounts are config, deliberately not decided
   here (see §6 — an unresolved pricing contradiction already exists).
4. **Gates** — mirror `guardCuratorRoute` for `app/(app)/sessions/*`,
   `app/(app)/intake`, `app/api/sessions/*`, `app/api/intake/*`; an
   `entitlementReject()` twin of `paywallReject()` for defense-in-depth in
   handlers and server actions. Fail closed.

### The one-slot UX rule (with vs without)

```text
ticket → job (kind: diagnostic)
              │
              ├─ shop HAS diagnostics add-on
              │    [Start diagnosis] ──► copilot session (existing flow)
              │         └─ lock-in ──► customerStory filled +
              │                        job_lines source='diagnosis_seed'
              │
              └─ shop WITHOUT add-on
                   [Record findings] ──► tech fills customerStory
                        └─ manual job_lines (existing manual entry)

  downstream (quote → approval → invoice → history → messaging)
  reads customerStory + job_lines and NEVER knows which path filled them
```

One action slot on the job. With the add-on it reads "Start diagnosis";
without, "Record findings." The only permissible upsell affordance lives in
that same slot ("Diagnose with AI — add-on") — no banners, no dead tabs, no
nav change (sessions were never in the nav). Everything downstream of the job
is untouched because both paths write the same shapes that Row 30 already
consumes.

Verification for Phase 0: `pnpm test && pnpm exec tsc --noEmit && pnpm build`,
plus e2e for both flows (entitled shop reaches a session; unentitled shop
completes ticket → findings → quote with no dead ends and gets 403s on
`/api/sessions/*`).

## 4. Phases 1–3 — AutoEYE fact layer (rides inside the add-on)

AutoEYE/UDK (separate repo, `Vyntechs/AUTOEYE`) is a rights-clean automotive
fact layer: first-person verified observations (kernel-ID component labels,
wire counts, flow relations; never OEM manual content, never pins/wire colors
from restricted sources; unknowns are explicit open slots), owner-reviewed
records, mechanical lint enforcement. Its doctrine and this repo's
(`docs/interactive-diagnostics/MASTER-BUILD-BRIEF.md` §2/§7: "generate, don't
copy," provenance-or-refusal) are the same posture from two directions.

All three phases sit behind `hasDiagnostics` — one entitlement, one seam —
which also gives AutoEYE usage metering a free hook later.

- **Phase 1 — AutoEYE serving surface (AUTOEYE repo, not this one).** A
  read-only, versioned way to serve `APPROVED_INTERNAL`+ observation records
  (structured JSON per `schemas/observation_record.schema.json`). No
  VynTechs_Auto changes.
- **Phase 2 — retrieval adapter.** Implement `RetrievalAdapter`
  (`lib/retrieval/types.ts`) as `autoeye.ts`, weight ~0.95 (sorts first,
  above nhtsa .90); register in the six `ADAPTERS` arrays. Snippets are
  rendered from observation-record statements with provenance ("first-person
  verified observation, owner-reviewed"). Rights-clean by construction —
  the one evidence rung with zero scraping exposure.
- **Phase 3 — knowledge-graph feed (the real prize).** Map observation
  records into the existing (currently unfed — MASTER-BUILD-BRIEF §4: zero
  production callers) knowledge-graph tables: components/relations →
  `components`/`component_connections`/`architecture_facts` with
  `sourceProvenance='FIELD-VERIFIED'`; AutoEYE `open_slots` → `'GAP'` rows.
  Pins/wire colors stay GAP until owner-originated photographs fill them —
  both repos' identical rule. This powers the deterministic topology path
  (`lib/diagnostics/load-system-topology.ts`) that bypasses the generated
  tree, the same shape the curator flows (PR #104) prove out from the human
  side.

Each phase is its own lane, own plan detail, own approval gate, per this
repo's AGENTS.md (engine/retrieval changes require a separate plan; Phase 2/3
will get one each before build).

## 5. What this plan does NOT do

- No pricing amounts or tier names (owner decision; see §6).
- No engine behavior change — thresholds, risk rules, prompts untouched.
- No migration applied, no schema change, no code in this PR.
- Does not touch the open brand question (Vyntechs vs PlainWrench, PR #150)
  or the PlainWrench overlap — flagged, not resolved.
- No live customer data is read or moved in any phase. AutoEYE supplies
  facts; it never extracts from this product's data.

## 6. Owner decisions needed (in order)

1. **Accept the spec amendment** — diagnostics becomes optional per shop
   (merging this PR records that acceptance).
2. **Approve Phase 0 build** (entitlement table + gates + one-slot UX).
3. **Pricing model** — blocks Stripe wiring, not Phase 0 structure. Note
   PR #150 already flagged live-site "$100/technician-seat" vs README/Stripe
   "per-shop": that contradiction should be resolved in the same decision.
4. **Approve Phase 1** (AutoEYE-side serving surface) — can proceed in the
   AUTOEYE repo in parallel with Phase 0 if desired.
