# ShopOS Continuity Proof Boundary Design

**Date:** 2026-07-17  
**Status:** Founder-approved direction; written-design review pending  
**Applies to:** Packet A / Row 50 continuity foundation  
**Held branch:** `feat/shop-os-continuity-foundation`

## Decision

Packet A will prove the exact reviewed application source at an immutable release
commit. It will not claim that a TypeScript source test can soundly interpret or
prevent every program a hostile developer could construct with JavaScript
reflection, `any`, proxies, monkey-patching, or arbitrary dependency replacement.

The deployed application bundle, locked dependency graph, CI configuration, and
release commit are trusted release inputs. HTTP requests, authenticated actors,
tenant data, stored rows, environment values, and provider responses remain
untrusted inputs and retain their existing validation, authorization, privacy,
and transaction controls.

## Why This Boundary Is Correct

The continuity proof needs to answer whether the code Vyntechs is actually
shipping preserves writer ownership, lock order, tenant isolation, revisions,
idempotency, rollback, diagnostics-off, and no-media behavior. It does not need
to become a general JavaScript interpreter.

Repeated independent review demonstrated that syntax enumeration does not
converge: every added assignment, alias, or reflection check permits another
equivalent hostile source program. Treating arbitrary checked-in malicious code
as an input would require whole-runtime language semantics or a materially new
execution architecture. Neither is proportionate to Packet A, and neither
improves protection against normal product inputs.

The honest boundary is therefore the immutable reviewed source artifact. Any
future source change creates a new artifact and must pass the proof again.

## Proof Model

### 1. Exact current-source inventory

The compiler-backed inventory continues to verify the real application program:

- the complete registered continuity writer set;
- exact approved lexical callers for protected writers and private mutation
  capabilities;
- current tracked-table mutations and raw SQL classification;
- exact route refusal ordering for diagnostics-gated entrances;
- exact coordinator, lock, finalizer, receipt, and revision ownership;
- the complete cross-writer matrix and its documented owner counts.

The guard may conservatively reject straightforward first-class or computed
mutation capabilities. It is a regression tripwire for reviewed application
conventions, not a claim of sound arbitrary JavaScript data-flow analysis.

### 2. Frozen transaction-owner source

The five approved Drizzle transaction owners remain pinned by stable SHA-256
fingerprints of their complete normalized TypeScript function text. A textual
change to any owner revokes structural trust until its source, call graph, tests,
and new fingerprint are reviewed together.

Fingerprints contain no secret and do not substitute for runtime tests. They
bind the proof to the source that reviewers inspected.

### 3. Immutable release identity

The held gate packet binds all evidence to:

- the exact branch and full commit SHA;
- the exact `0037_shop_os_continuity_foundation.sql` SHA-256;
- the locked package/dependency files present at that commit;
- exact test, PostgreSQL, TypeScript, build, and independent-review receipts.

No source may be changed between final verification and the held gate without
invalidating the evidence and rerunning the affected ladder.

### 4. Runtime and database evidence

Source checks remain supporting evidence. Runtime confidence comes from the
existing isolated unit/integration suites, disposable PostgreSQL 17 race matrix,
rollback and collision cases, typecheck, and production build. Production DDL,
runtime merge/deploy, backfill, feature enablement, and live mutation remain
separate gates.

## Explicit Threat Boundary

### In scope

- malformed, stale, conflicting, cross-actor, and cross-tenant requests;
- concurrent legitimate writers and database races;
- idempotency collisions, rollback seams, unsafe revisions, and legacy rows;
- unauthorized roles, diagnostics-off entrances, and operational-media refusal;
- accidental ordinary source regressions detectable by the registered compiler
  guard, tests, fingerprints, diff review, and CI.

### Out of scope for Packet A

- a malicious committer deliberately adding reflective code and simultaneously
  altering the proof registry or tests;
- compromised dependencies, build tooling, CI runners, deployment credentials,
  or the Node.js runtime;
- arbitrary in-process monkey-patching or executable-code injection after the
  reviewed bundle is built;
- proving semantic properties for every valid TypeScript/JavaScript program.

Those are software-supply-chain and runtime-integrity concerns. They require a
separate threat model and controls such as protected reviews, dependency
attestation, signed builds, or a sealed runtime boundary; they are not hidden
inside Packet A's writer-inventory test.

## Review Contract

Final reviewers must judge the exact held commit against this boundary. They
should attempt to find defects in current production source, current call paths,
current tests, current migration behavior, and current release evidence.

Synthetic examples are actionable when the current source uses the same shape
or when ordinary future edits could bypass an explicit registered convention.
Examples that require first introducing hostile checked-in code, replacing a
trusted executor, or compromising an upstream runtime object are recorded as
out-of-scope threat-model ideas rather than Packet A release blockers.

Three independent PASS verdicts are still required:

1. schema, migration, tenant, RLS/ACL, privacy, and release-boundary review;
2. lock, revision, receipt, race, rollback, and current-source ownership review;
3. whole-branch scope, diagnostics-off/no-media preservation, documentation,
   and test-adequacy review.

## Acceptance Criteria

Packet A may advance to the held production-DDL decision only when:

1. the current-source writer inventory and all focused suites pass;
2. all five transaction-owner fingerprints match the reviewed source;
3. disposable PostgreSQL passes every required case with zero skips;
4. the complete ordinary suite, TypeScript, production build, and diff checks
   pass on the final source;
5. three independent reviews PASS under this explicit threat boundary;
6. Row 50 and `SHOP_OS_DRIVER_STATE.md` report exact counts and unresolved gates;
7. the branch is pushed and a draft PR is marked
   **DO NOT MERGE — production DDL gate**;
8. the gate packet binds the immutable commit and migration hashes.

Row 50 remains `owner_gate`, not `complete`, at that point. No approval of this
design authorizes production DDL, backfill, constraint validation, merge,
deployment, continuity enablement, cleanup, or a production smoke mutation.

## Rejected Alternatives

### Sealed runtime transaction executor

A module-owned, non-injectable transaction boundary could reduce the trusted
surface further, but it would materially refactor production writers and expand
Packet A risk. It should be considered only under a separate design if the
software-supply-chain threat model later requires it.

### Whole-program source fingerprint

Hashing all application source would bind every release but make unrelated
changes invalidate continuity tests. The immutable Git commit already provides
that artifact identity without embedding a brittle whole-repository checksum in
unit tests.

## Rollback and Stop Conditions

This design changes the proof claim, not production behavior. Its implementation
must not weaken request validation, authorization, transaction code, database
constraints, diagnostics refusal, or media refusal.

Stop and redesign if final review finds a defect in the current source or if
closing a current-source defect requires a material runtime architecture change.
Do not reopen unbounded reflection-syntax enumeration as a substitute.
