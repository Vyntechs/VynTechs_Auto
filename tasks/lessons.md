### shell-quote-markdown
Trigger: Passing Markdown with backticks through a shell command.
Rule: Single-quote the complete argument and escape embedded apostrophes before invoking the shell.
Reason: Double-quoted backticks execute command substitution and silently corrupt external text.

### serialize-heavy-test-runs
Trigger: Parallel reviewers launched Vitest while the control lane ran the full suite, causing resource contention and a false timeout.
Rule: One lane owns heavy tests; run database-heavy Vitest as eight sequential shards with two workers, while reviewers use shared evidence.
Reason: Bounded shards finish visibly; concurrent or monolithic runs distort timing, waste compute, and weaken verification signal.

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

### shard-vitest-with-observable-exit
Trigger: A monolithic sequential Vitest process lost its controller output and remained idle after its worker exited.
Rule: Use the documented sequential shards and record each shard exit; terminate idle runners before starting another verification command.
Reason: A hanging aggregate runner provides neither a trustworthy pass nor a usable failure report.

### durable-save-must-unblock-next-action
Trigger: A saved part request briefly left the mounted work surface's local-draft guard active.
Rule: When child work becomes durable, synchronously clear parent draft guards and prove the next action is enabled.
Reason: Effect-timing races turn a successful save into an unnecessary technician retry.

### command-must-reveal-workspace-at-tap
Trigger: A mobile quote/work command appeared inert because its editor mounted far from the tapped row.
Rule: Mount an in-place workspace directly after its command and keep it stable until the operator closes it.
Reason: Spatial continuity makes a successful action immediately legible without a page transition or hunt.

### command-state-must-follow-interruption
Trigger: An embedded work tool closed after a hold without updating Today to its blocked next action.
Rule: Project a completed in-place mutation into its parent command surface before closing the workspace.
Reason: Stale state feels like lost work and hides the operator's next action.

### reads-must-not-take-work-locks
Trigger: Quote viewers conflicted because display reads locked the repair order.
Rule: Use a consistent read-only snapshot for views; reserve NOWAIT locks for mutations.
Reason: Concurrent roles must see shared work without blocking one another.
