# Settings Page — Design Spec

**Date:** 2026-05-14
**Branch (work):** `settings-wip` (cuts from `feat/header-polish`)
**Branch (integration target):** `settings-page` (Brandon merges PRs into this from `settings-wip` after validation)
**Final destination:** `main` (Brandon merges `settings-page` → `main` after all 6 PRs validated)

---

## 1. Goal

Add a Settings page that gives shop owners a UI to do things they currently can only do by hand-editing the database: edit their display name, reset their password, rename the shop, manage the team (invite, role-change, deactivate), and manage billing.

Today: there is no Settings page. `/billing` is a single Stripe-portal button. The founder hand-edits `profiles.role` and `profiles.shop_id` in Supabase to onboard team members. Display names are `null` for every existing user (signup never collected them). Every signup creates its own `"<email>'s Shop"` and the only way to merge people into one shop is by hand.

After this work: `/settings` exists with four sections (My Account, Shop, Team, Billing) using a list-detail layout that works at every breakpoint. The AppHeader gains a hamburger menu (the first persistent nav element in the app). The team-onboarding bug — every new signup auto-creating a new shop — is fixed by routing invitees through a new invite endpoint that pre-creates their profile pointing at the inviter's `shop_id`.

---

## 2. Out of scope (explicitly deferred)

- **Reminders / follow-up cadence configuration.** The 7d + 30d follow-up cadence (`lib/comeback/schedule.ts:34,41`) stays hardcoded. Reason: today follow-ups only surface as a `/today` page card — no email, no SMS, no push, no AppHeader badge. A configurable knob that doesn't change anything visible to the user is worse than no knob (trust erosion). Revisit when notifications ship OR when per-job opt-out is needed.
- **Email change.** Supabase email change requires a confirmation-email round-trip AND must update the Stripe customer email simultaneously (since billing is keyed off email via `ensureStripeCustomer` in `lib/auth.ts:5`). Disproportionately fiddly for the 4 known users to hit. Defer to v2.
- **Founder-access UI.** Today `isFounder()` (`lib/auth.ts:54`) compares `user.email` to the `FOUNDER_EMAIL` env var — Brandon is the only Founder. No UI to grant Founder to others. Revisit if/when there's a co-developer or trusted ops person who needs Founder.
- **`is_comp` (free-account) toggle in UI.** This bypasses the paywall (`lib/auth-access.ts:51`); if exposed to shop owners, they could comp themselves. Stays SQL-only / env-controlled.
- **Per-permission toggles, audit logs, IP restrictions, SSO, 2FA enforcement, ownership transfer UI.** Defensible at 4-tech scale. Revisit when shop #2 onboards or when scale demands.
- **Reminders, audit logs, "settings activity" surfaces.** None planned in v1.

---

## 3. User-facing behavior (per section)

### 3.1 My Account (visible to all roles)

**Profile:** Display name field. User can edit and save. The same field is also added to the signup form (PR 4) so future signups don't start nameless.

**Password:** Single "Reset password" button. Tapping it calls `supabase.auth.resetPasswordForEmail()` — Supabase emails the user a magic link to their current address. User clicks the link, lands on a new `/auth/reset-password` page, sets a new password, done.

This unifies "forgot" and "change" into one flow. There is no in-page password form. No current-password reauth (the email-link IS the proof of identity).

Edge case noted, not solved in v1: if the user's email itself is compromised, this flow doesn't help — but that's true of every internet password reset.

### 3.2 Shop (visible to Admin only)

