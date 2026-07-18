# Written-design review — ShopOS Continuity Proof Boundary (Packet A / Row 50)

**Date:** 2026-07-18
**Reviews:** `docs/superpowers/specs/2026-07-17-shop-os-continuity-proof-boundary-design.md`
as it exists on branch `feat/shop-os-continuity-foundation` @ commit
`a8f6095213e63dbc5e2d15883f72b3ef55cbe11d` (the spec is not on `main`).
**Type:** Written-design review of the proof-*boundary decision*. This is not the
later three-PASS code review; it judges whether the boundary is sound enough to
approve and turn into an implementation plan.

## Verdict: Approve the direction

The core decision — prove the **exact reviewed source at an immutable commit**, and
stop trying to prove that no hostile checked-in JavaScript could bypass the
continuity guarantees — is correct, and for a principled reason rather than
fatigue:

> Semantic security properties of arbitrary adversarial code cannot be soundly
> proven by enumerating source patterns in a reflective, dynamically-typed
> language. Reflection / `any` / proxies / monkey-patching / dependency
> replacement make any syntactic allowlist bypassable.

Prior sessions hit exactly this wall (see `tasks/lessons.md`:
*static-method-types-do-not-prove-receiver-provenance*,
*fingerprint-finite-trusted-source-surfaces*). Drawing the boundary at "the
reviewed artifact + supply-chain controls" is standard practice, and the spec
reasons it cleanly while preserving every production gate.

## Five conditions to fold into the implementation plan

These refine the design; none blocks approving the direction.

1. **Give the out-of-scope risks a named home.** Moving "malicious committer +
   altered registry", "compromised deps/CI", and "post-build monkey-patching"
   out of Packet A is correct, but they don't disappear. Record them as an
   explicit **accepted residual risk ("revisit at scale")**, and adopt the one
   cheap compensating control that covers the malicious-committer case:
   **branch protection + required review on the writer-registry and
   transaction-owner files.** Confirm whether that protection exists today.

2. **Guard failure ergonomics.** §1 correctly frames the compiler guard as a
   *regression tripwire*, not a security proof. A conservative guard will
   false-positive on legitimate future refactors, and the next developer will
   weaken or disable it. The guard's failure message must point at the
   fingerprint/registry **update path** so a legitimate change has a cheap,
   obvious way forward.

3. **Normalization is trust-sensitive.** §2 fingerprints "normalized function
   text." The normalization rules decide what counts as a change — too
   aggressive and a meaningful edit (e.g., a swapped lock order) slips through;
   too weak and formatting churn breaks fingerprints constantly. The plan should
   **specify the normalization rules and add a negative test proving a
   semantically-meaningful edit changes the fingerprint** (per the
   *mutation-test-guard-specific-proof* lesson).

4. **Bind the three PASS reviews to the efficiency-contract timebox.** The design
   requires three independent PASS verdicts; the driver-state efficiency contract
   requires one fixed-scope pass + one remediation + one re-review, then replan.
   State that the three reviews run *under* that timebox, so the requirement
   cannot quietly reopen the open-ended loop this pause exists to end.

5. **Shared definition of "ordinary future edit" vs "hostile edit."** The
   convergence rule ("synthetic examples count only if current source uses that
   shape, or an ordinary edit could hit it") is the linchpin that makes reviews
   terminate. Reviewers need one shared definition or they will relitigate it;
   make it explicit in the review brief.

## One strategic question for the founder (not a design flaw)

This is a large proof apparatus — writer inventory, fingerprinted transaction
owners, cross-writer matrix, disposable-Postgres race matrix — for what is, at
product level, "make one repair order the default per vehicle visit." The design
is sound **if** this rigor is a deliberate choice. Given the product's moat is
trust / don't-lie (customer-interaction doctrine), the rigor may be justified.
The honest Rule-2 question, asked once: **is Packet A's own proof depth
proportionate, or would a simpler continuity implementation with ordinary tests
deliver the same product value for a fraction of the sessions?** Founder's call.

## What this review affirms

- The boundary is honest and matches industry practice.
- Gates are strongly preserved: Acceptance Criteria keep production DDL, backfill,
  merge, deploy, enablement, and cleanup out; Row 50 stays `owner_gate`, not
  `complete`; a draft PR must be marked **DO NOT MERGE — production DDL gate**.
- The design changes the proof *claim*, not production behavior — low risk.
- Rejected alternatives (sealed runtime executor, whole-program fingerprint) are
  correctly reasoned; the sealed executor is the right long-term answer only if a
  supply-chain threat model later requires it.

## Status

Written-design review **complete**: PASS on the direction, with the five
conditions above to be incorporated when the implementation plan is written, and
the proportionality question left for the founder. No production DDL, backfill,
constraint validation, merge, deployment, continuity enablement, cleanup, or
production smoke mutation is authorized by this review. Row 50 remains an owner
gate.
