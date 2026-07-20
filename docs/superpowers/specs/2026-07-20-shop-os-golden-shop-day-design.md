# ShopOS Golden Shop Day Design

**Status:** Approved by the active goal on 2026-07-20.

## Intent

- **Project:** ShopOS living repair order.
- **Plain-language outcome:** Prove that one ordinary repair order can move across owner, advisor, technician, and parts roles without disappearing, duplicating work, exposing the wrong action, or forcing a page-shaped workflow.
- **Why now:** The living repair order is live, but existing tests prove isolated capabilities. The browser suite has one curator identity and an owner flow that silently skips without external credentials; it cannot certify a real shop day.
- **Done when:** One deterministic synthetic repair order is created, found, assigned, quoted, approved, worked, handed to parts, completed, paid, and closed through the real domain seams; each role sees the right queue and next move; the mounted Today/repair-order surfaces retain the phone and desktop contracts; the journey is a repeatable release gate.
- **Hard no:** No new operational page, diagnostic/media path, real customer data, production mutation, authentication bypass, stored credential, provider call, schema change, or invented parallel workflow.

## Product vision

- **Why this exists:** A shop should feel one repair order moving through the building, not four people operating four disconnected applications.
- **Who it is for:** The first five-person repair shop: owner, advisor, tiered technician, and parts operator, including people who cover more than one function.
- **Primary promise:** The same repair order quietly presents the exact next authorized move and returns to updated truth after it is done.
- **Must never break:** Tenant isolation, current-role authority, assignment/approval/work/close ordering, retry safety, unsaved drafts, or record discoverability.
- **Embarrassing failure:** A person completes a legitimate action and the work vanishes, appears in the wrong queue, offers an impossible control, or requires Brandon to authenticate and manually prove it.

## Capability map

| Capability | Status | Evidence | This slice |
| --- | --- | --- | --- |
| Role capability contract | working | `lib/shop-os/capabilities.ts` and role tests | Reuse unchanged |
| Create and recover work | working but separately proved | Rows 51–52 | Join into one journey |
| Living repair-order actions | working but separately proved | Row 53 | Join into one journey |
| Cross-role continuity | partial | No single scenario crosses all four roles | Primary target |
| Synthetic QA identity | partial | Curator-only credential harness; owner test can skip | Replace for this gate with hermetic actors |
| Phone and desktop continuity | partial | Component/CSS contracts; no durable journey receipt | Bind to the journey gate |
| Production canary identities | blocked by separate live-data/credential authority | No approved persistent production QA tenant | Explicitly excluded |

## Approaches considered

### A. Hermetic Golden Shop Day harness — selected

Create a fresh PGlite shop with fixed fake UUIDs and `.invalid` identity strings. Drive the real domain functions under four actor contexts, read the real Today/ticket projections after every handoff, and render the existing living surfaces against the resulting projections. The run is deterministic, leaves no data behind, needs no secret, and can run on every release.

This gives the strongest repeatable proof available inside the current authority boundary. Existing auth-boundary tests stay part of the gate, so hermetic actors do not pretend to replace authentication testing.

### B. Persistent deployed QA tenant and four Supabase users — deferred

This would add exact hosted-cookie and deployed-browser evidence. It also creates live rows, credential lifecycle, cleanup, email ownership, and production-canary governance. It remains a later separately authorized canary, not a prerequisite for a trustworthy local release gate.

### C. Expand isolated unit matrices only — rejected

It is cheap but preserves the present blind spot: every unit can pass while the whole repair order still breaks at a role handoff.

## Architecture

### Synthetic shop fixture

Add one test-only fixture with:

- one shop;
- owner, advisor, technician, and parts profiles with explicit tiers/capabilities;
- one fake customer and vehicle using reserved non-real identifiers;
- helpers that expose only public actor inputs and returned projections;
- automatic disposal with the PGlite database.

The fixture never reads environment variables, creates auth users, connects to Supabase, or serializes secrets/PII.

### Golden journey

The acceptance test owns one repair-order narrative:

```text
ADVISOR creates ordinary work
  -> ADVISOR finds it in Today and assigns TECH
  -> TECH finds owned work and records manual findings; no premature work action appears
  -> ADVISOR or OWNER builds the quote
  -> ADVISOR records approval
  -> TECH starts the sessionless manual work and requests a text-only part
  -> PARTS finds and resolves the request without wrenching/close authority
  -> TECH records work and completes it
  -> OWNER sees terminal work, records payment if required, and closes
  -> every role sees terminal read-only truth
```

At every arrow the test re-reads persisted server truth. It does not carry an optimistic object forward as proof.

The journey starts from Counter intake with diagnostics unavailable. Current source inspection found a concrete continuity break: Counter intake still creates a sessionless `diagnostic` job, but the simple-work domain and both living surfaces categorically refuse diagnostic jobs. After manual findings and approval, the job therefore has no completion path and terminal closeout correctly refuses it forever. This slice must allow only an approved, assigned, sessionless diagnostic job from a diagnostics-unavailable shop to use the existing text-only simple-work seam. An entitled diagnostic or any diagnostic with a session remains excluded.

### Role and queue receipts

Each checkpoint records a compact receipt containing:

- role;
- expected Today lane (`my`, `open`, `team`, `created`, or absent);
- expected primary next move;
- explicitly forbidden commands;
- ticket/work/approval state.

Assertions fail on both missing intended access and accidental extra authority.

### Living-surface proof

Use the existing Today board and mounted repair-order components; do not create a test-only product screen. Render representative checkpoints for each role and assert:

- one visible primary move;
- no diagnostic/media entrance;
- long customer/work text remains bounded;
- 44px controls, safe-area/sticky-tool behavior, reduced motion, and the existing 375px/desktop layout contract remain present;
- no action requires a new operational route.

Real-browser layout evidence remains an additional proof when an authenticated non-production canary is later approved. The hermetic gate will not claim pixel geometry it cannot measure.

## Data flow and failure behavior

- Every mutation uses the current repository domain function and actor context.
- Every role transition reloads Today and ticket detail from the database.
- A stale assignment, stale quote decision, duplicate part request, stale work update, or premature close must fail without losing the repair order.
- The journey stops at the first contradictory receipt and names the exact role/checkpoint.
- The test database is process-local and discarded even on failure.

## Verification

1. Golden journey passes from a fresh database twice in the same process without shared-state leakage.
2. Cross-shop, unsupported-role, pending-member, stale-write, and premature-close negatives stay fail-closed.
3. Existing focused auth, Today, ticket, quote, parts, work, ring-out, and living-order tests pass.
4. TypeScript, serialized full suite, production build, and diff guards pass before publication.
5. Static, security, and runtime review confirm the harness exercises real seams and adds no production bypass or data path.

## Rollback and stop conditions

The slice is test/documentation-first and adds no stored production state. Reverting its commit removes the harness without changing runtime data. Stop and re-plan if honest completion requires a production identity, new page, schema change, auth bypass, diagnostic/media enablement, or broader response envelope.
