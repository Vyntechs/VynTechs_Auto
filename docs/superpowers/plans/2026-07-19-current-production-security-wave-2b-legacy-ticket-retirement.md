# Current-Production Security Wave 2B: Legacy Ticket Retirement

**Goal:** Close `CAND-S015-001` and `CAND-S015-002` by removing the unused generic ticket-creation entrance while preserving every active ticket workflow.

**Why this is smallest:** Repository-wide client search finds creation only through `/api/tickets/counter` and `/api/tickets/quick`. Adding idempotency fields, quotas, and privileged-operation channels to an unconsumed endpoint would create needless product and schema complexity.

## Constraints

- Keep `GET /api/tickets/[id]`, `POST /api/tickets/[id]/jobs`, Quick Ticket, and Counter Intake unchanged.
- Return the existing opaque `{ error: 'not_found' }` shape with `404` from `POST /api/tickets`.
- Perform no authentication, paywall, JSON parsing, database, or ticket-domain work on the retired path.
- Add no page, prompt, field, or mobile/desktop interaction.
- Do not deploy, mutate production, or enable diagnostics.

## Test-first execution

- [ ] Change the route contract test to require unconditional opaque retirement before request parsing or downstream work; run it and record the pre-fix failure.
- [ ] Replace the generic handler with the minimal `404` response and delete its dead dependencies.
- [ ] Prove active Quick Ticket, Counter Intake, ticket detail, and add-job route contracts remain green.
- [ ] Re-run TypeScript, production build, diff check, and a repository search proving no product client calls the retired path.
- [ ] Record the two-finding closure in the current security receipt and keep Row 50 `in_progress`.

## Stop conditions

- Stop and re-plan if any non-test product client calls exact `POST /api/tickets`.
- Stop if retirement changes a current user flow or requires data/schema mutation.
