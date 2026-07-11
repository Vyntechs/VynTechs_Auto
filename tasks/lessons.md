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

### production-schema-before-deploy
Trigger: Production code queries columns from an unapplied source migration.
Rule: Block production promotion until required migrations are applied or backward-compatible code is proven.
Reason: Successful authentication can still fail immediately when middleware reads missing schema.
