# Optional tech selector on `/intake` — design spec

**Status:** Ready for implementation review
**Branch:** new feature branch from `main` (per "new work branches from main" rule); preview surfaces via `staging` after PR opens
**Date:** 2026-05-12
**Design handoff:** `designs/design_handoff_tech_selector/` (gitignored) — `canvas.html` (26 mockups: Direction A and B × laptop/tablet/phone × all states), `SPEC.md` (token map + interaction spec + pushbacks), `TechSelectorStates.jsx` (one component per state), `tech-selector.css` (component styles).
**Predecessor:** `/intake` renders `components/screens/counter-intake.tsx`. Form POSTs to `/api/intake/submit` which calls `createSessionFromIntake({advisorProfileId, ...})` — that function currently hard-stamps `sessions.tech_id = advisorProfileId`. This spec inserts an optional override before the stamp.

---

## Goal

Add an optional "Assign tech" control to the `/intake` form so the writer can route a new work order to a specific tech (or any role) in their shop. Default UX state reads "Open queue" — but submit silently falls back to the current advisor when nothing is picked, so no ticket can land in an invisible state until the future "claim from queue" PR introduces a real open-queue surface on `/today`.

The control is rendered as a small **inline pill in the form's eyebrow row** (Direction A from the handoff). Designer recommendation, confirmed by Brandon 2026-05-12.

---

## Non-goals

- **No schema migration.** `sessions.tech_id` stays `NOT NULL`. Server-side fallback (advisor) is how "Open queue" is made safe without touching the DB.
- **No real open-queue surface on `/today`.** A future PR adds the section and the claim button. Until then, "Open queue" is an aspirational label backed by silent self-assign.
- **No reassignment after submit.** Edits live with the future session-page work.
- **No notifications** (email / push to the assigned tech).
- **No auto-assignment, load-balancing, or multi-tech assignment.**
- **No tech invite / signup flow.**
- **No new tokens.** Component uses existing `--vt-*` foundations.
- **No global keyboard shortcut** (`⌘ T`). Direction A's pill is chrome, not a form field. Per designer pushback in the handoff SPEC.

---

## Product behavior (locked in brainstorm 2026-05-12)

### Default resting state (multi-profile shop)

The pill sits in `MainHeader`'s eyebrow row, beside the existing `"NEW WORK ORDER"` text:

> **NEW WORK ORDER · ASSIGNED TO `[Open queue ▾]`**

- Pill label: `Open queue` (no avatar, no name).
- Pill border: `0.5px solid --vt-rule-strong`. Caret chevron at the right.
- Tap, click, `↵`, or `Space` while focused opens the popover.

### After a tech is picked

Pill replaces "Open queue" with the picked profile's avatar + name. Current user gets the "You" role tag; everyone else shows no role tag in the pill (role tags are popover-only).

### Solo-profile shop (today: just Brandon)

When `team.length === 1`, the pill renders **inert** with a dashed border and no caret:

> **NEW WORK ORDER · ASSIGNED TO `[● You · only tech]`**

- No keyboard handler. `cursor: default`. No popover ever opens.
- Submit behavior unchanged — silent self-assign kicks in like everywhere else.
- The instant a second profile joins the shop, the same component renders the active variant automatically — no code path branch beyond the `team.length === 1` check.

### Popover (laptop + tablet)

Anchored to the pill's left edge, 360 px wide, max 420 px tall with internal scroll. Surface uses `--vt-bone-50` + `--vt-shadow-pop`.

Structure:

```
┌─────────────────────────────────────────────┐
│ ASSIGNING TO                                │  ← eyebrow
├─────────────────────────────────────────────┤
│  ● Brandon            You          3 · 1    │
│  ● Diana                            5 · 2   │  ← amber tint (open ≥ 5)
│  ● Marcus                           1 · 0   │
├─────────────────────────────────────────────┤
│  × Clear · Open queue                       │  ← footer row
└─────────────────────────────────────────────┘
```

