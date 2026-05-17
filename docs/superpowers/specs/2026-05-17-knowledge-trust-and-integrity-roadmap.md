# Knowledge platform — Trust & Integrity Roadmap (Roots A–H)

**Status:** Scoped 2026-05-17 in fresh session. Each root is a separate PR. Sequence by priority below; each section is self-contained so a fresh Claude Code session can pick up at the matching kickoff prompt.

**Origin:** PR 6 validation surfaced multiple pre-existing PR 5b bugs (`/knowledge` crash, paste-sheet unstyled, AI JSON malformation). After fixing those, we identified 12 distinct failure modes in the add-knowledge flow. This roadmap collapses those 12 symptoms onto **8 root-cause fixes** — most are 1:1, three (A, B, D) each kill multiple symptoms with one mechanism.

**Base for every PR:** cut from `origin/staging` (the knowledge platform sequence lives on staging until the whole chain ships to main).

---

## Priority order

1. **Root A** — AI must show its work (Tier 1 trust)
2. **Root B (DTC subset)** — DTC normalize-on-input (cheap quick win)
3. **Root D** — save-path integrity (dedup + concurrency)
4. **Root B (vehicle picker)** — canonical make/model picker
5. **Root C** — pgvector semantic retrieval
6. **Root E** — `last_verified_at` field + nudges
7. **Root F** — RLS audit + e2e tests (mostly verification — policies exist)
8. **Root G** — storage orphan GC
9. **Root H** — tool-call retry-then-fallback

---

## Root A — AI must show its work

**Failure modes solved:** #1 (hallucinated fields), #2 (silent truncation), #3 (sparse paste → invented content).

**Current state:**
- `FieldGroup` (`components/knowledge/form-helpers.tsx:12-38`) supports `source` prop and renders "AI · from your paste: [quote]" with `<mark>` highlight.
- `review-form.tsx` (lines 148–272) passes `source={sources.X}` for every AI-attributable field.
- Source-span DATA exists — but no server-side verification that the AI's claimed spans are actually substrings of the paste.
- Fields populated *without* a source (e.g., AI hallucinated a value) render with NO AI badge, but the field still has data — easy to miss in review.
- No minimum-paste-length guard. Tech can paste 5 words and AI confidently invents content.

**Files to add/modify:**
- `lib/knowledge/verify-source-spans.ts` (new) — pure function `verifySourceSpans(paste: string, draft: ProposalDraft, spans: Record<string, string>) → { ok: true, warnings: [...] } | { ok: false, violations: [...] }`. Each non-empty draft field is checked: span must exist AND be a substring of paste (case-insensitive trim). Warnings flag draft fields with no span at all.
- `app/api/knowledge/paste/route.ts` — after `classifyPaste()`, run `verifySourceSpans` on the result. Strip fields whose spans are violations (replace with empty). Add `warnings` to the response so the review form can show them.
- `components/knowledge/form-helpers.tsx` — add a third visual state to FieldGroup: `unverified` (field has data, no source span). Render a `⚠ VERIFY` badge instead of `AI`. Different color, so curator's eye lands on it.
- `lib/knowledge/classify-paste.ts` — minimum paste length guard (e.g., 30 chars + at least 6 words). Below that, return `status: 'failed'` with a clear error message ("paste too short to extract — fill the form manually").
- `tests/unit/verify-source-spans.test.ts` (new) — pure-function tests: exact match, case-insensitive match, substring rejection, empty span rejection.
- `tests/unit/knowledge-paste-route.test.ts` (modified) — assert that violations are stripped before persisting to sessionStorage.

**LOC estimate:** ~80 LOC.

**Validation Brandon needs to run:**
- Paste a valid OEM block → review form shows AI badge + verbatim quote next to each populated field.
- Paste with a known hallucination trigger (very sparse text) → review form shows `⚠ VERIFY` badges on invented fields, OR returns "paste too short" if below threshold.
- Edit a field manually → its AI badge disappears (already works today).

**Dependencies:** None. Can ship now.

**Paste prompt for fresh session:**

