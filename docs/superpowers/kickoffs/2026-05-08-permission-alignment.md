# Kickoff — Shop Permission Model: Align List ↔ Detail Access

**For:** A future Claude Code session that picks up the shop-management follow-up work after PR 1 ships.
**From:** The 2026-05-08 session validating PR 1 (counter intake persistence). Brandon found this while clicking through his My Jobs list and hitting a 404 on a session that the list itself surfaced.
**Status:** Deferred from PR 1. Awaits Brandon's explicit pointer.

---

## What's broken (the symptom)

On the Work Orders / My Jobs list, Brandon (an **owner**) sees sessions that belong to **techs in his shop** (e.g. Angel Morales' 2000 Dodge Ram). When he clicks one of those cards, the session detail page returns **404 — not found**. Same for any other-tech session he can see in the list.

Brandon's reaction: *"these two cases right here when I click on the 2000 Dodge I get an error 404. I know this was from another user."*

The list says "this exists, click here." The detail page says "no it doesn't, you can't see it." That's a permission contract violation — bad UX and confusing.

## Root cause

Two queries with two different scoping rules:

- **List query** (the My Jobs / Work Orders page) is **shop-scoped** — it returns every session for `shop_id = your_shop_id`, regardless of which tech owns it.
- **Detail query** (`getSessionForUser` in `lib/sessions.ts:68`) is **tech-scoped** — it explicitly checks `session.techId !== profile.id` and returns 404 otherwise.

Same applies to the action endpoints (advance, capture, close, abandon, decline-or-defer, lock-diagnosis, repair-observation) — they all go through the same tech-equals check.

The two queries were almost certainly written by two different PRs, and the implicit contract drifted.

## Why this matters for real shops

Real auto shops have **owners + service advisors + techs** — and the owner usually needs to see the whole board (every tech's sessions, every job in flight) to manage the shop. A tech doesn't need to see other techs' jobs but the owner absolutely does. The current "tech_id must equal profile.id" rule punishes the owner for being the owner.

## Decisions Brandon needs to make BEFORE coding

These shape the implementation. Don't skip the brainstorm.

1. **Permission model direction.** Two clean options:
   - **Option A (recommended):** Shop-scope reads, role-gate writes. Anyone in the shop can VIEW any session in the shop. Only the assigned tech (or the owner) can MUTATE (advance, abandon, close, etc.). Matches how shops actually work.
   - **Option B:** Tech-scope everything. Each user only sees their own sessions in both list and detail. Simpler permission model but loses the owner-overview that's the whole point of the My Jobs board for an owner.
   - **Hybrid:** Shop-scope for owners, tech-scope for techs. More code, more complexity, but matches reality more precisely.

2. **What does an owner viewing another tech's session look like?** Read-only banner ("You're viewing Angel's session — read-only")? Same UI but with mutate buttons disabled? Or full edit access (owner can do anything)?

3. **Does the abandon endpoint also need to honor the new model?** If owner can close another tech's session, that's a real workflow (tech left for the day, owner cleans up). Probably yes.

4. **Are there RLS policies in Supabase that need to align too?** Don't assume the application-layer check is the only gate.

## Files to touch (incomplete — discover the rest during implementation)

- `lib/sessions.ts:68` — `getSessionForUser` is the gatekeeper for almost every session-detail action
- All `app/api/sessions/[id]/*/route.ts` files that call `getSessionForUser`-equivalent helpers
- Whatever the Work Orders / My Jobs list query is (likely in `lib/db/queries.ts` or a list-specific helper — find it via `grep -r "shopId.*sessions" lib/`)
- `lib/db/queries.ts` for any other shop-scoped vs tech-scoped helpers
- Likely Supabase RLS policies (depending on the answer to question 4 above)

## Tests to add / update

- Owner can view another tech's session in the same shop (currently 404s — should pass)
- Tech cannot view another tech's session in the same shop (should still 404)
- Tech cannot view a session in a different shop (should still 404)
- Owner can abandon another tech's session (if option A or hybrid wins)
- The route tests for advance/capture/close/abandon/etc need a "non-owner non-assignee in same shop" case

## NOT in scope

- Shop owner ↔ shop owner across different shops (assume each shop has one owner)
- Multi-shop owners (assume each user belongs to one shop)
- Customer-facing portal (this is internal-tech only for now)
- Audit logging of who-touched-what (separate concern, separate PR if needed)

## Suggested first session actions

1. Read this doc fully
2. Read `lib/sessions.ts:68` and find every caller via `grep -r "getSessionForUser"`
3. Find the My Jobs / Work Orders list query (likely in `lib/db/queries.ts`)
4. **Brainstorm with Brandon** — present option A vs B vs hybrid with the trade-offs above. Get his decision.
5. Write a spec doc at `docs/superpowers/specs/2026-05-XX-shop-permission-model.md`
6. Plan, then implement. Aim for a small focused PR.

## Quick context links

- The 2026-05-08 PR 1 handoff at `docs/superpowers/sessions/2026-05-08-handoff-pr1-validation-pending.md` (this is part of the "deferred follow-ups" section)
- Brandon's auto-memory at `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/` (read MEMORY.md first)
- The two evidence rows: F150 stuck (id `d429e8ce-06ef-4eb0-9d35-8327b6dad11a`) and Angel's Dodge (id `f513d7d2-733b-49a1-b81a-245a74592d67`) — both now `status='deferred'` after manual cleanup, but the underlying permission bug is unchanged
