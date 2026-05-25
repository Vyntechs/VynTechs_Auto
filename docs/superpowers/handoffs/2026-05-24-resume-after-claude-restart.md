# Topology Canvas Redesign — Resume After Claude Code Restart

**Date:** 2026-05-24
**Status:** In-flight — Brandon is in a Claude Design session (browser-based, claude.ai) producing mockups. This Opus engineering session is paused because Claude Code is being restarted to clear errors. Pick up from here when the new session starts.

**Brandon's one-line paste to resume:**

```
Read docs/superpowers/handoffs/2026-05-24-resume-after-claude-restart.md and pick up where the prior Opus session left off. You should be on branch feat/topology-interactive-ui; if not, git fetch && git switch feat/topology-interactive-ui.
```

---

## Where things stand

### PR #91 — canvas baseline (separate from the redesign)
- Branch: `feat/topology-interactive-ui`, base: `staging-interactive-diagnostics`
- Open, awaiting Brandon's visual sign-off on the Vercel preview deploy
- HEAD at commit `5d97af2` after today's doc commits (was at `eb66631` before)
- This PR ships the layout that's about to be replaced by the redesign — but it's the baseline that ships first

### Claude Design session — in flight (Brandon-side)
- Brandon is using browser-based Claude Design ("Clyde") at claude.ai (no filesystem access to this repo)
- He pasted the handoff doc content directly into a fresh Claude Design chat
- Claude Design is producing mockups for 3 direction options × 5 form factors per the brief
- Brandon said he's "almost done"
- He may also paste his 2026-05-24 12:49 PM screenshot of the broken layout for visual evidence

### Today's Opus work — already committed
Commit `5d97af2` on `feat/topology-interactive-ui`:
- `docs/superpowers/research/2026-05-24-canvas-screen-real-estate-research.md` — 4-subagent research synthesis (premium diag tools / canvas-CAD / maps-AR / adaptive + unorthodox)
- `docs/superpowers/handoffs/2026-05-24-claude-design-topology-screen-real-estate.md` — the Claude Design brief

Memory added today (in `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/`):
- `feedback_no_design_proposals.md` — when Brandon raises a UX concern mid-conversation, surface it as a problem statement in the Claude Design handoff; do NOT propose copy / layout / affordance fixes from the engineering lane, even concrete research-grounded ones. He corrected this directly: *"You're an engineer, not the fucking designer. You keep intervening."*

---

## What to do when Brandon returns

### If Claude Design returned with mockups
1. Brandon will tell you the chosen direction (Option 1 "Maps for wiring" / Option 2 "Split-on-tap" / Option 3 "Spatial callouts" / a 4th Claude Design proposed) and either share the mockup paths / Figma file / screenshots.
2. Open the existing spec at `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`. The sections that need revising:
   - §4.1 (desktop layout) — was the chrome-heavy grid; needs the new canvas-dominant layout
   - §6 (mobile adaptation) — was inline-panel baseline; needs the chosen direction's mobile treatment
   - §4.6 (panel content) — content stays, location moves per the chosen direction
   - §4.7 (footer) — content stays, location moves; backdrop-blur dies (NN/g glassmorphism critique)
   - §4.8 (scenario picker) — semantics stay, visual location moves
   - Possibly a new section on diagnostic-clarity framing per Claude Design's copy / hierarchy decisions
3. Decide: revise the existing spec in place, OR write a new spec doc that supersedes it. New spec is probably cleaner since the layout change is structural. If new: `docs/superpowers/specs/2026-05-24-topology-canvas-redesign-design.md`.
4. Self-review the spec (placeholder scan / internal consistency / scope check / ambiguity check — see `feedback_spec_self_review_rigor`).
5. Hand the spec to Brandon for review BEFORE invoking writing-plans. **Plain-English summary in chat, full spec in the doc** (per `feedback_inline_plain_english_for_approval`).

### If Claude Design isn't back yet
1. Wait. Don't proactively re-engage Claude Design — Brandon manages that side.
2. Don't propose alternative directions or design moves while waiting (`feedback_no_design_proposals`).

### If Brandon wants to scrap the redesign
1. Don't argue (`feedback_no_veto_on_product_calls`). Brandon owns the product call.
2. Mark the redesign as parked; PR #91 baseline ships as-is when he merges.

---

## What's NOT yet decided

- Which of the 3 layout directions wins — Brandon picks after Claude Design's mockups
- Whether any unorthodox candidates (live values on wires, status color on objects, foot pedal, voice, QuickMenu radial, HUD-at-cursor) make it into v1 — Claude Design's call to include or defer
- Whether the redesign branches fresh off main or stacks on `feat/topology-interactive-ui`
- Whether PR #91 merges first (baseline ships, then redesign supersedes) OR gets superseded directly (closed without merging if redesign lands faster)

---

## Files to read (in this order, after pasting the resume line)

1. **`docs/superpowers/handoffs/2026-05-24-claude-design-topology-screen-real-estate.md`** — the brief Claude Design is working from. Contains the 3 direction options, locked items, form factors, success tests, diagnostic-clarity problem statement.
2. **`docs/superpowers/research/2026-05-24-canvas-screen-real-estate-research.md`** — the 4-subagent research evidence base. Read if you need to defend a design constraint or push back on a Claude Design proposal.
3. **`docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`** — the existing spec that needs revising (or superseding) once Claude Design returns.
4. **`docs/superpowers/handoffs/2026-05-24-pr-c-b-resume-from-visual-validation.md`** — the PR #91 baseline handoff (predecessor to this redesign work).

---

## Outstanding tasks (from prior session, will not persist across restart)

- **Revise spec after Claude Design returns** — see "What to do when Brandon returns" above
- **Self-review + Brandon spec approval** — second step; uses `feedback_spec_self_review_rigor` rigor

---

## Standing rules — still apply

- **Never push to `main` or `staging-interactive-diagnostics`.** Brandon merges via GitHub UI ([[feedback_never_push_to_main]]).
- **No design proposals from this lane.** Surface UX concerns as problem statements in Claude Design handoffs only. NEVER propose copy / layout / affordance / visual treatment, even when research-grounded and concrete ([[feedback_no_design_proposals]] + [[feedback_claude_design_handoff]]).
- **Plain-English brevity** ([[feedback_plain_english_brevity]]). Brandon is a non-engineer founder ([[user_non_engineer]]); lead with plain English, term second ([[feedback_teach_in_plain_english]]).
- **Brandon validates last** on the preview URL ([[feedback_claude_validates_first]]).
- **Per-PR session pattern**: `/clear` between PRs; this handoff is the resume vehicle ([[project_per_pr_session_pattern]]).
- **PGlite cold-cache flake** on Vitest first run after a fresh shell — rerun once before treating as a regression ([[feedback_vitest_pglite_flake]]).
- **Brandon's design surface lane**: Claude Design ("Clyde"), browser-based, no filesystem access to this repo. To hand off, paste doc contents into the chat — do NOT reference file paths Claude Design can't read.

---

## Quick orientation for the new session

- Repo: `Vyntechs/VynTechs_Auto` (private GitHub)
- Working dir: `/Volumes/Creativity/dev/projects/vyntechs`
- Current branch: `feat/topology-interactive-ui` (will be after `git switch`)
- Live preview URL: `https://vyntechs-dev-git-feat-0e898f-brandon-nichols-projects-f7e6d2a9.vercel.app`
- Test session: 2017 F-350 / P0087, accessible from `/today`
- Sign-in for testing: `brandon@vyntechs.com` (Brandon's own account on the preview)
