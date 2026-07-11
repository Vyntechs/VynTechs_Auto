# Shop OS Phase-3 Evidence-Bound Customer Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Every implementation task uses test-driven development and an independent task review.

**Goal:** Ship row 20's server-side evidence-bound story generator and persistence guards for ordinary locked tree diagnostic jobs, without UI, production DDL, quote sending, repair execution, or diagnostic-engine writes.

**Architecture:** One injected AI adapter receives only explicitly selected, server-loaded evidence and chooses a short ordered set of exact excerpts through strict structured output. The server—not the model—assembles the story: concern, locked root cause, locked action, neutral waiver copy, and the validated exact excerpts. One Shop OS domain validates tenant, actor, diagnostic path, lock state, evidence membership/timing, and retry identity; after provider work, it locks and reloads the entire mutable context, rejects drift, persists the mutable draft metadata, and invalidates any active quote version atomically. A tenant-safe GET plus one thin POST expose the saved draft and eligible evidence for row 21's review UI.

**Tech stack:** TypeScript, Zod, Anthropic forced-tool structured output, Drizzle/PostgreSQL, PGlite, Next.js App Router, Vitest.

## Global constraints

- Read only through the approved job→session seam. Do not change session prompts, lock handlers, wizard behavior, risk/gating, retrieval, topology, outcome, or diagnostic schema.
- Eligible jobs are same-shop diagnostic jobs linked to an open locked session with `phase === 'repairing'`, an ISO `diagnosisLockedAt` no more than five minutes after database `now()`, 1–5,000 UTF-8 byte concern/root/action fields, and finite `proposedAction.confidence` in `[0,1]`.
- Accept ordinary tree sessions only when `treeState.done === true` and no `wizard_lock_in` exists. Reject the `_topology` sentinel and every `wizard_lock_in` as `unsupported_path` before provider work; current client-supplied wizard lock provenance cannot satisfy the evidence contract without separate approved engine work.
- Accept at most 20 unique UUID event IDs and 20 unique UUID artifact IDs. Every selected row must belong to the linked session and predate or equal diagnosis lock.
- Events are limited to `eventType === 'observation'` with non-empty `observationText` of at most 2,000 UTF-8 bytes; never expose `aiResponse`, gate history, repair events, outcome data, unrestricted tree state, or post-lock rows.
- Artifacts must have `extractionStatus === 'done'`. Expose only extraction text/summary/structured JSON after enforcing: 10,000 UTF-8 bytes per text field, 20,000 serialized bytes per structured value, depth 8, 200 object keys, 200 array items, and 64,000 total provider-input bytes. Reject oversize/deep values; never truncate canonical data or expose storage keys/raw media URLs.
- The provider may select at most five exact excerpts. Each excerpt is 12–2,000 UTF-8 bytes with at least three non-whitespace words, bound to one selected event or artifact ID, and a byte-for-byte JavaScript substring of that exact server-loaded source. Persist that raw source slice; canonically equivalent Unicode that is not literally present rejects. Prompt instructions inside evidence are untrusted text.
- The server assembles `whatYouToldUs` as the exact concern, `whatWeFound` as the exact locked root cause, `whatWeRecommend` as the exact locked proposed action, and `whatItMeansIfWaived` as the neutral sentence `If you choose not to proceed, the diagnosed issue remains unresolved.` Each `howWeKnow.claim` is the exact validated source excerpt, never a model paraphrase.
- Empty selected evidence produces an empty `howWeKnow` array and a short story; it never produces padded proof.
- Only active same-shop tech, advisor, or owner profiles may generate a story. Parts-only, pending, deactivated, missing-shop, cross-shop, and unsupported actors fail closed.
- `POST` requires a UUID `clientKey` plus non-negative integer `expectedStoryRevision`. Persist actor-bound `generationClientKey`, `generationRequestFingerprint`, `generatedByProfileId`, and `storyRevision` in `storyMeta`. The request fingerprint covers actor, client key, selected IDs, and canonical lock/evidence inputs but excludes current story/meta. A same-key/same-actor/same-request committed retry returns current server truth before revision checking or provider work; changed same-key reuse conflicts. A different key is fresh and must match `expectedStoryRevision`.
- Separately compute an ephemeral CAS fingerprint over the complete mutable context, including current story/meta, actor authorization fields, ticket/jobs/versions, session, and selected evidence. Recheck it after provider work. Concurrent different keys cannot overwrite each other. If a fresh generation yields the identical public story, rotate the persisted retry identity without quote invalidation and keep the revision; if public story changes, increment revision exactly once. An older key with a stale expected revision conflicts before provider work unless it is the currently persisted exact-retry key.
- Provider work occurs outside database transactions with a 30-second timeout and `maxRetries: 0`. The final transaction locks `ticket → all ticket jobs ordered by ID → quote versions ordered by ID → linked session → selected events ordered by ID → selected artifacts ordered by ID → actor profile`, all `NOWAIT`, then reloads authorization, request fingerprint, and CAS fingerprint before persisting. New post-lock events cannot enter the selected-ID set.
- Successful persistence writes `source: 'ai'`, `sessionId`, `generatedAt`, `lastEditedByProfileId`, `lastEditedAt`, `generationClientKey`, `generationRequestFingerprint`, `generatedByProfileId`, `storyRevision`, and `reviewStatus: 'pending'`, then passes the complete locked job/version context to the existing active quote-version invalidator in the same transaction. Quote version creation rejects every non-null story without valid metadata and every AI story unless `reviewStatus === 'reviewed'`; row 21 owns the authenticated human review transition.
- `GET` evidence lists are independently cursor-paginated at 25 rows each, ordered by `(createdAt DESC, id DESC)`. Strict server-issued event/artifact cursors return the next older page plus independent `nextEventCursor`/`nextArtifactCursor`; invalid cursors are `422`. No request can materialize an unbounded evidence workspace.
- Do not add dependencies, migrations, environment variables, feature flags, UI, manual story editing, quote approval, send, vendor, attachment upload, repair mutation, or production access.