**Shop name:** Field + Save button. Updates `shops.name`. The new name appears in the AppHeader (placement is Claude Design's call when handing off).

**Why this matters more than it looks:** today every signup auto-generates `"<email>'s Shop"` and `shops.name` is never displayed anywhere in the app. After this PR (5), shop name is editable AND displayed. Every existing YMS user has the wrong shop name in the DB right now; this section gives them the path to fix it.

### 3.3 Team (visible to Admin only)

**Members list:** Each row shows name, role (Tech / Admin), status (Active / Deactivated), and actions (Promote/Demote, Deactivate). Last-Admin protection: cannot demote yourself if you're the only Admin; cannot deactivate the last Admin.

**Invite form:** Email field + Send invite button. Always invites as Tech. Admin can promote later.

**Invite flow:**
1. Admin enters email, clicks Send invite
2. New POST `/api/team/invite` runs server-side:
   - Validates Admin gate
   - Calls `supabase.auth.admin.inviteUserByEmail(email)` (using existing `SUPABASE_SERVICE_ROLE_KEY`)
   - **Pre-creates a `profiles` row** with `userId` from the Supabase invite response, `shopId` from the inviter, `role: 'tech'`
3. Invitee receives Supabase magic link → clicks → lands on `/auth/reset-password` (or a new accept-invite page) → sets password
4. On first sign-in, `requireUserAndProfile()` finds the existing pre-created profile and does NOT call `ensureProfileAndShop()` (no new shop created). They land in the inviter's shop.

**Removal = Deactivate, not hard-delete.** Sets `profiles.deactivated_at = now()` (new column added in PR 6). Middleware checks the flag on every request and redirects deactivated users to a "your account has been deactivated" screen. Their name stays on past sessions / diagnoses / corpus entries (no FK changes). Industry-standard pattern; missing it is the #1 complaint in shop-SaaS reviews. See §6.1 for migration / enforcement detail.

### 3.4 Billing (visible to Admin only)

**Same as today's `/billing` page**, just relocated to `/settings/billing`. One Stripe customer-portal button. No functional change. The old `/billing` URL 308-redirects to `/settings/billing` so existing bookmarks and Stripe redirect URLs survive.

---

## 4. Architecture & layout

### 4.1 Layout pattern: list-detail (iOS Settings model)

- **`/settings`** = full-page list of 4 sections (rows). Tap a row → `/settings/<section>`.
- **`/settings/<section>`** = the section's detail page.
- On mobile (<768px): list and detail are separate full-screen pages. Back button on detail pages.
- On tablet/desktop (≥768px): list-on-left + detail-on-right, in a single `display: grid; grid-template-columns: 220px 1fr` layout. List stays visible; navigating between sections doesn't unmount it. No back button needed at this width.

Picked because: it's the only pattern whose mobile and tablet/desktop layouts share the same mental model (iOS Settings, Android Settings, Notion, Figma all use it). Beats sidebar-with-drawer (top complaint about GitHub/Vercel/Slack mobile settings is the hidden nav). Beats single-page-scroll (doesn't scale to 6-8 sections, no quick-jump affordance). Beats tabs (break past 5 sections, too small for gloved fingers).

### 4.2 File structure

```
app/(app)/settings/
  layout.tsx           # Holds the responsive grid; auth-gated
  page.tsx             # The list (4 rows)
  account/page.tsx     # Account detail
  shop/page.tsx        # Shop detail (Admin gate)
  team/page.tsx        # Team detail (Admin gate)
  billing/page.tsx     # Billing detail (Admin gate); replaces app/(app)/billing/page.tsx
app/(auth)/reset-password/page.tsx   # Catches Supabase reset-link, sets new pwd
                                     # In existing (auth) route group alongside sign-in/sign-up

next.config.js                       # Add a permanent (308) redirect:
                                     # /billing → /settings/billing
                                     # The old app/(app)/billing/page.tsx file is DELETED in PR 3
                                     # (the redirect handles bookmarks before any route resolution)
```

### 4.3 Visual constraint (NEW — per Brandon's directive)

**Reuse existing design system. No new visual idiom — only a new structural pattern.**

- **Tokens:** all `--vt-*` from `app/globals.css` (spacing, color, font, shadow, radius)
- **Layout shell:** `<main className="app">` (existing, used by `/billing`, `/today`, `/sessions/new`)
- **Header:** `<AppHeader title="Settings" back={{href:'/today',label:'My Jobs'}} />` (existing component, modified per §5)
- **Cards within detail pages:** `<Module num="01" label="...">` (existing pattern, used by `/billing`)
- **Buttons:** `.btn .btn-primary`, `.btn .btn-ghost` (existing classes from `vt.css`)
- **Form fields:** match existing field styles in `sign-up-form.tsx` and `intake/submit` forms
- **List-page rows:** simple flat list with `--vt-rule` dividers between rows; ~56px tall (gloved-finger touch target); chevron-right icon on the right; full-width tappable
- **Mobile-friendly idioms (where applicable):** model on `tech-selector` bottom-sheet (`tech-selector.css:292-339`) if any drawer/sheet is needed; do NOT introduce hamburger drawer pattern (none exists in codebase yet)

