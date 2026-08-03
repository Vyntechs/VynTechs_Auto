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

### no-authored-steps-the-engine-is-off
Trigger: Designing any Shop OS technician screen showing a next physical action.
Rule: Never draw software-issued procedure steps. A job has a description; the tech decides what to do.
Reason: Authored steps exist only in the disabled diagnostic engine, so the screen cannot be built.

### name-the-table-or-drop-the-number
Trigger: Putting any metric on a Shop OS design, especially in a headline position.
Rule: Name the table it reads from before drawing it. Verify in code, not from plausibility.
Reason: Comeback and first-call figures are session-keyed and never written in production; both were invented.

### the-tool-never-forecasts-completion
Trigger: Any surface tempted to show an ETA, a countdown, or "done within the hour".
Rule: Report state, never forecast. Blocked or not blocked. On this since 9:40.
Reason: The shop has no set start time and people leave mid-job; every forecast would be fabricated.

### screens-not-essays
Trigger: Brandon asks for design work in Figma so he can approve it before implementation.
Rule: One page of real screens at device sizes, numbered. Reasoning goes on pages prefixed "ref".
Reason: He approves what he can see; screens scattered through a design essay are unreviewable.

### the-ai-ick-checklist
Trigger: Building any screen mockup Brandon will look at.
Rule: No rule-between-every-section, no ALL-CAPS label above every block, no all-rectangles, no centered button text.
Reason: That stack reads as machine-made on sight and costs his trust in the whole design.

### carry-the-signature-into-the-product
Trigger: A design has a signature element specced beautifully on its own page.
Rule: Check it is actually visible and felt on every real screen before calling the set done.
Reason: The pulse shipped as 2px of near-black on black — the thesis was present decoratively, absent functionally.

### stop-inventing-his-shop
Trigger: Writing any concrete noun into a Shop OS screen — a place, a role, a process word.
Rule: If Brandon did not say it, do not write it. His own words are the only vocabulary source.
Reason: Invented specifics like "counter" and bay numbers are landmines he must decode, and each one breaks trust.

### a-word-that-must-be-taught-has-failed
Trigger: Writing any user-facing string in Shop OS.
Rule: The word must mean on screen what it means on a shop floor. Never repurpose a plain noun as a product term.
Reason: Readers are skilled non-college-educated professionals, not engineers; "Provisional ticket" and "Job ledger" cost them a decode.

### no-appointments-and-almost-no-waiters
Trigger: Designing any Shop OS queue, board, or intake surface.
Rule: No schedule, no appointment book, no promise time. Waiters are under 1% — handle, never feature.
Reason: The shop specializes in problem children other shops failed; nothing about its day is calendar-driven.

### go-look-before-you-theorize
Trigger: Brandon reports how something looks or feels.
Rule: Sign in and photograph the live product first. Report measured pixels, not what the source implies.
Reason: "Feels black" was the landing hero plus a three-surface authed page — the source alone would have sent the fix to the wrong screen.

### fix-the-bug-dont-route-it
Trigger: Noticing a defect while doing other work, in any lane.
Rule: Fix it, prove it, ship it. Never hand a bug back to Brandon as a captured item.
Reason: He said plainly "the bugs are your problem" — routing a defect to him is making him the queue.

### verify-before-you-call-it-a-bug
Trigger: About to report a visual defect seen in a full-page screenshot.
Rule: Re-check it in a real viewport with hit-testing. Fixed-position elements stitch into the middle of full-page shots.
Reason: I called the notice an overlap over the VIN field; the true fault was at the bottom, covering 99% of the submit button.
### form-kit-without-a-breakpoint-leaks
Trigger: v2.css's form kit had zero media queries; its fixed 200px label column overflowed every phone.
Rule: A shared kit must carry its own responsive rules. A local `:global` patch on one screen hides the bug on all the others.
Reason: The write-up patched it and looked fine; the quote a technician opens on a phone ran 434px wide in a 390px window.

### an-undefined-css-var-is-silent-until-it-is-not
Trigger: `--vt-fg-1` is referenced eighteen times and defined nowhere; on one button it was the background.
Rule: Grep every custom property for a matching definition. `color:` fails invisibly by inheriting; `background:` fails as invisible text.
Reason: The advisor's close-out button rendered bone-on-bone at 1.08:1 and nothing in the suite could see it.

### two-filled-buttons-rank-nothing
Trigger: Today showed "New work order" and "Quick ticket" as two identical solid slabs side by side.
Rule: One filled control per surface. Everything else is outlined, and the fill says which one the person wants.
Reason: Equal weight forces the operator to read both labels before deciding, on every visit.

### the-page-behind-must-recede
Trigger: Cards were painted DARKER than the page, so nothing read as raised and the product looked like one flat plane.
Rule: Give the canvas its own token, one step darker than the surface content sits on, and light the surface.
Reason: Figure/ground is the cheapest depth in a design system; inverted, no amount of shadow rescues it.

### hydration-gap-is-a-real-attack-window
Trigger: Any form carrying credentials or secrets in a client component.
Rule: Declare method="post" and disable submit until a mount effect runs. A form with no method GETs every named field into the URL.
Reason: /sign-in put a typed password in the address bar, history, and Referer whenever a press beat hydration.

### renames-must-be-proven-in-the-browser
Trigger: A pass that renames user-facing strings claims its specs were updated in lockstep.
Rule: Run the hosted journeys against the deploy before believing it. Unit tests pass on renamed strings; browsers do not.
Reason: Three specs still clicked "New work order" after the rename merged, and only a production run found it.

### never-grep-a-playwright-trace-with-credentials
Trigger: A browser sign-in trace needs diagnosis.
Rule: Use redacted harness receipts or the trace viewer; never print raw trace JSON because fill actions contain credentials.
Reason: Raw Playwright trace output exposed a fixed QA password and forced immediate rotation.

### simplicity-is-the-product-gate
Trigger: Founder questions multi-variable pass/fail for interaction quality.
Rule: One real role task decides release; keep only controls needed to finish, correct, or recover.
Reason: Independent metrics invite scope growth and painful friction instead of proving simple completion.
