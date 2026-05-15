# PR 5: Shop section — rename + AppHeader live-update

> **For agentic workers:** SCOPE CONTRACT. Use `superpowers:executing-plans` or `superpowers:subagent-driven-development`.
>
> **Spec source:** `docs/superpowers/specs/2026-05-14-settings-page-design.md` (§3.2)
>
> **Branch base:** `settings-wip` (with PRs 1-4 applied)

**Goal:** Build the Shop section with one capability — renaming the shop. After save, the new name appears in the AppHeader (which already displays shop name from PR 1) within the same session, no logout required.

**Architecture:** Trivial server-action-style flow with no schema changes. The Shop section is a client component with a name field + Save button. New `POST /api/shop` endpoint updates `shops.name`. Calls `router.refresh()` after success so the next render of the (app) layout picks up the new shop name and propagates it through the AppHeader.

**Tech stack:** Same.

---

## In scope

- `/settings/shop` detail page — replaces placeholder, contains:
  - One Module: shop name field + Save button
- New `POST /api/shop` endpoint (updates `shops.name` for the user's `shopId`)
- Admin gate: Tech sees the section locked / hidden; only Admin can save
- Live-update: after save, AppHeader's shop name display refreshes (via `router.refresh()`)

## Out of scope (do not touch)

- Don't add other shop fields (address, phone, hours, logo, tax ID, etc.) — none exist in the schema, all out of scope per spec §2
- Don't add shop creation UI (auto-creation at signup is unchanged)
- Don't add shop deletion UI
- Don't change the AppHeader's shop name DISPLAY behavior — that's already wired in PR 1; this PR just changes the underlying value
- Don't expose shop ID, slug, or any internal identifiers

## Files to create

- `app/api/shop/route.ts` — POST endpoint
- `components/vt/shop-section.tsx` — client component for the rename form (extracted for testability)

## Files to modify

- `app/(app)/settings/shop/page.tsx` — replace placeholder; render `<ShopSection initialName={shop.name} />`
- `lib/db/queries.ts` — add `updateShopName({ db, shopId, name })` helper (or use inline drizzle update — judgment call based on existing patterns in this file)

## Files NOT to modify

- Don't touch `lib/db/schema.ts` — `shops.name` already exists
- Don't touch the AppHeader (PR 1 already plumbed shop name display)

## Key technical decisions

- **Admin gate enforced server-side AND client-side.** The page-level role check (in `/settings/shop/page.tsx`) blocks Tech users; the API endpoint also rechecks because client-side gates can be bypassed via curl. Belt-and-suspenders. Reuse existing role-check pattern from `lib/auth-access.ts` and the curator route helpers.
- **Validation: shop name 1-80 chars, trimmed.** Empty strings rejected. No format restrictions (allow unicode, allow numbers, allow special chars — shop names have weird real-world variety).
- **No cascade concerns.** `shops.name` is not in any URL, slug, or external reference. Just a display string.
- **`router.refresh()` after save.** Triggers re-render of server components in the (app) layout, which re-fetches the shop record, which refreshes the AppHeader's shop name display.
- **No optimistic UI.** Show "Saving…" → wait for response → either show success state or error. Optimistic update would risk flashing the new name then reverting on error — confusing.

## Code shape (load-bearing)

API endpoint:

```ts
// app/api/shop/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { shops } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Admin gate — Tech cannot rename
  if (ctx.profile.role !== 'owner' /* and not isFounder-only check; explore existing helpers */) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (name.length === 0 || name.length > 80) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
  }

  await db.update(shops).set({ name }).where(eq(shops.id, ctx.profile.shopId))
  return NextResponse.json({ ok: true })
}
```

Shop section client component:

```tsx
// components/vt/shop-section.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from '@/components/vt'

export function ShopSection({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/shop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setBusy(false)
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      setError(payload.error ?? 'Could not save')
      return
    }
    router.refresh()  // AppHeader re-renders with new shop name
  }

  return (
    <Module num="01" label="Shop name">
      <form onSubmit={save}>
        <label>
          Shop name
          <input value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </Module>
  )
}
```

Page (server component):

```tsx
// app/(app)/settings/shop/page.tsx
import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { shops } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { ShopSection } from '@/components/vt/shop-section'

export default async function SettingsShopPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')
  if (ctx.profile.role !== 'owner') redirect('/settings')  // Admin-only

  const [shop] = await db.select().from(shops).where(eq(shops.id, ctx.profile.shopId))
  return <ShopSection initialName={shop.name} />
}
```

## Acceptance criteria

- [ ] Admin user: `/settings/shop` renders the editor with current shop name pre-filled
- [ ] Tech user: cannot reach `/settings/shop` (redirected) AND doesn't see "Shop" row in `/settings` list (already gated by PR 2)
- [ ] Save persists to DB (`shops.name` updates)
- [ ] After save, the AppHeader's shop name display shows the new name immediately (no logout/login required, no manual page refresh required)
- [ ] Reload `/settings/shop` after save: form pre-filled with new name (confirms persistence)
- [ ] Empty name → server rejects with 400, client shows error message
- [ ] Name >80 chars → server rejects with 400
- [ ] Unicode / special chars / numbers in name: accepted

## Validation checklist

**Mobile (375px):**
- [ ] Form renders cleanly, field full-width, button ≥44px
- [ ] After save, navigate back to /settings list and confirm new name visible (in AppHeader; depends on where Claude Design placed it)

**Tablet/desktop (≥768px):**
- [ ] Section appears in right pane of split-pane layout
- [ ] After save, AppHeader updates without leaving the section (live update)

**Behavioral:**
- [ ] Sign in as Admin → /settings/shop visible, save works
- [ ] Sign in as Tech → /settings/shop blocked (redirect or 403); Shop row absent from /settings list
- [ ] Save changes the DB (verify via SQL or by signing in fresh and seeing the new name)
- [ ] Empty name attempt → blocked client-side (required attr) AND server-side (400)
- [ ] curl POST as Tech (bypassing UI) → 403 from API (verifies server-side gate, not just client)
- [ ] After save, all other authed pages also show the new shop name in their AppHeader (the change is global)

## Branch + commit guidance

- Stay on `settings-wip`
- Suggested commit boundaries: (1) API endpoint + ShopSection component, (2) replace Shop placeholder with `<ShopSection>`
- DO NOT push to `main`. Brandon merges via GitHub UI.

## Risk notes

- The "live-update via `router.refresh()`" depends on PR 1's AppHeader correctly reading the shop name from a server-rendered surface (layout-fetched + prop-passed, NOT cached client-side). If that wiring is wrong, the AppHeader won't update — verify by inspecting the render path.
- After PRs 1+5 ship, every YMS user can finally rename their shop. Brandon should batch-rename all the wrong-named shops manually post-merge (e.g., `mac@…'s Shop` → `Young Motorsports`). Note for handoff to Brandon, NOT this PR's scope.

## Visual handoff note

Form field styling, the "Saving…" state visual, and the success state (toast? inline message?) are Claude Design's call. Functional baseline only.
