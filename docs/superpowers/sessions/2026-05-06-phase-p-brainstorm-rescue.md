# Phase P brainstorm — RESCUED 2026-05-06

Diagnostic session `b386921b-c8d9-4155-8acb-7ce96d2bf4fd` froze mid-brainstorm (CLI accepted input, stopped streaming responses). The full conversation was extracted from the local JSONL transcript by the parallel migration session. **Nothing was lost.** Use this doc to resume Phase P brainstorming in a fresh diagnostic session without losing context.

## How to resume

1. **Try `claude --resume` first.** Pick session `b386921b-c8d9-4155-8acb-7ce96d2bf4fd`. The transcript file is intact even though the live process froze — restart usually re-reads it cleanly.
2. **If resume doesn't work**, start fresh: `/clear`, then point the new session at this doc plus the original handoff (`docs/superpowers/sessions/2026-05-06-handoff-phase-p-ready.md`). It can pick up from "Last open question" below.

## Baseline state (verified at brainstorm start, 10:20 PT)

- On `main`, branch off for the new feature: `feature/phase-p-curator`.
- 398/398 tests, TypeScript clean, build clean.
- Phase Q is shipped (PR #1 merged, commit `77a1506`).
- Migration filenames: Phase P **owns `0011_drift_alerts_lifecycle.sql` next**. The parallel migration session has been told to take `0012_*` for Stage 3.

## Scope locked

**Full Phase P — all 7 tasks** (Brandon picked this at the start):
- P1 — curator console layout + role-gate
- P2 — deferred sessions queue
- P3 — drift queue (the active recommendations to-do list)
- P4 — novel-pattern queue
- P5 — case detail view
- P6 — corpus authoring form
- P7 — calibration thresholds dashboard

## Open design questions — STATUS

**Q1 — Drift alert lifecycle.** ✅ ANSWERED: **B = apply + dismiss with audit trail.**

Each drift alert row gains four fields:
1. **Decision** — empty by default, stamped `applied` or `dismissed` on the click.
2. **Decided when** — timestamp.
3. **Decided by** — which curator made the call (cheap future-proofing for a second curator).
4. **Dismiss note** — optional free-text, only used when explanation matters.

Plus a partial index over pending-only rows so the queue stays fast forever.

**Q2 — Where does the Apply button live?** ✅ ANSWERED: **C = two pages plus per-cell history.**

- **Drift queue page** (`/curator/drift`) — only pending alerts. The to-do list. Empty queue = done for the day.
- **Calibration dashboard** (`/curator/calibration`) — read-only view of every threshold across all cells. Each row links to a small per-cell history view that shows the past 3 alerts + decisions for that slice.
- A "🔔 N pending" link in the calibration dashboard corner jumps to the drift queue when there's pending work.

**Q3 — Curator-authored corpus entries.** ✅ COLLAPSED.

Schema check showed `source_shop_id`, `source_session_id`, and `curated_by_user_id` are **already nullable** with FKs, and `is_curator_entry` already exists. Curator entries just pass `NULL` for the source fields and `TRUE` for the flag. **No migration needed for this.** The plan's old "synthetic UUID" hack was unnecessary.

## Where the conversation stopped — Section 1 (schema), with one micro-decision pending

The schema design was being walked through in plain English. Four fields above (decision / decided when / decided by / dismiss note) plus the performance index. **Section was almost approved.**

The conversation hung on **one small UX choice about the dismiss note field**:

The original framing offered two options:
- **Optional** — note field always there, blank allowed
- **Required** — note field always there, can't submit without text

Brandon's answer (typed 4 times because the CLI was hanging):

> "what about a happy medium between the two? Like, optional but also we don't, we can still capture the context as needed if we want to."

This is ambiguous between two interpretations:

- **(a)** Optional dismiss-only note — appears only when you click Dismiss, blank allowed. (Same as the original "optional" — basically what Brandon meant if he was reframing the existing option in his own words.)
- **(b)** Optional **decision** note on **both sides** — note field appears on Apply AND Dismiss, blank allowed for either. Lets you capture context when applying too ("strong sample size, low risk") if it's useful. Costs nothing extra to build.

The frozen assistant message asked "Which did you mean — (a) or (b)?" Brandon never got to answer.

**On resume: confirm (a) vs (b), then move on.** My read: (b) costs almost nothing and is consistent with the audit-trail intent of Q1=B. Worth offering it as a low-friction nice-to-have.

## Remaining brainstorm sections (not yet started)

After Section 1 wraps:
- **Section 2** — Drift queue page UX (P3): column ordering, filters, default sort
- **Section 3** — Per-cell history view (Q2=C addition): expandable row vs modal vs sub-route?
- **Section 4** — Novel-pattern queue (P4)
- **Section 5** — Case detail view (P5)
- **Section 6** — Corpus authoring form (P6)
- **Section 7** — Calibration thresholds dashboard (P7)
- **Section 8** — P1 curator-console layout + role-gate

Then: write the spec to `docs/superpowers/specs/2026-05-06-phase-p-curator-design.md`, self-review, Brandon review, then `superpowers:writing-plans`.

## Plain-English-only rule (saved permanently)

Mid-brainstorm, Brandon (correctly) flagged that Section 1 was full of SQL and Drizzle code that meant nothing to him. The rule was saved to shared memory at turn 26: **never present design sections in SQL/Drizzle/jargon. Reserve code for the spec doc artifact.** That memory survived the freeze and any new session will inherit it automatically.

## Files of record

- **Original transcript:** `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/b386921b-c8d9-4155-8acb-7ce96d2bf4fd.jsonl` (217 lines, 33 substantive turns)
- **Phase P handoff (already on origin):** `docs/superpowers/sessions/2026-05-06-handoff-phase-p-ready.md`
- **This rescue doc:** `docs/superpowers/sessions/2026-05-06-phase-p-brainstorm-rescue.md`
