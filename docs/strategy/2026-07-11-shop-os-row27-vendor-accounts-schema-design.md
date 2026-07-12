# Shop OS Row 27 — Vendor Accounts Schema and Secret References

## Outcome

Add the source-only tenant boundary for parts-vendor accounts without storing a credential, calling a provider, or changing production. Row 28 can build a complete manual adapter on this table; Rows 29 and 43 remain blocked on separately approved external access.

## Reconciled baseline

- Production has no `vendor_accounts` table and the two current `job_lines` contain zero non-null `vendor_account_id` values.
- `job_lines.vendor_account_id` already exists without a foreign key so quote work could ship before vendor identity.
- Current Shop OS tables are server-only: RLS enabled, all table privileges revoked from `anon`/`authenticated`, `service_role` CRUD granted, and explicit deny policies retained as defense in depth.
- Production has Supabase Vault `0.3.1`, but current Supabase documentation still labels Vault public alpha. Row 27 therefore stores an opaque reference only and does not depend on the extension.
- Drizzle metadata ends at `0028` even though source/live migration `0029_adaptive_diagnostic_state` exists. Historical snapshots are malformed to the current generator, so Row 27 must not regenerate or absorb unrelated adaptive SQL.

## Minimal schema

`vendor_accounts` owns:

- `id`, `shop_id`, `vendor`, `display_name`
- `mode`: `manual | api | punchout`
- `non_secret_config`: bounded JSON object, empty by default
- `secret_ref`: nullable reference, never a credential
- `enabled`, `created_at`, `updated_at`

Tenant identity is structural: `vendor_accounts.shop_id` references `shops.id` with `ON DELETE CASCADE`, `(shop_id, id)` is unique, and `job_lines(shop_id, vendor_account_id)` references it with `ON DELETE RESTRICT`. A line can never attach an account from another shop, and referenced history prevents account deletion.

## Secret boundary

`secret_ref` accepts only one of two reference shapes:

- `env:` followed by `^[A-Z][A-Z0-9_]{2,127}$`
- `vault:` followed by a canonical lowercase UUID matching versions 1–5

The complete database regex is `^(env:[A-Z][A-Z0-9_]{2,127}|vault:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`. Manual accounts require `secret_ref IS NULL`; API and punchout accounts require a reference-shaped value. This proves syntax, not the semantics of arbitrary matching text. Row 27 has no writer, resolver, or credential path. `non_secret_config` is an object capped at 4 KiB; before Row 28 writes either field it must allowlist vendor-specific config keys/types plus approved reference identifiers and resolver mappings. Raw API keys, passwords, cookies, bearer tokens, provider responses, and approval tokens remain forbidden.

No foreign key points into `vault.secrets`: the schema stays portable and a secret-manager change does not rewrite domain identity. Resolving a reference is future server-only adapter work.

## Validity and access

- `vendor` is a normalized 2–64 character lowercase slug.
- `display_name` is trimmed and 1–120 characters.
- `mode`, reference/mode pairing, JSON shape/size, and reference grammar are database checks.
- An index on `(shop_id, enabled, vendor)` supports the Row 28 account list.
- The standard ephemeral database helper applies `0030` after its guarded `0029` fallback. It checks the complete Row 27 object set—table, columns, constraints, index, RLS policy, grants, and `job_lines` foreign key—so every later test fixture sees the same schema; zero markers means absent, every marker means complete, and anything between fails as partial without changing malformed Drizzle metadata.
- RLS and grants match the existing server-only Shop OS pattern.
- No seed rows are created. Arbitrary local suppliers remain possible through a manual account; PartsTech, O'Reilly, Tri State, and RepairPal assumptions are not encoded as enums.

## Explicit non-goals

- no live migration or production data change
- no credential creation, retrieval, logging, or repository secret
- no PartsTech, O'Reilly, Tri State, RepairPal, Vault, or environment call
- no adapter, search, offer, order, quote UI, or browser payload
- no diagnostic-engine, topology, prompt, risk, retrieval, corpus, or session change
- no repair of historical Drizzle metadata in this row

## Verification and rollback

PGlite applies the real source migration through the standard test helper and proves valid manual/reference rows, hostile reference rejection, bounded config, parent-shop and cross-tenant FK rejection, RLS/grants/policy catalog shape, and `job_lines` delete protection. Static schema tests prove the Drizzle model matches the migration. This is local catalog/constraint proof, not a claim of real Supabase role-session enforcement. The full suite, TypeScript, build, diff checks, and independent review must pass.

Rollback is source-only: revert the Row 27 PR. Nothing is applied to production. Stop before any live DDL, provider access, credential, spend, or scope expansion into the diagnostic engine.
