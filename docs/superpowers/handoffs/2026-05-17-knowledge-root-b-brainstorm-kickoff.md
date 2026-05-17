# Root B (DTC) — fresh-session brainstorm + spec + plan kickoff

You're picking up the Vyntechs knowledge platform. Brandon just shipped **Root A** (source-verify paste assistant) as PR #74 and wants **Root B (DTC normalization)** next. Brandon `/clear`ed context to keep this session focused on the brainstorm + planning, not on residual Root A details.

---

## What's already done (don't redo)

- **Root A** shipped (PR #74, merged to `staging` at commit `b0406ff`).
- **Roadmap** documenting all 9 roots: `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md` — see **"Root B (DTC subset)"** section for the rough sketch.
- **Convention** for kickoff + spec + plan + build-kickoff shape: see the Root A artifacts (paths below).

## Your job this session

This is a **brainstorm + spec + plan** session. **No code execution.** The build runs in a separate fresh session that picks up from the build-kickoff you'll write at the end.

1. **(Recommended) Phase 0 — research spike.** Dispatch a Sonnet research subagent to spike real-shop DTC noise patterns: what variations do techs actually type into shop systems? (e.g. `P0263`, `P-0263`, `P 0263`, `p0263-00`, `B0263` vs `P0263`, hex chars valid in 4th position, etc.) Quick web research, not codebase analysis. Use findings to inform the brainstorm.

2. **Invoke `superpowers:brainstorming`** and walk Brandon through the locked-decision questions. Plain English only (Brandon is a non-engineer founder — automotive domain expert). Reserve code/jargon for the spec doc, not the chat.

   Sample decision areas to surface:
   - Which input shapes to accept and silently normalize (e.g. `p-0263-00` → `P0263`)?
   - What to do with garbage input — inline error reject, accept-and-warn, or silently drop?
   - Apply to the FILTER bar on `/knowledge` page too, not just the form input?
   - Existing non-canonical DTCs already saved — leave them, or one-shot migration?
   - Any shop-floor patterns you (Sonnet research) found that Brandon hasn't seen?

3. **Write spec doc** at `docs/superpowers/specs/2026-05-17-knowledge-root-b-dtc-design.md`. Use the Root A spec as the shape template.

4. **Write plan doc** at `docs/superpowers/plans/2026-05-17-knowledge-root-b-dtc.md`. TDD-shaped, one commit per task, following the Root A plan as the template.

5. **Cut branch** `feat/knowledge-root-b-dtc-normalize` from `origin/staging`. Commit the spec + plan + a build-session kickoff at `docs/superpowers/handoffs/2026-05-17-knowledge-root-b-dtc-kickoff.md` (mirror the Root A build-kickoff shape).

6. **Push the branch.**

7. **Tell Brandon** in one sentence that the branch is ready, and give him the one-line resume prompt to paste after he `/clear`s context for the build session.

## Constraints

- **Brandon is a non-engineer founder.** Plain-English check-ins at natural breakpoints. No SQL / TypeScript / regex jargon when talking to him in chat. The spec doc itself can be technical; the conversation can't.
- **No "AI" word in user-facing copy.** Carry forward from Root A.
- **No new dependencies** beyond what the spec calls for.
- **Branch base: `origin/staging`.** Build-session PR will target `staging`, not `main`. The knowledge platform sits on staging until the whole chain ships to main.
- **No prod ops, no migrations.** Root B is pure code per the roadmap — no schema change.
- **Brandon merges PRs himself** — the build session will not merge.

## Don't do

- Don't write any code this session. Spec + plan + build-kickoff only.
- Don't expand scope beyond what the roadmap's Root B (DTC subset) section calls out. Vehicle-picker normalization is **Root B (vehicle picker)** — a separate later root.
- Don't apply migrations (there are none).

## Reference

- **Roadmap:** `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md` (Root B section)
- **Root A spec (template):** `docs/superpowers/specs/2026-05-17-knowledge-root-a-source-verify-design.md`
- **Root A plan (template):** `docs/superpowers/plans/2026-05-17-knowledge-root-a-source-verify.md`
- **Root A build-kickoff (template):** `docs/superpowers/handoffs/2026-05-17-knowledge-root-a-kickoff.md`
