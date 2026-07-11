# Shop OS Phase-2 Diagnostic Bootstrap Design

**Status:** Approved as row 15 of the Shop OS phased plan.

## Outcome

An eligible assigned technician starts a ticket-backed diagnostic from Today and reaches the existing diagnostic session. Repeated or concurrent starts create one session and invoke the paid initialization pipeline at most once while a lease is live. An uncertain expired attempt never regenerates automatically.

## Chosen approach

Use a dedicated job-start route backed by a two-transaction domain state machine:

1. An acquire transaction validates the authenticated active Shop-role technician, same-shop open ticket, diagnostic job, ownership, tier, and job status. It returns an existing linked session, reports a live lease, converts an expired lease to `ambiguous`, or atomically wins a new two-minute lease with a client UUID attempt key. The two-minute database-time lease exceeds the route's 60-second execution envelope with safety margin.
2. Only the lease winner runs the existing full initial-tree pipeline outside the transaction. It preserves counter intake's topology preflight and populated sentinel; non-topology cases use the existing retrieval/tree generator. The resolvers, generator, retrieval adapters, prompt, tree shape, and diagnostic session UI remain unchanged.
3. A finalize transaction rechecks `job + initializing state + attempt key + live lease`, creates the session with the persisted ticket vehicle/intake snapshot, links it uniquely to the job, marks bootstrap `ready`, and advances work to `in_progress` atomically. A stale finalize rolls back its inserted session and may only re-read a canonical session; it never clobbers a newer attempt.
4. Only validation, paywall, rate-limit, or workload failures proven to occur before invoking the initializer may become `failed`. Once the initializer is invoked, every thrown, timeout, transport, or persistence outcome that cannot prove no paid response occurred becomes `ambiguous`. Every terminal write is conditional on the same attempt ownership predicates. Ambiguous state exposes an explicit possible-duplicate-cost confirmation; it never auto-retries.

This approach uses the schema already shipped in row 8. It avoids a migration, does not pretend the external provider supports idempotency, and keeps paid work outside database transactions.

## Alternatives rejected

- **Generate first, then insert:** simplest code, but concurrent taps can pay twice and create competing sessions.
- **Hold one database transaction across provider generation:** serializes starts, but holds locks across a slow external call and still cannot settle a post-provider connection loss safely.
- **Background queue now:** durable, but adds infrastructure and operational scope not required for this source-only phase.

## Boundaries

- Route: `POST /api/tickets/[id]/jobs/[jobId]/diagnostic/start`.
- Domain owns state transitions and returns narrow envelopes: `ready`, `initializing`, `ambiguous`, or a safe error.
- A reusable initialization seam shares counter intake's topology preflight/sentinel and the existing `/api/sessions` retrieval/tree assembly. Topology cases never call the provider; non-topology provider behavior is not forked.
- Existing-session reuse happens before quota or workload checks. A lease winner must pass the shared intake rate limit and current five-open-session cap before provider work; a rejection safely releases the lease as a certain failure.
- Authentication and paywall remain ahead of parsing/provider work. The shared quota stays `intake:${userId}` at ten requests per minute. The five-session cap remains the existing soft per-tech check; row 15 does not add cross-job profile serialization.
- Today shows `Start diagnosis` only for the current technician's unlinked diagnostic job. Linked jobs keep `Open diagnosis`. Repair and maintenance remain disabled with `Quote and approval required`.
- Start attempts are rate-limited and never log raw intake, provider output, secrets, or customer data.
- Cold-case draft synthesis remains outside row 15. It is an optional feature-gated intake side effect, not required to initialize or route the diagnostic session.

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

The attempt key is unique per shop and stays attached through a live attempt. Lease expiry is evaluated against database time. Finalize, fail, and ambiguity writes match the same attempt key and current lease/state. A late old worker cannot insert, link, fail, or overwrite a confirmed newer attempt. A confirmed ambiguous retry uses a fresh key.

## Error and authorization contract

- Cross-shop, missing, and unauthorized resources return a uniform not-found envelope.
- Unassigned, other-technician, below-tier, inactive, non-diagnostic, terminal-ticket, and non-startable jobs cannot invoke the provider.
- Simple work has no start path in either UI or API.
- The route redirects only to a session owned by the authenticated technician; finalize assigns the new session to that same profile.
- A live lease returns conflict/retry guidance without disclosing another attempt key or internal provider detail.
- Ambiguous retry text explicitly warns that the previous provider call may have incurred cost or produced a duplicate result.
- Today renders an explicit state matrix: `idle|failed` can start; live `initializing` is disabled and refreshes/waits; `ambiguous` requires warning plus fresh-key confirmation; `ready` opens only a safely owned linked session; inconsistent `ready` without one shows a safe refresh/error state.

## Verification

- Domain tests cover retry reuse, concurrent lease winner/loser, unique link, lease expiry to ambiguity, explicit ambiguous retry, role/shop/tier/assignment/status gates, known and uncertain failures, and finalize races.
- Domain tests cover stale finalize/fail after expiry and after a confirmed newer attempt; the old worker must create/link nothing and change no newer state.
- Route tests cover auth, paywall, strict validation, exact shared rate-limit key/budget, open-session cap, response envelopes, dependency wiring, ready-retry bypass of quota/cap, and no provider call for every rejected/waiting state. Any exception after initializer entry becomes ambiguous.
- Initialization tests prove a reachable topology returns the existing populated sentinel without AI, while tree/published-wizard cases keep the existing retrieval/tree inputs. Workload-cap tests prove no provider call when the current technician already has five open sessions.
- Today tests cover every server-state matrix row, third-tap start, pending/ready/ambiguous/error feedback, fresh-key confirmed retry, safe navigation, stale refresh, disabled simple work, focus, 44px controls, reduced motion, and 375px composition.
- Focused tests, full suite, TypeScript, production build, diff check, task reviews, and whole-branch review must pass before merge.

## Scope exclusions

No schema or production database changes, quote/approval work, repair mutation, provider/account configuration, diagnostic engine redesign, background queue, or deployment is part of row 15.