> Continue work on the Vyntechs knowledge platform. Implement Root A from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`.

---

## Root B (DTC subset) — DTC normalize-on-input

**Failure modes solved:** #5 (DTC format drift).

**Current state:**
- `classify-paste` prompts AI to return DTCs in "bare form, uppercase" — works at parse time.
- Manual form entry (TagInput at `components/knowledge/form-helpers.tsx`) has no normalization. User can type `p0263-00`, `P 0263`, `P-0263`, all different strings in DB.

**Files to add/modify:**
- `lib/knowledge/normalize-dtc.ts` (new) — pure function `normalizeDtc(input: string): string | null`. Strips whitespace/hyphens beyond the leading letter, uppercases, validates against OBD-II shape regex (`^[PBCU][0-3][0-9A-F]{3}$`), returns null on invalid.
- `components/knowledge/form-helpers.tsx` — TagInput accepts an optional `normalize` prop. When set, the value is normalized on blur and rejected if normalization returns null.
- Apply `normalize={normalizeDtc}` to every DTC TagInput callsite (cause_fix form, review form, theory form, etc.).
- `tests/unit/normalize-dtc.test.ts` (new) — `P0263` → `P0263`, `P-0263` → `P0263`, `p0263-00` → `P0263`, `P 0263` → `P0263`, `XYZ` → null, `P9999` → null (invalid OBD-II second-char), etc.

**LOC estimate:** ~50 LOC.

**Validation Brandon needs to run:**
- In any form with a DTC input, type `p-0263-00` and blur → field shows `P0263`.
- Type garbage → field rejects (shows error).
- Existing items with non-canonical DTCs are NOT auto-migrated (would need a separate one-shot migration if Brandon wants that — out of scope here).

**Dependencies:** None.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root B (DTC subset) from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`.

---

## Root D — Save-path integrity (dedup + optimistic concurrency)

**Failure modes solved:** #7 (duplicates), #9 (concurrent edits).

**Current state:**
- No content hash on `knowledge_items`. Same paste saved twice = 2 rows.
- No `updated_at` check on PATCH at `/api/knowledge/[id]`. Two owners can clobber each other.

**Files to add/modify:**
- `drizzle/migrations/00XX_knowledge_dedup_concurrency.sql` (new) — adds `content_hash TEXT` column (nullable, indexed) to `knowledge_items`. No data backfill required; new saves populate it.
- `lib/knowledge/content-hash.ts` (new) — pure `hashKnowledgeContent(payload: KnowledgeSaveInput): string` using `crypto.createHash('sha256')` on a canonicalized JSON of `{type, title, body, structuredData, dtcList, systemCodes, symptoms}`. Vehicle scopes are NOT part of the hash (a shop might add the same item for different vehicle scopes intentionally).
- `lib/knowledge/save.ts` — before insert, look up by hash within shop. If found, return existing item + warning `"duplicate_detected"`. Save endpoint returns 200 with the existing id instead of creating a new row.
- `lib/knowledge/update-item.ts` — accept optional `expectedUpdatedAt: string` from caller. SQL: `UPDATE ... WHERE id = $1 AND shop_id = $2 AND updated_at = $3`. If 0 rows affected → return 409 conflict so caller can refetch + retry.
- `app/api/knowledge/[id]/route.ts` (PATCH) — accept `expectedUpdatedAt` from body, pass through, surface 409 status to client.
- `components/knowledge/drawer.tsx` + form components — pass `expectedUpdatedAt = item.updatedAt` on PATCH. On 409, refetch and surface "this item changed since you opened it — review and retry" inline.
- `tests/unit/content-hash.test.ts` (new) — hash stability (same input → same hash), field-order independence, scope independence.
- `tests/unit/knowledge-save-dedup.test.ts` (new) — second save of identical content returns existing id with warning.
- `tests/unit/knowledge-item-route.test.ts` (modified) — 409 on stale `expectedUpdatedAt`.

**LOC estimate:** ~120 LOC + 1 migration.

