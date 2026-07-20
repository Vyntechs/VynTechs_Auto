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