**Implementation correction — verified source head `240e719`.** Published-wizard generation is intentionally unsupported: current client-supplied lock provenance cannot meet the evidence contract without engine changes, so any `wizard_lock_in` fails before provider work. Ordinary locked tree generation, bounded evidence pagination, actor-bound retry/CAS persistence, active-version invalidation, and thin route mapping are complete. AI drafts remain mutable with `reviewStatus: pending`; quote creation fails closed for missing/invalid story metadata and unreviewed AI content. Row 21 owns the authenticated human edit/review transition. Five focused files/129 tests and the complete 227-file/2,251-test suite pass with TypeScript, production build, diff checks, approved task and whole-branch reviews, and a zero-finding final narrow review. PGlite does not prove true two-connection PostgreSQL timing. No migration/DDL, UI, production data, live provider, engine write, external access, or repair mutation occurred.

---

### Task 1: Strict structured story adapter

**Files:**
- Create: `lib/ai/customer-story.ts`
- Test: `tests/unit/customer-story-generator.test.ts`

**Interfaces:**
- Produce `CustomerStoryGenerationInput` containing only bounded server-labeled evidence records.
- Produce `GeneratedEvidenceSelection = { selections: Array<{ sourceKind: 'event' | 'artifact'; sourceId: string; excerpt: string }> }`.
- Produce `GenerateCustomerStoryFn = (input: CustomerStoryGenerationInput) => Promise<GeneratedEvidenceSelection>` and a typed provider error distinguishing timeout, invalid output, and generic failure.

- [x] Write failing tests proving the adapter sends only the declared evidence fields, treats evidence instructions as untrusted data, forces one structured tool, uses `timeout: 30_000` and `maxRetries: 0`, and rejects missing/multiple/wrong tool blocks, unknown keys, overlong excerpts, duplicate/unselected IDs, common-word anchors, non-verbatim excerpts, and selections when evidence is empty.
- [x] Write failing tests proving the adapter accepts the bounded evidence schema while canonical concern/root/action/waiver text never enters model-owned output.
- [x] Run `pnpm test tests/unit/customer-story-generator.test.ts` and confirm failures are caused by the missing adapter.
- [x] Implement strict Zod input/output schemas, the calm proof-selection prompt, forced-tool parsing, exact source-bound excerpt validation, typed provider errors, and injected client support. Use the repository `MODEL` without changing the shared client.
- [x] Re-run the focused file and commit only the adapter and tests.

### Task 2: Tenant-safe generation, revalidation, persistence, and quote invalidation

**Files:**
- Create: `lib/shop-os/customer-stories.ts`
- Modify: `lib/db/schema.ts`
- Test: `tests/unit/shop-os-customer-stories.test.ts`

**Interfaces:**
- Produce `getCustomerStoryWorkspace(db, input)` with actor, ticket ID, job ID, and optional independent event/artifact cursors; return current safe story/meta/revision plus one bounded page of eligible pre-lock event/artifact IDs, kinds, timestamps, labels, and next cursors.
- Produce `generateAndSaveCustomerStory(db, input, dependencies)` with actor, ticket ID, job ID, UUID client key, expected story revision, selected event IDs, selected artifact IDs, and injected `generateCustomerStory`.
- Return discriminated safe results. Stable mapping: malformed envelope/IDs/counts `invalid_input → 422`; missing/cross-shop parent, linked session, or selected evidence `not_found → 404`; unsupported same-shop role `forbidden → 403`; unlocked/unsupported path `state_conflict → 409`; same-session invalid type/time/extraction/bounds `invalid_evidence → 422`; lock/context/key/duplicate-active drift `conflict → 409` with `retryable`; provider timeout `provider_timeout → 504`; provider/unsupported output `provider_failed → 502`. Responses never echo evidence, provider exceptions, or tenant existence.

