# Current-Production Security Wave 2F: Follow-up Resolution Integrity

**Goal:** Close `CAND-S022-008` so one surfaced follow-up can trigger at most one corpus-decay operation even when the assigned technician submits concurrent resolutions.

**Architecture:** Preserve the existing authorization and response semantics, but make the database update itself the single-winner claim. Only the request whose conditional `resolved_at IS NULL` update returns a row may continue to corpus decay; every stale or concurrent loser stops before the sink.

## Constraints

- Preserve the existing follow-up UI, request body, route shape, assigned-technician ownership, and non-fatal decay-failure behavior.
- Parse the body before attempting a state transition.
- Bind the claim to the follow-up ID, assigned technician, and unresolved state in one SQL update.
- Never add a global lock, user prompt, retry delay, schema migration, production write, or diagnostic enablement.

## Test-first execution

- [ ] Reproduce two simultaneous true resolutions of one surfaced follow-up and prove the current code invokes decay twice.
- [ ] Require exactly one successful state transition and exactly one decay invocation.
- [ ] Preserve true/false resolution, wrong-tech opacity, invalid-body rejection, already-resolved rejection, and non-fatal decay failure.
- [ ] Run focused and adjacent follow-up/corpus/route tests, typecheck, build, and diff gates.
- [ ] Record closure while keeping Row 50 `in_progress`.
