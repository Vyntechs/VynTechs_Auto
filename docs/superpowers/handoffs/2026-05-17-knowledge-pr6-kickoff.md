# PR 6 kickoff — Cited-source mini-cards on the diagnose-phase Active Step card

**Sequence:** PR **6** of the vehicle knowledge platform · PR 1 schema → PR 2 paste APIs → PR 3 rich forms → PR 4 retrieval+tools → PR 5 Knowledge UI (owner-side) → **PR 6 diagnose-phase citations** → PR 7 repair-phase chat citations
**Previous:** PR 5b at `docs/superpowers/handoffs/2026-05-16-knowledge-pr5-kickoff.md` (write-side picker + 5 forms + retire/restore — must be merged to `main` first).
**Next:** PR 7 = repair-phase chat-bubble citations + the "AI consulted N items" trace if needed (kickoff TBD after PR 6 lands).
**Supersedes:** `docs/superpowers/handoffs/2026-05-16-knowledge-pr6-kickoff.md` — original plan scoped inline `[ref:...]` tokens + audit-trail surface; new scope is tighter and Claude-Design-led. See "Why this scope, not the original" in the spec.

**Paste this to start the session:**

> Continue PR 6 of the vehicle knowledge platform. Read `docs/superpowers/handoffs/2026-05-17-knowledge-pr6-kickoff.md` and execute it.

---

## Read first

**Spec:** `docs/superpowers/specs/2026-05-17-knowledge-pr6-design.md` — the load-bearing doc for this PR. Read end-to-end before any implementation.

**Master spec context:** `docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md` (lives on `feat/vehicle-knowledge-platform-spec` branch).

**Claude Design package:** `designs/design_handoff_knowledge_pr6/` — must exist before implementation starts. If the directory is empty or missing, STOP and ask Brandon — the design handoff to a fresh Claude Design session hasn't returned yet.

**Prerequisites:**
- PR 5b is merged to `main`.
- Claude Design has returned the package at `designs/design_handoff_knowledge_pr6/`.

## Methodology

Standard 4-phase superpowers flow:
1. **Phase 1 (design)** — already done (see spec).
2. **Phase 2 (setup)** — branch + skeleton + read the Claude Design package.
3. **Phase 3 (build)** — TDD-driven, per the implementation plan (which you produce in this session via `superpowers:writing-plans` after reading the design package).
4. **Phase 4 (verify)** — acceptance gates from the spec.

Plain rule: **the implementation plan can't be drafted until the design package is on disk and reviewed.** The plan needs concrete UI-component paths and styling decisions that Claude Design owns.

## Applicable skills

- `superpowers:using-superpowers` (entry)
- Codebase exploration (the spec's "Files to add / modify" lists everything to read)
- `superpowers:writing-plans` (after Claude Design package is reviewed)
- `superpowers:test-driven-development`
- `superpowers:executing-plans` or `superpowers:subagent-driven-development`
- `superpowers:systematic-debugging`
- `superpowers:verification-before-completion`
- `vercel:verification` — for the manual acceptance gates from the spec.
- `superpowers:finishing-a-development-branch`

## Branching

Cut a new branch `feat/knowledge-session-citations` off `origin/main`:

```
git fetch origin
git checkout -b feat/knowledge-session-citations origin/main
```

Per the project convention: every new feature branches from current `origin/main` so the Vercel preview URL is a real production clone.

## Definition of done

- All tests passing (unit, integration, e2e).
- TypeScript + build clean.
- Mobile validated (375–414px) — see spec "Acceptance gates".
- All manual acceptance gates in the spec pass on the Vercel preview URL.
- Branch pushed; Brandon opens PR via GitHub UI and merges into `main` per the staging → main rotation.
