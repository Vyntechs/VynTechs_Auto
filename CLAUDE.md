# CLAUDE.md

These rules are mirrored from `AGENTS.md` → Working rules. If they ever diverge, `AGENTS.md` is canonical.

## Working rules

Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

### Rule 1 — Think before coding
- State assumptions explicitly. If uncertain, ask rather than guess.
- Present multiple interpretations when ambiguity exists.
- Push back when a simpler approach exists.
- Stop when confused. Name what's unclear.

### Rule 2 — Simplicity first
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked. No abstractions for single-use code.
- Test: would a senior engineer say this is overcomplicated? If yes, simplify.

### Rule 3 — Surgical changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor what isn't broken. Match existing style.

### Rule 4 — Goal-driven execution
- Define success criteria. Loop until verified.
- Don't follow steps. Define success and iterate.
- Strong success criteria let you loop independently.

### Rule 5 — Do not let the model perform non-linguistic tasks

Claude can be used for: classification, drafting, summarization, and extracting information from unstructured text. Do not use Claude for: routing, retries, status code handling, deterministic transformations. If a status code has already answered the question, let regular code handle it.

**Why this rule exists.** Karpathy's rules don't cover this, so the model began deciding issues that should be handled by deterministic code: whether to retry an API call, how to route a message, when to escalate processing. The result? Weekly judgments vary. You end up with an unstable if-else system billed at $0.003 per token.

**Real moment.** A piece of code was calling Claude to "determine whether to retry upon encountering a 503." It worked well at first, running steadily for two weeks, until it suddenly became unstable because the model began treating the request body as part of the context for judgment. The retry strategy became erratic, as the prompt itself had become random.

### Rule 7 — Expose conflicts, don't compromise or average out

If two existing patterns in the codebase contradict each other, do not mix them together. Choose one pattern — prefer the newer or more thoroughly tested one — and explain your reasoning, while marking the other pattern for cleanup later. The "average code" that tries to satisfy both sets of rules is the worst kind of code.

**Why this rule exists.** When two parts of the codebase contradict each other, Claude tries to please both sides, resulting in incoherent code.

**Real moment.** There were two error-handling patterns in the codebase: one using async/await with explicit try/catch, and another using a global error boundary. Claude's new code used both. As a result, error handling was performed twice. It took me 30 minutes to figure out why the errors were being swallowed twice.

### Rule 8 — Read first, then write

Before adding code to a file, first review its exported content, direct callers, and any clearly related shared utility functions. If you don't understand why the existing code is organized this way, ask questions first — don't just add things. "This doesn't seem relevant to me" is the most dangerous phrase in this codebase.

**Why this rule exists.** Karpathy's "surgical modification" told Claude not to alter adjacent code, but it didn't tell Claude: first understand the adjacent code. Without this, Claude will write new code that conflicts with existing code 30 lines away.

**Real moment.** Claude added a new function with identical functionality next to an existing one, because it did not first read the original function. Both functions performed the same task. However, due to the import order, the new function overwrote the old one, even though the old function had been the de facto standard for six months.

### Rule 9 — Testing is not optional, but testing itself is not the goal

Every test must encode "why this behavior matters," not just "what it does." A test like `expect(getUserName()).toBe('John')` is worthless if the function merely receives a hardcoded ID. If you can't write a test that fails when the business logic changes, then the function itself is wrong.

**Why this rule exists.** Karpathy's "goal-driven execution" suggests that tests can serve as a measure of success. But in practice, Claude treats "passing tests" as the sole objective, resulting in code that passes superficial tests while breaking other functionality.

**Real moment.** Claude wrote 12 tests for an authentication function, and all passed. But the authentication logic in production was broken. Those tests only verified that the function returned something, not that it returned the right thing. The function passed the tests because it returned a constant.

### Rule 10 — Long-running operations require checkpoints

In a multi-step task, after completing each step, summarize what has been done, what has been verified, and what remains. Do not proceed from a state you cannot clearly recount to me. If you find yourself losing track, stop and restate the current status.

**Why this rule exists.** Karpathy's template assumes one-time interactions. But real Claude Code workflows are often multi-step: refactoring across 20 files, building features within a single session, or debugging across multiple commits. Without checkpoints, one misstep can lose all prior progress.

**Real moment.** A 6-step reconstruction task failed at step 4. By the time I noticed, Claude had already proceeded to complete steps 5 and 6 on top of the error. Fixing it by breaking it down took longer than redoing the entire task. If there had been checkpoints, the issue could have been caught at step 4.

### Rule 11 — Convention takes precedence over novelty

If the codebase uses snake_case but you prefer camelCase: use snake_case. If the codebase uses class-based components but you prefer hooks: use class-based components. Disagreements are a separate discussion. Within the codebase, consistency takes precedence over personal preference. If you truly believe a convention is harmful, raise it explicitly — do not quietly create a fork.

**Why this rule exists.** In a codebase with an established pattern, Claude likes to introduce its own style. Even if its style is "better," introducing a second pattern is worse than any single pattern.

**Real moment.** Claude introduced hooks into a React codebase based on class components. It did work — but it broke the existing testing patterns in the codebase, since those tests relied on `componentDidMount`. It ultimately took half a day to remove and rewrite it.

### Rule 12 — Fail explicitly, don't fail silently

If you cannot be certain that something has succeeded, say so clearly. If 30 records were silently skipped, do not say "migration completed." If you skipped any tests, do not say "tests passed." If you did not verify the boundary cases I requested, do not say "feature is functional." Default to exposing uncertainty rather than concealing it.

**Why this rule exists.** Claude's most expensive failures are often those that look like successes. A function "runs" but returns incorrect data; a migration "completes" but skips 30 records; a test "passes" only because the assertion itself is wrong.

**Real moment.** Claude declared the database migration "completed successfully." In reality, it silently skipped 14% of records that triggered constraint violations. The skipping behavior was logged but not explicitly surfaced. It wasn't until 11 days later, when report data began showing anomalies, that we discovered the issue.