- [x] Write failing PGlite tests for supported ordinary tree generation, `treeState.done`, thin evidence, valid/non-future lock time, strict UUID/count/uniqueness, exact job→ticket→session→shop linkage, active role gates, root/action/concern/confidence bounds, unlocked/closed/simple/topology/wizard provenance rejection, cross-session/cross-shop/post-lock evidence privacy collapse, observation-only events, incomplete/oversize/deep extraction rejection, total payload cap, and omission of AI response/storage keys from provider input.
- [x] Write failing tests for deterministic canonical field assembly, exact kind+ID raw-excerpt validation, canonically equivalent but non-identical Unicode rejection, minimum excerpt substance, common-word anchors, contradiction/prompt-injection/waiver resistance, and typed provider failure.
- [x] Write failing retry tests for same-key exact return before provider/revision checks, same-key changed actor/payload conflict, fresh-key expected revision, separate request/CAS fingerprints, concurrent different-key compare-and-swap, stale older-key rejection, identical-story retry-identity rotation without invalidation, changed-story single revision increment, and current story/meta participation only in CAS.
- [x] Write failing transaction tests for ticket/all-jobs/versions-by-ID/session/events/artifacts/actor `NOWAIT` order, injected actor deactivation/role/shop drift, session close and selected evidence drift, new quote/version/approval during provider work, active-version invalidation across included/excluded jobs, duplicate-active anomaly rollback, persistence metadata, and no partial write on any failure.
- [x] Write GET-workspace tests for tech/advisor/owner access, parts denial, cross-shop privacy, safe current draft/revision, bounded independent event/artifact pagination with deterministic tie ordering and resumable cursors, invalid cursors, eligible evidence labels, and absence of AI response/storage keys/raw URLs/outcome/post-lock rows.
- [x] Run the focused file and confirm the expected missing-domain failures.
- [x] Implement bounded parsers/cursors, safe workspace/evidence projection, deterministic server assembly, separate request/CAS fingerprints, exact retry/revision behavior, the pinned `NOWAIT` lock order and reload, locked fresh actor authorization, typed persistence, mandatory human-review metadata, and existing quote invalidation reuse with the complete locked job/version rows. Extend `CustomerStoryMeta` with generation/revision/review fields; add focused `buildQuoteStoryMeta` and snapshot-identity regressions proving quote snapshots remain limited to source/session while volatile generation/edit/review metadata stays outside immutable content identity.
- [x] Re-run the focused file and commit only the domain/schema/tests.

**Concurrency proof boundary:** PGlite proves generated ticket-first `NOWAIT` SQL, deterministic injected drift, rollback, and conflict classification. True two-connection PostgreSQL timing remains deferred to integration proof.

### Task 3: Thin authenticated route and safe response mapping

**Files:**
- Create: `app/api/tickets/[id]/quote/jobs/[jobId]/story/route.ts`
- Test: `tests/unit/shop-os-customer-story-route.test.ts`

**Interfaces:**
- `GET` accepts optional strict `eventCursor` and `artifactCursor` query parameters and returns `{ story, storyMeta, storyRevision, evidence: { events, artifacts, nextEventCursor, nextArtifactCursor } }` using only the bounded safe workspace projection.
- `POST` accepts exactly `{ clientKey: string, expectedStoryRevision: number, sourceEventIds: string[], sourceArtifactIds: string[] }`.
- Success returns `{ changed, story, storyMeta, storyRevision }`; failures use the pinned domain status/body helpers.

- [x] Write failing GET/POST route tests for unauthenticated, paywalled, malformed JSON, unknown keys, invalid cursors/client key/revision/arrays, privacy-safe not-found, forbidden, state conflict, invalid evidence, retryable conflict, provider timeout/failure, exact retry, no provider invocation after every preflight rejection, bounded pagination, and success mappings.
- [x] Implement the thin route: require user/profile, run `paywallReject`, parse strict JSON, translate the current profile, call the workspace or generation domain with production `generateCustomerStory`, and map only the pinned safe result bodies.
- [x] Re-run route plus Task 1/2 focused tests and commit only the route/tests.

### Task 4: Plan reconciliation and shipping proof

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: this execution packet

- [x] Run all row-20 focused tests, then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check origin/main...HEAD`.
- [x] Run independent task reviews after each implementation commit and one whole-branch security/product/code review. Resolve every Critical or Important finding through focused tests and re-review.
- [x] Add the row-20 implementation correction, record source completion with proof, preserve production/external gates, and record row 21 as the next safe handoff.
- [x] Publish as PR #132, pass GitHub/Vercel/GitGuardian checks, squash-merge as `e9bc780`, verify tree-identical `main`, and observe the Ready production deployment; row 21 executes only under its own reviewed packet.

## Verification

```bash
pnpm test tests/unit/customer-story-generator.test.ts \
  tests/unit/shop-os-customer-stories.test.ts \
  tests/unit/shop-os-customer-story-route.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before production DDL/data, a new secret/environment variable, external account/credential/spend, send/vendor/order work, repair mutation, or deployment enablement.
- Stop if correct published-wizard support requires changing lock semantics or persisting wizard history; keep thin-evidence behavior rather than crossing the engine boundary.
- Stop if story persistence cannot invalidate the active quote version atomically with the existing ticket-first lock order.