- **Current user pinned to top** (Brandon's row first), regardless of alphabetical order.
- Other rows sort `fullName ASC`, then `email ASC` if `fullName` is null.
- Each row: 36 px avatar column + name + workload badge (`{open} open · {today} today`).
- Hover / keyboard-focused row: bg → `--vt-bone-100`, 2 px left rail `--vt-amber-500`.
- Selected row (after a pick): name color `--vt-amber-500` + checkmark.
- **Clear row** at the bottom (`× Clear · Open queue`) unsets the selection and closes — only rendered when something is currently picked.
- Tap row / `↵` on focused row → commit + close.
- Tap outside / `Esc` → close, no change.

### Popover (phone, <768 px)

Replaces the popover with a **bottom sheet** rising from the viewport floor. `--vt-overlay` scrim above the form. Same rows, larger tap targets (56 px min). Cancel button (serif italic, signal-navy) at top-right of the sheet. Sheet head includes a search input when `team.length > 5`.

### Search (visible when `team.length > 5`)

- Plain substring match against `fullName` (or email fallback), case-insensitive.
- Inline in the popover head (laptop/tablet) or sheet head (phone).
- Count chip ("3 of 8") updates live.
- Empty query renders the full list with current user pinned.
- No match-highlighting (deliberate, per designer SPEC — names are short, the row already gets focus treatment).

### Workload badge

- Format: `{open} open · {today} today`
- `open` = lifetime open sessions (`status = 'open'`) for the profile in the shop.
- `today` = sessions created today (`created_at >= today UTC`) by that profile.
- When `open ≥ 5`, the **number** tints to `--vt-amber-500`. Quiet "this one's loaded" signal.

### Soft-fail (workload query errored)

- Badge is **removed from the DOM** entirely. No `—`, no `?`, no error toast.
- Popover and selection continue to work; the writer just doesn't see workload info.
- Recovery: next mount of the page re-queries. No retry button (keeps the surface quiet).

### Submit behavior

- Form body includes optional `assignedTechId?: string | null`.
- When `assignedTechId` is null / missing → server stamps `sessions.tech_id = ctx.profile.id` (current behavior preserved).
- When `assignedTechId` is non-null → server stamps `sessions.tech_id = assignedTechId` after verifying that profile belongs to `ctx.profile.shopId`.
- Cross-shop assigned IDs → `403 cross_shop_forbidden`.
- Unknown profile ID → `404 profile_not_found`.

---

## Component shape

### `<TechSelector>` (new — `components/vt/desktop/tech-selector.tsx`)

```tsx
type TechSelectorProps = {
  currentUserId: string                    // ctx.profile.id (for "You" tag + pinning)
  team: TeamMember[]                        // from getShopTeam — already shop-scoped, sorted
  workloadFailed?: boolean                  // true → badges hidden
  selectedId: string | null                 // null = "Open queue"
  onChange: (id: string | null) => void     // null = clear back to open queue
}

type TeamMember = {
  id: string                  // profile id
  name: string                // fullName or email local-part fallback
  email: string               // for tooltip / disambiguation
  isCurrentUser: boolean      // for pinning + "You" tag
  workload?: { open: number; today: number }
}
```

The component owns:
- Open / closed state of the popover.
- Search query (only relevant when `team.length > 5`).
- Keyboard focus index (when open).
- Solo-profile inert variant (when `team.length === 1`).
- Phone-vs-laptop variant via CSS media query — no JS branching.

It does NOT own:
- The selected ID itself — that's lifted to `CounterIntake` (the form owner) and flushes on submit.
- The team data — `CounterIntake` receives it from the server component (`app/(app)/intake/page.tsx`) and passes down.

### `MainHeader` slot extension

`MainHeader` (in `@/components/vt/desktop`) currently exposes `eyebrow: string`. Add an optional `eyebrowSlot?: React.ReactNode` rendered to the right of the eyebrow text:

```tsx
<MainHeader
  eyebrow="New work order"
  eyebrowSlot={<TechSelector currentUserId={…} team={…} … />}
  title="Who's at the counter?"
  …
/>
```

When `eyebrowSlot` is absent, layout matches today exactly.

### `CounterIntake` wiring

- Adds `team: TeamMember[]` + `workloadFailed: boolean` to its props.
- Adds `assignedTechId` to local state, initialized to `null`.
- Passes the new state + setter into `<TechSelector>` via `MainHeader.eyebrowSlot`.
- Includes `assignedTechId` in both branches of the submit body (pick-existing and manual-entry).

### `app/(app)/intake/page.tsx`

Currently fetches `recentCustomers`. Add a parallel fetch:

```ts
const [recentCustomers, team] = await Promise.all([
  getRecentIntakeCustomers({…}),
  getShopTeam({ db, shopId: ctx.profile.shopId, currentUserId: ctx.profile.id }),
])
```

Pass `team.members` and `team.workloadFailed` into `<CounterIntake>`.

---

## Server-side: `getShopTeam`

New file: `lib/intake/team.ts`.

```ts
export type GetShopTeamInput = {
  db: AppDb
  shopId: string
  currentUserId: string  // profile.id of the logged-in user
}

export type GetShopTeamResult = {
  members: TeamMember[]
  workloadFailed: boolean
}

export async function getShopTeam(
  input: GetShopTeamInput,
): Promise<GetShopTeamResult>
```

### Query 1 — team roster (mandatory)

```sql
select id, full_name, role, user_id
from profiles
where shop_id = $shopId
order by full_name asc nulls last, id asc
```

`getShopTeam` does NOT fetch emails. The current user's email comes from `ctx.user.email` (already in scope on the server component) and is passed into `<CounterIntake>` separately — the existing `userEmail` prop. Other teammates only render their `fullName`; when null, the row falls back to `Tech` + role tag rather than exposing an email address. (Other-user email fallback can be added later if requested.)

### Query 2 — workload counts (best-effort)

```sql
select
  tech_id,
  count(*) filter (where status = 'open')                              as open_count,
  count(*) filter (where created_at >= date_trunc('day', now()))       as today_count
from sessions
where shop_id = $shopId
  and tech_id = any($profileIds)
group by tech_id
```

- One batched query for the whole team.
- Wrap in try/catch. On any error → log + set `workloadFailed: true` and return members without workload data.
- Caller is responsible for honoring `workloadFailed` (hide badges).

### Composition

1. Run Query 1. Errors bubble up (page 500s — see Risk section). The current user's profile must be in the result; if it isn't, that's a data-integrity issue and 500 is correct.
2. Run Query 2 inside try/catch. On error → log + set `workloadFailed: true`.
3. Map workload onto profiles. Profile rows with no workload row → `{ open: 0, today: 0 }` (the absence-of-row case — distinct from `workloadFailed`).
4. Pin current user to the front of the returned array.
5. Return.

---

## Server-side: `/api/intake/submit` route changes

Two changes only:

1. **Parse** `assignedTechId` from the JSON body (alongside the existing `customer`, `vehicle`, `complaint`, `existingVehicleId` fields). Validate as either `null`, `undefined`, or a UUID string. Anything else → `422 invalid_assigned_tech_id`.

2. **Cross-shop check** before passing to `createSessionFromIntake`. If `assignedTechId` is set, look up the profile and confirm `profile.shopId === ctx.profile.shopId`. On miss → `403 cross_shop_forbidden`. On unknown ID → `404 profile_not_found`.

3. **Pass through** to `createSessionFromIntake` as a new optional param.

## Server-side: `createSessionFromIntake` signature

Today:

```ts
export type CreateSessionFromIntakeInput = {
  shopId: string
  advisorProfileId: string
  // … rest
}
```

New:

```ts
export type CreateSessionFromIntakeInput = {
  shopId: string
  advisorProfileId: string
  assignedTechId?: string | null   // new — falls back to advisorProfileId
  // … rest unchanged
}
```

Inside the function, the existing `techId: input.advisorProfileId` insert value becomes:

```ts
techId: input.assignedTechId ?? input.advisorProfileId
```

That single line is the entire "open queue silently self-assigns" mechanism.

---

## Accessibility

- Pill trigger: `<button role="combobox" aria-haspopup="listbox" aria-expanded={open}>`.
- Popover body: `<ul role="listbox">`; each row `<li role="option" aria-selected={isSelected}>`.
- `aria-activedescendant` tracks the keyboard-focused row id.
- Clear row: `<button role="option">` with `aria-label="Clear assignment, return to open queue"`.
- Solo-profile pill: `aria-disabled="true"`; no `aria-haspopup`.
- Sheet scrim on phone: `aria-hidden="true"`; tapping closes.

## Keyboard map

| Key | Where | Behavior |
|---|---|---|
| `Tab` to pill | form | focus pill (next stop is first form field) |
| `↵` / `Space` | pill focused | open popover, focus first row |
| `↑` / `↓` | popover open | walk rows (wraps), updates `aria-activedescendant` |
| `↵` | row focused | commit + close |
| `Esc` | popover open | close, no change |
| `Tab` from pill | popover closed | jump to first form field (Name) |

No global chord — Direction A treats the pill as chrome, not as a form field.

---

## Files touched

**New:**

- `components/vt/desktop/tech-selector.tsx` — the component itself.
- `components/vt/desktop/tech-selector.module.css` (or stylesheet inline-imported, matching existing pattern) — port of `tech-selector.css` from the handoff with `--vt-amber-*` renamed to `--vt-signal-*` (gotcha flagged in handoff context — same as last PR).
- `lib/intake/team.ts` — `getShopTeam` helper.
- `tests/unit/get-shop-team.test.ts` — query result shape + workload soft-fail.
- `tests/unit/intake-submit-tech-id.test.ts` — submit-route advisor-fallback + cross-shop guard + invalid id.
- `tests/unit/tech-selector.test.tsx` — component states (resting, open, search, solo, soft-fail, clear).

**Modified:**

- `components/vt/desktop/main-header.tsx` (or wherever `MainHeader` is exported from `@/components/vt/desktop`) — add `eyebrowSlot?: React.ReactNode` prop.
- `components/vt/desktop/index.ts` — export `TechSelector`.
- `components/screens/counter-intake.tsx` — receive `team` + `workloadFailed` props, hold `assignedTechId` state, render `<TechSelector>` in `MainHeader.eyebrowSlot`, include `assignedTechId` in submit body.
- `app/(app)/intake/page.tsx` — parallel-fetch team alongside recentCustomers; pass to `<CounterIntake>`.
- `app/api/intake/submit/route.ts` — parse + validate `assignedTechId`; cross-shop guard; pass to helper.
- `lib/intake/session.ts` — add `assignedTechId` to input type; `techId: input.assignedTechId ?? input.advisorProfileId` at the insert site.

**Tests updated (regression coverage):**

- `tests/unit/intake-submit-route.test.ts` — existing `expect(sessionRows[0].techId).toBe(ownerProfileId)` still passes (no `assignedTechId` in body → falls back to advisor).
- `tests/unit/intake-submit-pick-existing.test.ts` — same regression check.
- `tests/unit/intake-session.test.ts` — direct test of `createSessionFromIntake` fallback behavior.

---

## Test plan

**Logic tests (Vitest + PGlite — `pnpm test`):**

1. `assignedTechId` omitted from body → session row has `tech_id = advisorProfileId`.
2. `assignedTechId = null` in body → session row has `tech_id = advisorProfileId`.
3. `assignedTechId = own profile.id` → session row has `tech_id = currentUser.id`.
4. `assignedTechId = teammate.id in same shop` → session row has `tech_id = teammate.id`.
5. `assignedTechId = profile.id in different shop` → 403 `cross_shop_forbidden`, no row inserted.
6. `assignedTechId = "not-a-uuid"` → 422 `invalid_assigned_tech_id`.
7. `assignedTechId = uuid that doesn't exist` → 404 `profile_not_found`.
8. `getShopTeam` returns members sorted by `full_name ASC nulls last, id ASC`.
9. `getShopTeam` workload soft-fail → `workloadFailed: true`, members returned without workload.
10. `getShopTeam` workload success → members have `{ open, today }` matching the seeded counts.

**Component tests (Vitest + React Testing Library):**

11. `<TechSelector team=[1]>` (solo) → pill is `aria-disabled`, no popover opens on click.
12. `<TechSelector team=[3]>` resting → renders "Open queue" with caret, no search input on open.
13. `<TechSelector team=[8]>` open → search input visible, count chip "8 of 8" → typing filters live.
14. Pick a row → `onChange` fires with that id, pill updates name.
15. After pick → Clear row appears → click → `onChange(null)`, pill returns to "Open queue".
16. `workloadFailed: true` → no badges rendered on any row.
17. `Esc` closes popover without change.

**Manual on Vercel preview (Brandon-side):**

18. Solo-shop case (logged in as Brandon, no other profiles in shop) — pill reads "You · only tech", inert.
19. Add a second profile via Supabase MCP `execute_sql` in a `BEGIN; … ROLLBACK;` rehearsal — pill activates, popover opens.
20. Pick a tech, submit, confirm session shows on that tech's `/today` (after switching auth).

---

## Out of scope (per brief — do not implement)

- Real open-queue surface on `/today` + claim button (future PR).
- Reassignment after submit.
- Email / push to assigned tech.
- Auto-assignment / load-balancing.
- Multi-tech assignment.
- Tech invite / signup flow.
- Photo / avatar image support (initials only — placeholder geometry kept).
- Global keyboard chord (`⌘ T`) — Direction A treats pill as chrome.
- Persist last-picked-tech across consecutive intakes (parked — brief says always reset).
- Filter `team` by `availableToday` flag (parked — flag doesn't exist yet).

---

## Live database migration

**No migration required.** `sessions.tech_id` stays `NOT NULL`. Server-side fallback handles "Open queue" without DB changes.

(Per CLAUDE.md memory: schema PRs require explicit "apply migration to live Supabase" task. This PR has no schema PR.)

---

## Risk + rollback

- Rollback = revert the PR. No DB state to clean up. Existing sessions unaffected.
- Risk of cross-shop assignment is eliminated at the route level before the helper runs.
- Risk of workload query stalling the page is bounded by the soft-fail wrapper — at worst, badges disappear.
- Risk of the team query failing is the only blocker case (page would 500). Decision: **do NOT wrap the roster query in try/catch.** Profile fetch already runs in the same request via `requireUserAndProfile` against the same DB; if profile fetch succeeds, the team query failing is a real systemic error, not soft-fail material. Letting it 500 surfaces the problem rather than papering over it.

---

## Open questions (parked, do not block)

1. **Persist last-picked-tech for the advisor across consecutive intakes?** Brief says no, always reset. Holding to that.
2. **`availableToday` filter for the team list?** No such flag exists today. Out of scope.
3. **Should the diagnostic page show the assigned tech's name in its header?** Future session-page work. Not this PR.
