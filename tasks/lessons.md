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

### landing-scope-is-shop-os
Trigger: Marketing, positioning, or landing work anchored on the live page or the 2026-05 doctrine.
Rule: Position the product as the Shop OS (counter to closeout) with the honest diagnostic engine as its signature, never diagnostics alone.
Reason: Live page and doctrine predate Shop OS; Brandon corrected a diagnostics-only prototype mid-build 2026-07-11.