**The `/curator` failure pattern to AVOID:** rigid multi-column grids without stacked-card mobile fallback (`vt.css:941`), wide tables without responsive treatment. None of those should appear in Settings.

---

## 5. AppHeader changes (PR 1)

- **Hamburger menu button** added on the LEFT side, before the V° logo. Tap to open a slide-down menu. Menu contents:
  - My Jobs (links `/today`)
  - Settings (links `/settings`)
  - Curator (links `/curator`) — visible only if `isFounder()`
  - Sign Out — calls existing sign-out logic
- **Existing `<SignOutButton>` STAYS in its current right-side position.** Familiar, redundant access. Brandon explicitly asked for SignOut to remain on every authenticated page (per recent commit `3d3c202`).
- **Shop name displayed** somewhere in the header. Exact placement is Claude Design's call when we hand off; spec just requires "shop name visible in AppHeader on every authed page."

The hamburger is the FIRST persistent navigation element in the app. Whatever idiom Claude Design picks for it will likely set the pattern for any future nav additions.

---

## 6. Schema & data flow

### 6.1 Schema additions (PR 6, Team)

To support deactivate-without-delete:
- Add `profiles.deactivated_at` (`timestamp`, nullable). Set when an Admin deactivates a member.
- `requireUserAndProfile()` must check `deactivated_at IS NOT NULL` and redirect to a "your account has been deactivated" page (or block with a 403).
- Past sessions/diagnoses by the deactivated user remain in their history (their `tech_id` references stay valid; their name still renders).

Migration path: additive only (add nullable column). Per the project memory `feedback_apply_migration_to_live_db`, the PR MUST include "apply migration to live Supabase via MCP `apply_migration`" as a checklist item — PGlite tests passing ≠ live DB has the schema.

No other schema changes are required. `profiles.role` enum (`'tech' | 'curator' | 'owner'`) stays as-is; UI just doesn't surface `curator` as a selectable role.

### 6.2 New API endpoints

| Endpoint | Method | Body | Gate | Purpose |
|---|---|---|---|---|
| `/api/account/profile` | POST | `{ fullName }` | Authenticated | Update own display name |
| `/api/shop` | POST | `{ name }` | Admin | Update shop name |
| `/api/team/invite` | POST | `{ email }` | Admin | Send Supabase invite + pre-create profile pointing at owner's `shopId` |
| `/api/team/role` | POST | `{ userId, role }` | Admin + last-Admin protection | Promote/demote |
| `/api/team/deactivate` | POST | `{ userId }` | Admin + last-Admin protection | Set `deactivated_at` |

All follow the existing pattern: `requireUserAndProfile` + `paywallReject` + body validation + DB write + `NextResponse.json`. Mirror `app/api/intake/submit/route.ts:81-88` for the auth+paywall guard shape. No server actions (codebase has none — `grep -r "use server"` returns nothing).

### 6.3 Reused / unchanged

- `/api/stripe/portal` — existing, unchanged. `BillingClient` keeps using it.
- Supabase admin SDK — service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is already wired for storage (`lib/storage/client.ts:14`); no new env var.
- `requireUserAndProfile()` — small change: detect a pre-existing profile and skip `ensureProfileAndShop()` so invitees don't get a fresh shop.

### 6.4 Bundled gate fix (PR 6)

`lib/curator/can-curate.ts:5` currently passes for both `'curator'` and `'owner'` roles. After this work, "Admin" in the UI = DB role `'owner'` (Mac becomes Admin) — and Mac must NOT see the curator dashboard. Tighten `canCurate` to require `role === 'curator'` OR `isFounder(user)`. Brandon stays on `role: 'curator'` (or whatever role he currently has) AND is the Founder, so he keeps full access. Mac as `'owner'` does not get curator access.

This is a one-line gate change in `lib/curator/can-curate.ts` plus matching update in `lib/curator/route-helpers.ts:30` if it duplicates the check.

---

## 7. Role gating summary

**UI role → DB enum mapping:**
- "Tech" (UI) ↔ DB `profiles.role = 'tech'`
- "Admin" (UI) ↔ DB `profiles.role = 'owner'`
- "Founder" (UI implicit, no enum) ↔ `user.email === FOUNDER_EMAIL` (env var match)
- DB `profiles.role = 'curator'` is RESERVED and not exposed in the UI; reserved for Brandon's existing role and any future "AI-teaching" role grants done out-of-band.

