# Shop OS Phase-2 Diagnostic Bootstrap Design

**Status:** Approved as row 15 of the Shop OS phased plan.

## Outcome

An eligible assigned technician starts a ticket-backed diagnostic from Today and reaches the existing diagnostic session. Repeated or concurrent starts create one session and invoke the paid initialization pipeline at most once while a lease is live. An uncertain expired attempt never regenerates automatically.

## Chosen approach

Use a dedicated job-start route backed by a two-transaction domain state machine:

1. An acquire transaction validates the authenticated active Shop-role technician, same-shop open ticket, diagnostic job, ownership, tier, and job status. It returns an existing linked session, reports a live lease, converts an expired lease to `ambiguous`, or atomically wins a new bounded lease with a client UUID attempt key.
2. Only the lease winner runs the existing full initial-tree pipeline outside the transaction. The generator, retrieval adapters, prompt, tree shape, and diagnostic session UI remain unchanged.
3. A finalize transaction rechecks lease ownership, creates the session with the persisted ticket vehicle/intake snapshot, links it uniquely to the job, marks bootstrap `ready`, and advances work to `in_progress` atomically. A losing finalize re-reads and returns the existing linked session.
4. A known pre-provider failure may become `failed`. A provider or persistence outcome that cannot prove no paid response occurred becomes `ambiguous`. Ambiguous state exposes an explicit possible-duplicate-cost confirmation; it never auto-retries.

This approach uses the schema already shipped in row 8. It avoids a migration, does not pretend the external provider supports idempotency, and keeps paid work outside database transactions.

## Alternatives rejected

- **Generate first, then insert:** simplest code, but concurrent taps can pay twice and create competing sessions.
- **Hold one database transaction across provider generation:** serializes starts, but holds locks across a slow external call and still cannot settle a post-provider connection loss safely.
- **Background queue now:** durable, but adds infrastructure and operational scope not required for this source-only phase.

## Boundaries

- Route: `POST /api/tickets/[id]/jobs/[jobId]/diagnostic/start`.
- Domain owns state transitions and returns narrow envelopes: `ready`, `initializing`, `ambiguous`, or a safe error.
- A reusable initialization factory supplies the exact pipeline already used by `/api/sessions`; no provider behavior is forked.
- Today shows `Start diagnosis` only for the current technician's unlinked diagnostic job. Linked jobs keep `Open diagnosis`. Repair and maintenance remain disabled with `Quote and approval required`.
- Start attempts are rate-limited and never log raw intake, provider output, secrets, or customer data.

## State model

```text
idle/failed --lease winner--> initializing --finalize--> ready + linked session
                                  |
                                  +--certain no-provider failure--> failed
                                  +--uncertain result or expiry----> ambiguous

ready -----------------------------------------------> return existing session
live initializing -----------------------------------> wait; never call provider
ambiguous --explicit duplicate-cost confirmation----> new leased attempt
```

The attempt key is unique per shop and stays attached through a live attempt. Lease expiry is evaluated against database time. A confirmed ambiguous retry uses a fresh key.

## Error and authorization contract

- Cross-shop, missing, and unauthorized resources return a uniform not-found envelope.
- Unassigned, other-technician, below-tier, inactive, non-diagnostic, terminal-ticket, and non-startable jobs cannot invoke the provider.
- Simple work has no start path in either UI or API.
- The route redirects only to a session owned by the authenticated technician; finalize assigns the new session to that same profile.
- A live lease returns conflict/retry guidance without disclosing another attempt key or internal provider detail.
- Ambiguous retry text explicitly warns that the previous provider call may have incurred cost or produced a duplicate result.

## Verification

- Domain tests cover retry reuse, concurrent lease winner/loser, unique link, lease expiry to ambiguity, explicit ambiguous retry, role/shop/tier/assignment/status gates, known and uncertain failures, and finalize races.
- Route tests cover auth, validation, rate limiting, response envelopes, dependency wiring, and no provider call for every rejected/waiting state.
- Today tests cover third-tap start, pending/ready/ambiguous/error feedback, safe navigation, disabled simple work, focus, 44px controls, reduced motion, and 375px composition.
- Focused tests, full suite, TypeScript, production build, diff check, task reviews, and whole-branch review must pass before merge.

## Scope exclusions

No schema or production database changes, quote/approval work, repair mutation, provider/account configuration, diagnostic engine redesign, background queue, or deployment is part of row 15.
