# Shop OS Row 28 — Manual Parts Sourcing Design

## Outcome

Make manual parts sourcing a complete server workflow before any vendor transport: a shop records a manual supplier, captures a human-verified offer, fills a quote line without exposing internal vendor context to customer-facing projections, and can safely retry. PartsTech/O'Reilly search, punchout, ordering, and credentials remain out of scope.

This document is design authority only until the separately approved Row 27 migration exists in production and live invariants/advisors pass.

## Reconciled baseline

- Row 18 already lets every active shop role build a manual part line with description, part number, brand, quantity, customer price, unit cost, core charge, and fitment.
- Existing manual line mutation is actor/tenant/job scoped, retry-safe through a UUID client key, invalidates active quote truth, and never returns internal cost/vendor lifecycle fields.
- Existing quote-version snapshots retain customer-safe part fields and totals while replacing vendor context with `null`.
- Row 27 adds dormant source for server-only vendor accounts and same-shop line linkage, but production DDL is intentionally unapplied and no runtime module imports the table.
- No parts adapter, supplier-management handler, offer-capture handler, vendor search route, order table, or vendor UI exists.
- Row 38 owns order schema; Row 41 owns manual refresh/confirm/receive; Row 30 owns the sourcing UI. Row 28 must not pretend ordering is available.

## Smallest complete server slice

Row 28 adds four bounded pieces:

1. A provider-neutral adapter contract in `lib/shop-os/parts-adapters.ts`.
2. Manual supplier account handlers in `lib/shop-os/parts.ts` plus thin authenticated routes.
3. Manual-offer capture/removal handlers that write or remove one proposed `vendor_offer` quote line and preserve complete customer-safe quote totals.
4. A bounded quote projection/UI compatibility change that renders sourced lines read-only until Row 30 supplies sourcing controls.

No new sourcing UI ships in Row 28. The existing quote builder receives only the minimum discriminator/read-only rendering needed to avoid broken Edit/Remove controls. Row 30 owns the sourcing workflow UI after the live-schema gate. The LP writer owns adapter/handler work; the existing LQ/A owners independently review the bounded quote projection and compatibility render before merge.

## Adapter contract

The shared interface is deliberately small:

- `searchParts(input)` returns normalized offers or a typed `manual_entry_required` result.
- `refreshOffer(input)` returns a newly verified normalized offer or a typed unavailable result.

The manual adapter makes zero network calls. `searchParts` returns `manual_entry_required`; `refreshOffer` validates a human-entered capture and pins server time plus verifying actor. Transport-specific credentials, errors, rate limits, and external payloads cannot enter the manual implementation.

## Manual supplier accounts

Routes:

- `GET /api/shop/vendor-accounts` — every active quote builder receives enabled manual accounts; `canManageIntegrations` may request `scope=all` to include disabled rows. Both paths return exactly `{id,displayName,mode:'manual',enabled,updatedAt}`.
- `POST /api/shop/vendor-accounts` — `canManageIntegrations` (including its existing founder override); creates a manual account from `{clientKey, displayName}`.
- `PATCH /api/shop/vendor-accounts/:accountId` — the same capability; changes only `displayName` and `enabled` under exact `expectedUpdatedAt` CAS so mistakes can be corrected or an account disabled without deletion.

The server owns `vendor='manual'`, `mode='manual'`, `nonSecretConfig={}`, `secretRef=null`, and initial `enabled=true`. Unknown request keys—including `vendor`, `mode`, `config`, `secretRef`, credential-like fields, or provider identifiers—are rejected. No API/punchout account writer or reference resolver exists in Row 28, so the approved reference allowlist is empty.

`clientKey` becomes the proposed account UUID. The server reauthorizes the current tenant/capability before replay lookup; an exact normalized row retry returns unchanged truth, while any changed reuse conflicts. Account replay is tenant-bound, not actor-bound, because Row 27 deliberately added no creator/fingerprint column. Duplicate display names are allowed because one shop may have multiple commercial accounts or locations. Row 28 does not encode PartsTech/O'Reilly/Tri State/RepairPal as enums.

## Manual offer capture

Route:

- `POST /api/tickets/:ticketId/quote/jobs/:jobId/parts/manual-offers`

Strict input contains:

- UUID `clientKey` and `vendorAccountId`
- bounded description, part number, brand, fitment, and optional human reference
- exact quantity, extended customer `priceCents`, supplier unit cost, core charge, and required taxable flag using existing quote limits
- availability: `in_stock | special_order | unavailable | unknown`
- fulfillment: `pickup | delivery | ship | unknown` plus bounded location label

`clientKey` is the proposed `job_lines.id`. The request fingerprint hashes canonical user-controlled fields plus tenant, ticket, job, and account IDs; it excludes server-owned `fetchedAt`/verifier fields because they change on first execution. The fingerprint is stored in the strict snapshot. After current actor/ticket/job authorization, same-key/same-fingerprint replay returns unchanged before account-state/CAS or invalidation checks; changed reuse conflicts.

