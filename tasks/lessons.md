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

### market-only-production-truth
Trigger: A marketing example reaches for unfinished or production-disabled Vyntechs functionality.
Rule: Exclude it entirely; demonstrate only shipped production truth or use an explicitly unrelated neutral product.
Reason: Hypothetical promotion can misstate availability and distort the exercise around unapproved scope.

### suite-noise-is-config-not-code
Trigger: Full-suite shards failed on macOS `._*` sidecar files and a 5s pglite timeout under load.
Rule: Prove a suite failure is real before blaming code; fix glob/timeout config so the gate reports truth.
Reason: This volume regenerates AppleDouble junk, and load-driven timeouts read as phantom regressions.

### verify-exit-code-not-pipeline
Trigger: A backgrounded `pnpm test:shards | tail` reported exit 0 while two shards had actually failed.
Rule: Never judge pass/fail from a piped command's status; read the real summary or capture to a file.
Reason: The pipeline returns the last command's code, silently converting a failed gate into a green one.

### widened-contract-needs-full-suite
Trigger: A required `clientKey` field broke two test files a delegated agent never found.
Rule: Widening a shared contract means grepping every call site, then running the whole suite CI runs.
Reason: A hand-picked subset passes while unrelated fixtures still build the old body shape.

### fail-soft-catch-hides-from-every-signal
Trigger: A swallowed storage throw disabled the unsaved-draft guard for three days with zero error signals.
Rule: When a catch degrades silently, only a browser walking the journey can catch it — keep that gate green.
Reason: No console error, no failed request, and no unit test sees a deliberate fail-soft path.

### version-8-uuids-are-real-here
Trigger: A `[1-5]` UUID regex rejected client-key-derived ids, which this codebase stamps as version 8.
Rule: Allow `[1-8]` in any UUID pattern; derived idempotency ids are as real as gen_random_uuid ones.
Reason: Five modules derive ids by hash, and every one of them sets the version nibble to 8.

### first-project-aborts-hide-the-second
Trigger: A red golden-phone run made golden-desktop look green; desktop was failing identically.
Rule: When one Playwright project fails, never infer the others pass — the run stops before they start.
Reason: The harness runs projects in sequence and exits on the first failure.

### resolve-the-deployed-commit-not-the-age
Trigger: `vercel ls` Age column made a fresh deploy look 43 minutes old; I nearly re-deployed.
Rule: Prove what production is serving via the GitHub deployments API, matching sha to environment_url.
Reason: The CLI's relative age is unreliable, and both a stale and a fresh alias read "Ready".

### section-label-collides-with-its-own-field
Trigger: `getByLabelText` matched both a section's aria-label and the input labelled the same.
Rule: Never give a landmark the same accessible name as a control it contains.
Reason: Screen readers and role queries both see two things named one thing.

### owner-questions-need-filtering
Trigger: I handed Brandon four audit questions; three were noise he was angry to be asked.
Rule: Filter every audit-generated question through what he cares about and what code can answer. Ask the one that changes the build.
Reason: An audit lists gaps generically; a technician-owner has already ruled most of them out.

### a-default-is-where-tax-bugs-live
Trigger: Tax math was correct and per-line, but every new labor line started taxable in Texas.
Rule: When a rule is per-line, audit the DEFAULT, not just the arithmetic. Trace every factory that mints one.
Reason: Correct math over a wrong default bills real money wrong, and a subtotal hides which line caused it.

### changing-a-default-moves-hosted-totals
Trigger: The labor-tax fix silently invalidated the dollar totals two production journeys assert.
Rule: After changing anything that touches money, grep the e2e specs for hard-coded totals before the gate runs.
Reason: CI does not run the hosted journeys, so the break surfaces later with no obvious cause.

### unsourced-numbers-become-facts
Trigger: A research doc states a specific count about Brandon's shop or business.
Rule: Attribute it or strike it. Never let an unsourced observation size work or justify strategy.
Reason: "67 open ROs" was repeated across three docs and sized a week; Brandon never said it.

### success-unmounts-its-own-confirmation
Trigger: Retiring a declined line worked, but its "Declined work retired." message never painted.
Rule: When success removes the command that offered a control, put the confirmation on the surviving row.
Reason: React batches parent and child updates, so the control unmounts in the same commit that set its notice.

### a-stopped-agents-handoff-is-a-lead
Trigger: A killed agent's PR handoff listed as unfinished a test already committed and passing.
Rule: Verify every handoff claim against the commit and a real run before scheduling work from it.
Reason: The handoff narrates intent at the moment of death, not what the branch actually contains.
