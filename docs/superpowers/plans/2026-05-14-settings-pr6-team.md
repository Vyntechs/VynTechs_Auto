# PR 6: Team section — invite + roles + deactivate + canCurate tighten + deactivated_at migration

> **For agentic workers:** SCOPE CONTRACT. The biggest of the 6 PRs — multiple workstreams, a live-DB migration, a security-sensitive gate change. Use `superpowers:subagent-driven-development` for cleaner per-task isolation; consider splitting into parallel subagents for the independent parts (invite endpoint, role endpoint, deactivate endpoint, schema migration).
>
> **Spec source:** `docs/superpowers/specs/2026-05-14-settings-page-design.md` (§3.3, §6.1, §6.2, §6.4)
>
> **Branch base:** `settings-wip` (with PRs 1-5 applied)

**Goal:** Build the Team section UI (member list + invite form), wire the three Team endpoints (invite, role, deactivate), add the `profiles.deactivated_at` schema column, enforce deactivation in middleware, fix the `ensureProfileAndShop` "every signup creates new shop" bug for invitees, and tighten `canCurate` so Admin (Mac) doesn't accidentally inherit curator access.

**Architecture:** Schema additive (new nullable timestamp column). Three new POST endpoints follow the existing auth-guard pattern. Invite uses the Supabase admin SDK (`auth.admin.inviteUserByEmail`) with the existing service-role key. The `ensureProfileAndShop` change adds a "did this user already have a profile?" check — if yes, skip shop creation (the invite already pre-created the profile pointing at the inviter's shop).

**Tech stack:** Same. Supabase admin SDK already wired (used by `lib/storage/client.ts:14`).

---

## In scope

- `/settings/team` detail page — replaces placeholder, contains:
  - Members list Module (table-style at desktop; card-stack at mobile per `feedback_mobile_validation`)
  - Invite form Module (email input + Send button)
- `POST /api/team/invite` — sends Supabase invite, pre-creates profile pointing at inviter's `shopId`, role `'tech'`
- `POST /api/team/role` — promote/demote between `'tech'` and `'owner'` (rejects `'curator'`); last-Admin protection
- `POST /api/team/deactivate` — sets `profiles.deactivated_at = now()`; last-Admin protection; cannot deactivate self
- Schema migration: add `profiles.deactivated_at TIMESTAMP NULL`
- Middleware enforcement: deactivated users redirect to a new `/deactivated` page
- New `/deactivated` page (minimal: "Your account has been deactivated. Contact your shop admin.")
- `ensureProfileAndShop` modification: skip shop-creation if profile already exists for the user
- `canCurate` tightening: require `profile.role === 'curator'` OR `isFounder(user)`; do NOT pass for `'owner'` alone
- Live Supabase migration applied (per memory `feedback_apply_migration_to_live_db`)

## Out of scope (do not touch)

- Don't expose role `'curator'` in the UI dropdown — only `'tech'` and `'owner'` (Admin in UI parlance) selectable
- Don't add a UI to grant/revoke `is_comp` (founder-only, env-controlled)
- Don't add a UI to grant Founder access (deferred per spec §2)
- Don't add audit logs, IP restrictions, SSO, 2FA enforcement, or session revocation
- Don't add ownership-transfer flow (call-me-if-needed for v1)
- Don't add re-activation UI (deactivate is reversible by setting `deactivated_at = NULL` directly in DB if needed; UI for re-activation is fast-follow, not v1)

## Files to create

- `app/(app)/settings/team/page.tsx` — replace placeholder; renders `<TeamSection />`
- `app/api/team/invite/route.ts` — POST endpoint
- `app/api/team/role/route.ts` — POST endpoint
- `app/api/team/deactivate/route.ts` — POST endpoint
- `app/(app)/deactivated/page.tsx` — landing page for deactivated users (very minimal)
- `components/vt/team-section.tsx` — client component (members list + invite form)
- `drizzle/<NNNN>_add_profile_deactivated_at.sql` — migration

## Files to modify

- `lib/db/schema.ts` — add `deactivatedAt: timestamp('deactivated_at')` column to profiles table
- `lib/db/queries.ts:ensureProfileAndShop` — detect pre-existing profile; if found, skip shop creation
- `middleware.ts` — check `deactivatedAt`, redirect to `/deactivated` if set
- `lib/auth.ts:requireUserAndProfile` — check `deactivatedAt`, return null if set (so dependent surfaces gracefully reject)
- `lib/curator/can-curate.ts:5` — tighten gate per §6.4 of spec
- `lib/curator/route-helpers.ts:30` — verify the tightening is reflected; update if duplicated logic

## Files NOT to modify

- Don't change Stripe billing logic
- Don't change AppHeader (PR 1 + PR 5 cover all needed changes)
- Don't restructure existing role enum

## Key technical decisions

- **Invite uses Supabase admin SDK with service-role key.** Already wired in `lib/storage/client.ts:14`. Don't add a new env var. Server-side ONLY — never expose service-role key to the client.
- **Pre-create profile BEFORE the invite link is clicked.** When `auth.admin.inviteUserByEmail` returns, it includes the new `user.id`. Use that to INSERT a row in `profiles` with `userId: user.id`, `shopId: ctx.profile.shopId` (the inviter's shop), `role: 'tech'`, `deactivatedAt: null`. This is the FIX for the "every signup makes a new shop" bug — when the invitee clicks the link and signs in, `requireUserAndProfile` finds the existing profile and `ensureProfileAndShop` no-ops on shop creation.
- **`ensureProfileAndShop` change: detect pre-existing profile and skip shop creation.** Read the user's profile FIRST. If exists, return it (don't recreate). If not, fall through to existing creation logic.
- **`canCurate` tightening must NOT lock out Brandon.** Verify after change: Brandon's `role` is currently `'owner'` or `'curator'` (check); his email matches `FOUNDER_EMAIL`. If `canCurate` requires `role === 'curator' || isFounder(user)`, Brandon passes via either path. Mac (when set as `'owner'`) does not pass either. Test BEFORE shipping.
- **Last-Admin protection logic.** Count Admins (DB role `'owner'`) in the shop. If demoting/deactivating the last Admin, refuse with 400 + clear error message. Server-side check, mirrored in client-side UI for nicer UX (gray out the action), but the server is authoritative.
- **Cannot deactivate self.** Same gate. Even if there are other Admins, deactivating yourself locks you out — refuse via the API.
- **Deactivated user enforcement: middleware-level.** Middleware reads `profiles.deactivatedAt`; if set, redirects to `/deactivated`. Don't ALSO call Supabase admin to disable the auth user in v1 — middleware enforcement is sufficient for the use case (4 techs, low risk of a deactivated user trying API endpoints with stale tokens). Optional v2: also call `auth.admin.updateUserById(userId, { ban_duration: ... })` for stronger kill.
- **Mobile-friendly members list.** Members list does NOT use a wide table at small breakpoints. Use stacked cards on mobile, table at ≥768px. Per `feedback_mobile_validation` memory — the `/curator` page failed on mobile precisely because of wide tables without card fallback.
- **Migration MUST hit live Supabase.** Per memory `feedback_apply_migration_to_live_db`: PGlite tests passing ≠ live DB has the schema. The PR's task list MUST include "apply migration via Supabase MCP `apply_migration` to live project" as a checked item before merging to settings-page.

## Code shape (load-bearing)

Schema migration (drizzle SQL):

```sql
-- drizzle/<NNNN>_add_profile_deactivated_at.sql
ALTER TABLE profiles ADD COLUMN deactivated_at TIMESTAMP WITH TIME ZONE NULL;
CREATE INDEX idx_profiles_deactivated_at ON profiles(deactivated_at) WHERE deactivated_at IS NOT NULL;
```

Schema TS update (`lib/db/schema.ts`, in profiles table definition):

```ts
deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
```

Invite endpoint (the single most load-bearing piece):

```ts
// app/api/team/invite/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (ctx.profile.role !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  // Send Supabase invite
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
  })
  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? 'invite_failed' }, { status: 500 })
  }

  // Pre-create profile pointing at inviter's shop
  await db.insert(profiles).values({
    userId: data.user.id,
    shopId: ctx.profile.shopId,
    role: 'tech',
    fullName: null,
    isComp: false,
    deactivatedAt: null,
  })

  return NextResponse.json({ ok: true, invitedEmail: email })
}
```

`canCurate` tightening (`lib/curator/can-curate.ts`):

```ts
// before:
export function canCurate(profile: Profile): boolean {
  return profile.role === 'curator' || profile.role === 'owner'
}

// after:
import { isFounder } from '@/lib/auth'
export function canCurate(profile: Profile, user: User): boolean {
  return profile.role === 'curator' || isFounder(user)
}
```

(Note: signature change — every caller needs to pass `user`. Update callers: `app/curator/layout.tsx`, `lib/curator/route-helpers.ts`, anywhere else `canCurate` is called.)

`ensureProfileAndShop` modification (`lib/db/queries.ts:81-85` area):

```ts
// Add at top of function (before the existing shop-creation logic):
const existing = await db
  .select()
  .from(profiles)
  .where(eq(profiles.userId, user.id))
  .limit(1)
if (existing[0]) {
  // Profile already exists (e.g., from invite). Don't create a new shop.
  return existing[0]
}
// ... existing logic continues ...
```

Middleware deactivation check (`middleware.ts`, after the auth refresh):

```ts
// After getting the user/profile:
if (profile?.deactivatedAt) {
  if (req.nextUrl.pathname !== '/deactivated' && req.nextUrl.pathname !== '/sign-in') {
    return NextResponse.redirect(new URL('/deactivated', req.url))
  }
}
```

## Acceptance criteria

- [ ] Schema migration applied to LIVE Supabase via MCP `apply_migration` (not just PGlite/local)
- [ ] `/settings/team` renders for Admin: members list + invite form
- [ ] `/settings/team` blocked for Tech (redirect from page-level gate)
- [ ] Invite by email: invitee receives Supabase email, clicks link, lands authenticated, sets password, lands in INVITER's shop (verify via SQL — `profiles.shop_id` matches inviter's, NOT a new shop)
- [ ] Invitee starts as Tech (`profiles.role === 'tech'`)
- [ ] Admin can promote a Tech to Admin (member's `role` updates to `'owner'`)
- [ ] Admin can demote an Admin to Tech
- [ ] `/api/team/role` rejects role value `'curator'` (returns 400)
- [ ] Last-Admin protection: cannot demote/deactivate the only Admin in a shop (server returns 400; UI grays out the action)
- [ ] Cannot deactivate self (returns 400)
- [ ] Deactivating a Tech: their `deactivated_at` timestamp set
- [ ] Deactivated user attempting any authed page: redirected to `/deactivated`
- [ ] Past sessions/diagnoses by a deactivated user still display their name (FK preserved)
- [ ] **`canCurate` tightening: Mac as `'owner'` does NOT see /curator** (verify by signing in as a non-Founder owner)
- [ ] **Brandon as Founder DOES see /curator** (verify post-deploy that founder access is preserved)
- [ ] Existing direct signups still work normally (auto-create shop, role `'owner'`) — only INVITED users get pre-created profiles

## Validation checklist

**Mobile (375px):**
- [ ] Members list renders as stacked cards (NOT a wide table) — no horizontal scroll
- [ ] Each card has tap-friendly action buttons (≥44px)
- [ ] Invite form fits without overflow
- [ ] Test the `/curator` page after this PR — it should STILL render fine on mobile if it was already working there post-PR0; this PR doesn't touch curator UI

**Tablet (768px) and desktop:**
- [ ] Members list as table; columns visible without overflow
- [ ] Invite form aligned in detail pane

**Behavioral:**
- [ ] Send a real invite to a test email account; confirm email arrives (test inbox + spam folder)
- [ ] Click invite link → reset-password page → set password → /today
- [ ] Verify SQL: invited user's `shop_id` matches inviter's, NOT a fresh shop
- [ ] Promote test user to Admin → verify SQL `role` change, verify they now see Admin sections
- [ ] Demote → verify the inverse
- [ ] Deactivate test user → they get redirected to /deactivated on next request
- [ ] Reactivate (manually set `deactivated_at = NULL` via SQL) → user can sign in again
- [ ] **Critical**: sign in as Mac (set Mac as `role: 'owner'` in DB if needed for testing) → confirm /curator pages return 403/redirect, NOT visible
- [ ] **Critical**: sign in as Brandon → confirm /curator still works (Founder access preserved)
- [ ] curl POST `/api/team/role` with `role: 'curator'` → 400
- [ ] curl POST `/api/team/deactivate` for last Admin → 400
- [ ] Existing direct-signup flow: sign up a brand-new email through `/sign-up` → still creates a fresh shop (the invite path is the only one that pre-creates profiles)

## Branch + commit guidance

- Stay on `settings-wip`
- Suggested commit boundaries:
  1. Schema migration + schema.ts update
  2. `ensureProfileAndShop` modification
  3. `canCurate` tightening + caller updates
  4. Middleware deactivation enforcement + `/deactivated` page
  5. `/api/team/invite` endpoint
  6. `/api/team/role` endpoint
  7. `/api/team/deactivate` endpoint
  8. `<TeamSection>` UI component
  9. Replace Team placeholder with `<TeamSection>`
- Apply migration to LIVE Supabase as a separate step BEFORE marking the PR ready for review
- DO NOT push to `main`. Brandon merges via GitHub UI.

## Risk notes

- **`canCurate` tightening is the highest-blast-radius change in this PR.** If implemented wrong, you can lock Brandon out of /curator. Verify on a preview deployment with Brandon's actual login BEFORE merging.
- **Live DB migration is destructive-adjacent.** Additive (nullable column), so risk is low — but missing the live migration step means EVERY page that hits `requireUserAndProfile` will 500 because the schema mismatch breaks Drizzle queries. Per memory `feedback_apply_migration_to_live_db`.
- **Invite emails go to spam.** Per Sonnet research, this is the #1 friction in shop SaaS team UIs. Test that emails arrive AND don't go to spam. If they do, document the sender-domain whitelisting step for Brandon's deployment notes.
- **Pre-creating a profile before the user has accepted the invite is unusual.** Most apps create the profile only after first sign-in. Doing it at invite time is the FIX for the "every signup makes a new shop" bug — but it means there's a window where a `profiles` row exists for a user who may never accept. That's fine (orphan rows don't break anything), but document it.
- **Multi-Admin in one shop is allowed by schema.** The spec doesn't restrict this. Both Brandon and Mac can be Admin in YMS.

## Visual handoff note

Members list visual (table vs cards transition, action button styling, empty state when 0 invitees), invite form polish, and `/deactivated` page treatment are Claude Design's call. Functional baseline only.

## Brandon's post-merge cleanup task (NOT this PR's scope)

After PR 6 is merged and live, Brandon should:
1. Manually rename all the auto-generated YMS shop names (`mac@…'s Shop`, etc.) to `Young Motorsports` via the new Shop section
2. Manually consolidate any duplicate YMS shops if any still exist (per memory `reference_shops_table_cleanup`)
3. If desired, send fresh invites to the existing YMS techs through the new flow to test it end-to-end (they're already in the shop; this is just exercise)
