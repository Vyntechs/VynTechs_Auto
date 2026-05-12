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

### Rule 5 — Check time and context before each reply
- Check the current date and what's going on before replying.
- If it changes what you'd say or do, adjust.
- If not, stay quiet.
