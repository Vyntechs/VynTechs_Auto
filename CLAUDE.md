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

## Git context recovery

Conversation history is a convenience; committed Git state is authoritative.

- A project `SessionStart` hook injects fresh branch, divergence, working-tree,
  driver-state, coordination-Log, and open-PR context on startup, resume,
  `/clear`, and compaction. It fetches refs but never merges, rebases, pushes,
  migrates, or edits files.
- Before acting on Shop OS or AutoEYE work, reconcile the injected snapshot
  with `AGENTS.md`,
  `docs/operations/2026-07-14-autoeye-lane-coordination.md`,
  `docs/strategy/SHOP_OS_DRIVER_STATE.md`, the active plan's §11 status table,
  and current PR comments.
- Respect the ownership rules in the coordination protocol. Never modify,
  close, rebase, force-push, or merge another session's branch.
- Before ending a material lane, put its current slice, last proof, next safe
  move, and true gates in the lane-owned plan/driver state or PR. Do not use
  chat transcripts as the only handoff.

### Compact instructions

Preserve only the outcome, owned branch/paths, commits and PR, verified proof,
current blocker, next safe move, and protected gates. After compaction, treat
the refreshed Git context from the `SessionStart` hook as newer than the
conversation summary.