For a new capture, the server reuses the complete canonical quote mutation context and lock order: ticket → every ticket job sorted by ID → every ticket line sorted by ID → active quote versions → freshly loaded actor → selected vendor account. It requires an open reconciled ticket and the exact Row-17 quote-mutable target predicate narrowed to known work: `kind in ('repair','maintenance')` with `workStatus in ('open','blocked')`. It rejects every diagnostic, in-progress, done, canceled, or pinned simple-work job. Row 30 owns locked-diagnosis eligibility/seed behavior under its existing engine boundary; Row 28 never reads or writes session/engine state.

The account must be enabled, same-shop, manual, `secretRef=null`, and empty config. Availability `unavailable` returns a typed no-line result. Every other accepted state creates a `vendor_offer` part line with `partStatus='proposed'`, server-assigned next job sort, fixed `USD` currency, and optional bounded `externalOfferId`. `priceCents` is the complete extended customer price; supplier core charge is internal and is never silently added—any customer charge must already be included in `priceCents` or a separate visible fee line.

The canonical snapshot is version 1, capped at 4 KiB, and contains exactly: `schemaVersion`, `kind='manual_offer'`, `vendorAccountId`, capture-time `vendorDisplayName`, nullable `externalOfferId`, `currency='USD'`, quantity, unit/core cost, availability, fitment, fulfillment method/location, server `fetchedAt`, verifying profile ID, and request fingerprint. Null/trim/decimal/money normalization is shared by the manual adapter and persistence parser. Reads revalidate kind/source/account IDs, line/snapshot money and fitment parity, proposed status, absent order fields, snapshot grammar, and byte cap; malformed persisted truth fails closed.

Enabled/current account state gates only new capture or refresh. Historical `vendor_offer` lines and immutable quote versions validate from their strict capture-time snapshot plus the same-shop FK; they do not reload current account display/config/enabled state. Renaming or disabling an account therefore cannot hide or invalidate existing quote truth, while `ON DELETE RESTRICT` preserves every referenced account. Tests pin both rename and disable behavior.

`DELETE /api/tickets/:ticketId/quote/jobs/:jobId/parts/manual-offers/:lineId` removes only a proposed, unordered `vendor_offer` line under the same complete lock context and quote invalidation. Missing exact retries return unchanged after authorization. Corrections are remove-and-recapture; Row 28 does not make the ordinary manual-line PUT/DELETE accept sourced rows.

## Quote truth and privacy

Before the first `vendor_offer` line can persist, the safe quote builder must include every customer-visible line in its total. Its strict line projection adds `source: 'manual' | 'vendor_offer'` and `mutable: boolean`; sourced rows return the same customer-safe money/part fields as manual rows with `mutable=false`. It still omits unit cost, vendor account ID/name, external offer ID, availability, internal snapshot, verifier, and fulfillment. The existing quote UI/parser renders `vendor_offer` rows as `Sourced · read-only` and shows no Edit/Remove actions; Row 30 owns those sourcing controls.

Quote-version creation continues to validate bounded stored vendor JSON, include customer-safe line fields, compute totals server-side, and persist `vendorContext:null`. Customer approval never reveals supplier cost or internal sourcing metadata.

Exact internal response contracts are:

- account list/create/update: `{id,displayName,mode:'manual',enabled,updatedAt}` only;
- capture success: `{changed, line:{id,jobId,kind:'part',description,quantity,priceCents,taxable,partNumber,brand,fitment,source:'vendor_offer',mutable:false}, sourcing:{vendorAccountId,displayName,externalOfferId,unitCostCents,coreChargeCents,availability,fulfillment,fetchedAt}}`;
- unavailable: `{changed:false, unavailable:true}` with no line;
- removal: `{changed}` only.

The dedicated authorized sourcing response deliberately returns unit/core cost and human reference because existing quote builders may enter those internal values; it omits verifier profile ID and request fingerprint. General quote-builder and customer projections continue omitting all internal cost/vendor lifecycle fields. No route returns `nonSecretConfig`, `secretRef`, raw provider payloads, credentials, cookies, or authorization headers.

## Explicit non-goals

- no PartsTech, O'Reilly, Tri State, RepairPal, API, punchout, or live search
- no credential/reference creation or resolution
- no order preparation, placement, ordered/received transitions, or spend
- no sourcing UI, account settings UI, quote-send change, or customer page change
- no schema beyond the already reviewed Row 27 migration
- no production apply without explicit owner approval
- no diagnostic-engine, topology, prompt, risk, retrieval, corpus, or session change

## Verification and rollback

Unit/PGlite tests prove account allowlists/CAS, tenant-bound account replay, line-ID/fingerprint replay, unavailable/no-line behavior, remove/retry, tenant/role/state guards, complete sorted lock order, strict canonical offer snapshots, persisted-corruption refusal, complete quote totals, read-only UI compatibility, privacy projections, and zero provider invocation. Route tests prove strict envelopes and safe errors. The full suite, TypeScript, build, diff checks, independent LP/LQ/A review, and production smoke are required.

Rollback is the Row 28 source PR. The production prerequisite is separately reversible by dropping only the unused Row 27 line FK/table after proving zero references. Stop before any live DDL unless the owner approves the exact Row 27 migration; after apply, verify table/columns/checks/index/FKs/RLS/policy/grants, zero starting rows, advisors, and application health before writing Row 28 runtime code.