**Migration application:**
- Apply to local rehearsal DB (`vyntechs_rehearsal`) first to verify.
- Apply to live Supabase via MCP `apply_migration` BEFORE merging the PR (per Brandon's "Apply migrations to live DB" rule).
- Verify the column appears on the live `knowledge_items` table.

**Validation Brandon needs to run:**
- Add a knowledge item via paste flow → save. Note title.
- Re-paste the exact same content → expect to land on the SAME existing item, not a duplicate. UI shows a "you've already added this" notice (subtle, not blocking).
- Open the same item in two browser tabs. Edit + save in tab A. Then edit + save in tab B → tab B shows "this item changed, refresh to retry."

**Dependencies:** None.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root D from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`. Apply the new migration to live Supabase before merging.

---

## Root B (vehicle picker) — Canonical make/model

**Failure modes solved:** #4 (vehicle scope canonicalization).

**Current state:**
- `ScopeEditor` (form-helpers) is a free-text editor for `{year, make, model, engine, trim, drivetrain}`. Nothing prevents `F250` vs `F-250` vs `F 250`.

**Files to add/modify:**
- `lib/vehicle-canonical/nhtsa-makes-models.json` (new, static data) — bundled list of canonical makes + models from NHTSA's `vPICList_lite` SQL dump. ~30k models across all US-market makes 1981–current. JSON-compressed: ~500KB raw, ~80KB gzipped. Bundle directly into the app — no runtime fetch.
- `lib/vehicle-canonical/lookup.ts` (new) — `searchMakes(q: string): Make[]`, `searchModels(makeId, q): Model[]`, `canonicalize(make, model): { make, model } | null`. Levenshtein-tolerant search for fuzzy match.
- `components/knowledge/scope-editor.tsx` (modified) — replace free-text make/model inputs with autocomplete pickers. Engine and trim stay free-text (too much variation, OEM-specific).
- `tests/unit/vehicle-canonical.test.ts` (new) — `F250 → F-250`, `F-150 → F-150`, `Mustang → Mustang`, fuzzy matches.

**LOC estimate:** ~250 LOC + ~80KB bundled data.

**Validation Brandon needs to run:**
- Try every variation of "F-250" → all resolve to canonical "F-250" via the picker.
- Add knowledge with canonical scope → retrieve a session for "2018 F-250" → it matches.

**Dependencies:** None for the picker itself. **Note:** existing rows with non-canonical scopes won't auto-migrate. A separate one-shot script can canonicalize them after this lands — out of scope here.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root B (vehicle picker) from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`.

---

## Root C — pgvector semantic retrieval

**Failure modes solved:** #6 (synonym gap in retrieval).

**Current state:**
- `lookupKnowledgeTool` (PR 4) does keyword/structured matching on vehicle + DTC + system codes + symptoms. Misses semantically-similar items with different keywords.
- Postgres `pgvector` extension is available on Supabase but not enabled.
- No embedding generation on save.

**Files to add/modify:**
- `drizzle/migrations/00XX_knowledge_embeddings.sql` (new) — `CREATE EXTENSION IF NOT EXISTS vector;` + `ALTER TABLE knowledge_items ADD COLUMN embedding vector(1536);` + `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops)` (1536-dim assumes OpenAI ada-002 or Voyage; if using Anthropic-native embeddings, adjust dim).
- `lib/knowledge/embed-item.ts` (new) — `embedItem(item): Promise<number[]>`. Concatenates title + body + first-section text + bulletin summary, calls an embedding model (Voyage AI's `voyage-2` is the canonical Anthropic-ecosystem pick; ~$0.0001 per item). Returns the vector.
- `lib/knowledge/save.ts` — after successful insert, kick off embedding generation as a fire-and-forget (or await — small latency). Persist via UPDATE on the item.
- `lib/knowledge/retrieval.ts` (modified) — `lookupKnowledgeItems()` runs two queries in parallel: existing structured match + NEW pgvector cosine-similarity match. Merge results, dedupe, return top N by combined score.
- `tests/unit/knowledge-retrieval-semantic.test.ts` (new) — seed items with similar meaning but different keywords; assert both surface.

**LOC estimate:** ~150 LOC + 1 migration + Voyage API key.

**Migration application:** local rehearsal → live Supabase via MCP `apply_migration`. Index rebuild on existing rows can be batched (cron at first deploy).

**External dependency:** Voyage AI API key (or use OpenAI / Anthropic native embeddings if/when those ship). New env var: `VOYAGE_API_KEY`.

**Validation Brandon needs to run:**
- Add a knowledge item: "Fuel injector seal leak — 6.7L." Don't add DTCs.
- In a session, describe symptom as "diesel smell when running" — no DTC, no system code.
- AI retrieval should surface the fuel-injector item via semantic match. Walk this on the F-250 EcoBoost (or whatever you have data for).

**Dependencies:** Best after Root B (vehicle picker) so canonical scopes don't pollute embeddings.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root C from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`. You'll need a VOYAGE_API_KEY env var added to Vercel.

---

## Root E — Last-verified date + review nudges

**Failure modes solved:** #8 (stale knowledge).

**Current state:**
- `updated_at` exists but doesn't distinguish "edited" from "verified."
- No UI nudge to re-review old items.

**Files to add/modify:**
- `drizzle/migrations/00XX_knowledge_last_verified.sql` (new) — `ALTER TABLE knowledge_items ADD COLUMN last_verified_at TIMESTAMP WITH TIME ZONE`. Defaults to `created_at` on existing rows. New saves populate to NOW.
- `components/knowledge/drawer.tsx` — show "Last verified: X months ago" in the footer. When >12 months, show a "Verify still accurate" button that updates `last_verified_at = now()`.
- `app/api/knowledge/[id]/verify/route.ts` (new) — POST that updates `last_verified_at`, curator-only.
- (Optional) `app/api/cron/knowledge-stale-reminder/route.ts` (new) — weekly cron that emails owners a digest of items not verified in 12+ months. Defer unless Brandon wants it.

**LOC estimate:** ~80 LOC + 1 migration.

**Validation Brandon needs to run:**
- Open the drawer for any item → footer shows "Last verified: X" date.
- Items older than 12 months show a "Verify" button. Click it → date updates to today.

**Dependencies:** None.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root E from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`. Apply the new migration to live Supabase before merging.

---

## Root F — RLS audit + e2e tests

**Failure modes solved:** #10 (cross-shop leak defense-in-depth).

**Current state:**
- `knowledge_items_shop_scoped` policy already exists at migration 0014, line 89.
- `knowledge_item_vehicles_via_item` policy already exists at line 97.
- No e2e test that exercises a tech in shop A trying to read shop B's items at the Postgres layer (vs. app layer).

**Files to add/modify:**
- `tests/integration/knowledge-rls.test.ts` (new) — directly query `knowledge_items` via a connection authenticated as user X, expect rows scoped to X's shop only, expect 0 rows from other shops even when querying by id.
- Possibly `drizzle/migrations/00XX_rls_audit.sql` — only if audit finds gaps. Likely none.

**LOC estimate:** ~50 LOC of tests. Maybe 0 LOC of policy.

**Validation Brandon needs to run:**
- Trust the test suite. Manual verification not necessary unless the test reveals a gap.

**Dependencies:** None. Mostly informational PR (proves defense-in-depth).

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root F from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`. This one is mostly tests since the RLS policies already exist.

---

## Root G — Storage orphan GC

**Failure modes solved:** #11 (image storage bloat).

**Current state:**
- Image uploads via `app/api/knowledge/upload-image/route.ts` write to Supabase Storage `artifacts/knowledge/<shopId>/<type>/<uuid>.<ext>`.
- If user uploads then abandons the form, the storage key is never referenced by any `knowledge_items.structuredData.image_ref`. No cleanup.

**Files to add/modify:**
- `app/api/cron/knowledge-storage-cleanup/route.ts` (new) — nightly job: list all storage keys under `knowledge/`, list all `image_ref`/`mating_end_image_ref` values from `knowledge_items.structuredData`, delete unreferenced keys older than 24h (24h grace for in-flight uploads).
- `vercel.json` — add cron schedule (daily at 4am UTC).
- `tests/integration/knowledge-storage-cleanup.test.ts` (new) — seed orphaned + referenced keys, run job, assert orphans are deleted and referenced are kept.

**LOC estimate:** ~80 LOC.

**Validation Brandon needs to run:**
- Wait until first cron fires. Check that no images break in the drawer.
- (Optional) Manually upload, abandon, check that file gets cleaned the next morning.

**Dependencies:** None.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root G from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`.

---

## Root H — Tool-call retry-then-fallback

**Failure modes solved:** #12 (tool-calling false-failed).

**Current state:**
- `classify-paste`, `parse-theory`, `parse-pinout` each call Anthropic once. If the model returns `status: 'failed'` or throws, the route returns 502 and the UI shows "classifier failed."
- Curator's paste text isn't preserved — they have to retype.

**Files to add/modify:**
- `lib/knowledge/parser-retry.ts` (new) — `withRetryThenFallback<T>(fn, opts): Promise<{ status: 'parsed'; data: T } | { status: 'failed'; reason: string; rawText: string }>`. Calls fn() once. If thrown OR `status === 'failed'`, calls fn() a second time with a "Try again, be more lenient" framing. If second call also fails, returns `failed` with the original raw text.
- `app/api/knowledge/paste/route.ts` — wrap `classifyPaste()` with this. On final failed, surface `rawText` in the response.
- Review form (`review-form.tsx`) — handle "AI assist unavailable" gracefully: show empty form pre-populated ONLY with the raw text in the body field, so curator can hand-fill the rest without retyping.

**LOC estimate:** ~80 LOC.

**Validation Brandon needs to run:**
- Paste deliberately garbage text → expect retry → expect final fallback to a review form with the garbage in the body and curator can type over it.

**Dependencies:** None.

**Paste prompt:**

> Continue work on the Vyntechs knowledge platform. Implement Root H from `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md`. Cut branch from `origin/staging`.

---

## Sequencing summary

| Order | Root | Why this order |
|---|---|---|
| 1 | A (sources verified) | Highest leverage — kills all 3 Tier-1 trust-breakers |
| 2 | B-DTC | Cheapest win, quick visible impact |
| 3 | D (dedup + concurrency) | Save-path integrity matters before data volume grows |
| 4 | B-vehicle | Bigger lift; pair with Root C since both improve retrieval |
| 5 | C (pgvector) | Semantic retrieval; uses canonicalized fields from B |
| 6 | E (last-verified) | Quality maintenance once corpus is real |
| 7 | F (RLS audit) | Defense-in-depth verification |
| 8 | G (storage GC) | Operational hygiene |
| 9 | H (retry/fallback) | Final polish |

Total: ~900 LOC across 9 PRs (one for each, plus B is split into two).
