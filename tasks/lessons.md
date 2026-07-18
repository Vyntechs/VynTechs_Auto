### shell-quote-markdown
Trigger: Passing Markdown with backticks through a shell command.
Rule: Single-quote the complete argument and escape embedded apostrophes before invoking the shell.
Reason: Double-quoted backticks execute command substitution and silently corrupt external text.

### serialize-heavy-test-runs
Trigger: Parallel reviewers launched Vitest while the control lane ran the full suite, causing resource contention and a false timeout.
Rule: One lane owns heavy tests; reviewers perform static review or wait for shared verification evidence.
Reason: Concurrent suites distort timing, waste compute, and weaken verification signal.

### own-verification-identity
Trigger: Authenticated verification required Brandon to sign in manually from another device.
Rule: Maintain an isolated QA identity with secrets outside Git; agents own routine authenticated verification.
Reason: Verification infrastructure must not become recurring founder labor.

### absent-provenance-means-refusal
Trigger: Coverage logic treated complete but provenance-free scenarios and equivalence summaries as verified guidance.
Rule: Missing structured provenance or axis mappings fail closed; labels, slugs, completeness, and summary verdicts never substitute.
Reason: Diagnostic instructions must be independently revalidatable before reducing technician judgment.

### production-schema-before-deploy
Trigger: Production code queries columns from an unapplied source migration.
Rule: Block production promotion until required migrations are applied or backward-compatible code is proven.
Reason: Successful authentication can still fail immediately when middleware reads missing schema.

### avoid-self-referential-branch-heads
Trigger: A driver checkpoint named the branch head inside a commit that changed that head.
Rule: Record stable source commits or state descriptions, never the current branch-head hash in that branch.
Reason: Self-referential hashes become false immediately and create avoidable correction commits.

### revoke-complete-server-only-acl
Trigger: CRUD-only revokes left server-only tables exposed to TRUNCATE, REFERENCES, and TRIGGER privileges.
Rule: Revoke all client table privileges and verify direct, PUBLIC, inherited, and intended service access.
Reason: RLS does not protect every table privilege, and partial ACL checks can falsely certify isolation.

### verify-advisors-before-production-migration-closure
Trigger: Production verification found unindexed foreign keys after source had been called ready.
Rule: Prove exact FK index coverage before merge, then run security and performance advisors after apply.
Reason: Local schema correctness does not prove production advisor cleanliness.

### media-needs-explicit-economics
Trigger: Founder rejected photo-dependent ShopOS scope because hosted media creates unwanted ongoing cost.
Rule: Default new ShopOS wedges to structured text; add media only with explicit storage economics and approval.
Reason: Workflow value must not silently create infrastructure cost or adoption friction.

### creation-must-remain-discoverable
Trigger: A successful create flow redirects to a home queue that filters the creator's new record out.
Rule: Prove every created record remains discoverable from the creator's normal role-shaped home after navigation.
Reason: Successful persistence without a durable return path feels exactly like data loss.

### locked-scopes-own-nested-values
Trigger: Locked scope shallow copies retained mutable JSONB aliases.
Rule: Recursively clone and freeze every exposed database value, including Dates; reject unsupported or cyclic structures.
Reason: Read-only containers do not own nested database state.

### validate-locked-composite-references
Trigger: A locked job exposed an approval-event ID without locking and validating its exact event parent.
Rule: Validate every non-null child reference against locked IDs and composite parent bindings; missing membership is retryable drift.
Reason: Lock completeness requires validating outgoing references, not merely locked row membership.

### mutation-test-guard-specific-proof
Trigger: An overflow test passed through an earlier suffix rejection without exercising the overflow guard.
Rule: Temporarily disable the named guard and prove its test fails before claiming branch-specific coverage.
Reason: A green failure-path test can be tautological when an earlier validator dominates the intended branch.

### static-method-types-do-not-prove-receiver-provenance
Trigger: Drizzle transaction trust followed a static method symbol through mutable Proxy and override receivers.
Rule: Require exact callsite registration plus syntactic receiver immutability; prohibit first-class mutation-shaped method references independent of inferred receiver type.
Reason: Structural typing preserves trusted symbols across mutable aliases and wrappers that can change runtime behavior.

### fingerprint-finite-trusted-source-surfaces
Trigger: Receiver-mutation guards kept missing reflection, prototype, delete, loop, and nested-helper edits around five fixed transaction owners.
Rule: Pin normalized whole-function fingerprints for finite trusted owners; use syntax guards only as defense-in-depth.
Reason: Any unreviewed owner edit then fails closed without enumerating JavaScript mutation forms.

### consolidate-proof-matrix-before-review
Trigger: Successive reviews found test-only authorization combinations after production behavior was already conformant.
Rule: Table action, state, locked drift, disclosure, revisions, and rollback before coding; require one exhaustive findings pass.
Reason: One-gap-at-a-time reviews repeat broad verification without improving production behavior.

### terminate-review-at-timebox
Trigger: A redundant plan reviewer exceeded its fixed scope after three complete source inventories had already converged.
Rule: Terminate an overrun reviewer; use available evidence and reserve the next review for the named convergence gate.
Reason: Waiting longer adds latency and recreates the open-ended review loop the efficiency contract forbids.