The UI's `/api/team/role` endpoint accepts ONLY `'tech'` or `'owner'` as values; it must reject `'curator'`.

| Surface | Tech | Admin (Mac) | Founder (Brandon) |
|---|---|---|---|
| My Account section | ✅ | ✅ | ✅ |
| Shop section | ❌ | ✅ | ✅ |
| Team section | ❌ | ✅ | ✅ |
| Billing section | ❌ | ✅ | ✅ |
| Hamburger menu — My Jobs | ✅ | ✅ | ✅ |
| Hamburger menu — Settings | ✅ (but only sees Account row) | ✅ | ✅ |
| Hamburger menu — Curator | ❌ | ❌ | ✅ |
| `/curator/*` access | ❌ | ❌ (after gate fix) | ✅ |

---

## 8. PR slicing

Six stacked PRs on `settings-wip` → merged to `settings-page` after validation → eventually to `main`.

| PR | Subject | Validates |
|---|---|---|
| 1 | AppHeader: hamburger menu + shop name display | Menu opens/closes on mobile/tablet/desktop; shop name visible; SignOut still works |
| 2 | `/settings` skeleton (list, layout, redirects, placeholder sections) | List shows on mobile; split-pane on desktop (≥768px); old `/billing` redirects to `/settings/billing` placeholder |
| 3 | Billing section (move BillingClient content) | Stripe portal still opens from new URL; old `/billing` redirect still works |
| 4 | Account section + signup-form `fullName` field + `(auth)/reset-password` page | Display name save persists; reset-password email sent; reset-link landing page sets new password |
| 5 | Shop section + AppHeader updates with new name live | Rename persists; AppHeader displays new name across all authed pages |
| 6 | Team section: full invite/role/deactivate flow + `canCurate` tighten + `deactivated_at` migration | Invite end-to-end (email arrives, link works, invitee lands in inviter's shop, NOT a new shop); role promote/demote; deactivate kills login + preserves history; last-Admin protection blocks bad ops; Mac cannot see /curator |

PR 6 is the biggest and gets the most validation attention. It also includes the live-DB migration and the gate-tightening change — both have blast-radius beyond Settings.

---

## 9. Mobile validation requirements (per memory `feedback_mobile_validation`)

Every PR in this stack MUST be explicitly validated on a 375-414px wide viewport before being marked done. Desktop-only validation does NOT count. Specifically:

- **PR 1:** hamburger menu opens cleanly on phone, doesn't overlap title/meta/SignOut, tap targets ≥44px
- **PR 2:** list page renders one row per section without overflow at 375px; chevrons visible; rows fully tappable
- **PR 3-6:** each detail page renders without horizontal scroll at 375px; fields full-width; buttons ≥44px

DO NOT replicate the `/curator` mobile failure pattern: no rigid multi-column grids, no wide tables without card fallback.

---

## 10. Open questions / handoffs

- **Hamburger icon visual style** → Claude Design call when handing off (just specify "hamburger icon, left of V° logo, opens slide-down menu").
- **Shop name placement in AppHeader** → Claude Design call. Spec only requires "visible on every authed page."
- **List-page row visual** → Claude Design call beyond the structural "flat list with `--vt-rule` dividers, chevron-right, ~56px tall" requirement.
- **Activation link expiry** → Use Supabase default (1 hour for password-reset; longer for invite). Configurable later if friction.
- **First-Admin in a brand-new shop** → Still works as today: every signup that goes through `/sign-up` (not via invite) auto-becomes Admin (DB `role: 'owner'`) of a freshly-created shop. No change here in v1.

---

## 11. Bookkeeping

- **Branch base:** `feat/header-polish` (the AppHeader is needed; this branch isn't yet on main). When `feat/header-polish` lands on main, `settings-page` will need a rebase onto new main (header-polish commits will deduplicate via the merge commit, only the Settings work survives the rebase).
- **Live DB migration:** PR 6's `deactivated_at` column must be applied to live Supabase via Supabase MCP `apply_migration`. PGlite tests passing ≠ live DB has the schema (memory `feedback_apply_migration_to_live_db`).
- **Visual handoff:** when each PR is ready for design polish, hand off to Claude Design (separate session) per memory `feedback_claude_design_handoff`.
- **Brandon merges everything.** I do not push to main, do not merge `settings-wip` → `settings-page`, do not merge `settings-page` → main. Brandon does all merging via GitHub UI after his own validation.
