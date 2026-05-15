# PR 4: Account section — display name + reset password + signup-form fullName

> **For agentic workers:** SCOPE CONTRACT. Multi-part PR with three workstreams (Account section UI, signup-form change, reset-password page). Use `superpowers:subagent-driven-development` for cleaner per-task isolation.
>
> **Spec source:** `docs/superpowers/specs/2026-05-14-settings-page-design.md` (§3.1)
>
> **Branch base:** `settings-wip` (with PRs 1, 2, 3 applied)

**Goal:** Build the My Account section with (a) a display name editor + (b) a Reset Password button that triggers a Supabase magic-link email. Add a `fullName` field to the existing signup form so future signups don't start nameless. Build a new `/(auth)/reset-password` page that catches the Supabase reset link and lets the user set a new password.

**Architecture:** Three loosely-coupled changes united by the spec's Account vision. The Account section page is a server component for SSR + a small client form for editing. The new POST `/api/account/profile` endpoint follows the established codebase pattern (auth + paywall guard + DB write + JSON response). The reset-password page is a client component using `supabase.auth.updateUser({password})` after Supabase has authenticated the user via the magic link.

**Tech stack:** Same. No new dependencies — `supabase.auth.resetPasswordForEmail()` and `updateUser()` are in the SDK already.

---

## In scope

- `/settings/account` detail page — replaces placeholder, contains:
  - Profile Module (display name field + Save button)
  - Password Module (single Reset Password button)
- New `POST /api/account/profile` endpoint (updates `profiles.fullName`)
- New `/(auth)/reset-password` page (catches Supabase reset redirect, lets user set new password)
- Add `fullName` field to existing `app/(auth)/sign-up/sign-up-form.tsx` (required field, plumb through to profile creation in `lib/db/queries.ts:ensureProfileAndShop`)
- Visible to all roles (Tech, Admin, Founder all see this section)

## Out of scope (do not touch)

- Email change UI — DEFERRED to v2 per spec §2
- Avatar upload — not in scope
- 2FA, security log, sessions list — not in scope
- "Forgot password?" link on the sign-in page — could be a fast-follow but NOT in this PR (use the spec's roadmap to decide later)
- Don't refactor existing auth code beyond adding the `fullName` plumbing

## Files to create

- `app/(auth)/reset-password/page.tsx` — client component that lets a magic-link-authenticated user set a new password
- `app/api/account/profile/route.ts` — POST endpoint
- `components/vt/account-section.tsx` — client component with display name form + Reset Password button (extracted for testability)

## Files to modify

- `app/(app)/settings/account/page.tsx` — replace placeholder; render `<AccountSection />`
- `app/(auth)/sign-up/sign-up-form.tsx:36` — add `fullName` input above email; include in form state and signup payload
- `lib/db/queries.ts:ensureProfileAndShop` — accept `fullName` arg (or read from `user.user_metadata` if Supabase signup writes it there); persist to `profiles.fullName`
- (potentially) `lib/auth.ts` — if `requireUserAndProfile` needs to surface `fullName` differently

## Files NOT to modify

- Don't change `lib/supabase-server.ts` or `lib/supabase-client.ts`
- Don't change `middleware.ts`
- Don't add new schema columns (display name is `profiles.fullName`, already exists)

## Key technical decisions

- **Reset password = magic link only, no in-page form.** Per Brandon's call: the Reset button calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://<host>/reset-password' })`. Supabase emails the user. User clicks the link → lands on `/reset-password` (Supabase has authenticated them via the URL fragment) → sets new password via `supabase.auth.updateUser({ password })`. No current-password reauth.
- **Reset link expiry: Supabase default (1 hour).** Don't override unless friction observed in practice.
- **`/reset-password` is a CLIENT page.** Supabase's reset-link auth happens client-side (the JWT is in the URL fragment, not in cookies). Server-side rendering can't read it.
- **`fullName` field at signup is REQUIRED.** Don't make it optional. If empty, block the form submission with a validation message. The whole point is no future signup starts nameless.
- **No "are you sure?" confirmation for Reset Password.** It just sends an email. Worst case the user closes the email and doesn't reset. Cheap to dismiss.
- **API endpoint mirrors `app/api/intake/submit/route.ts:81-88`** for the auth+paywall guard pattern. NO server actions (codebase has none — `grep -r "use server"` returns empty).
- **Display name save UX**: form posts → response 200 → call `router.refresh()` so server-rendered surfaces (e.g., the AppHeader if it shows fullName, the /today greeting) pick up the new value.

## Code shape (load-bearing)

API endpoint (mirroring the existing pattern):

```ts
// app/api/account/profile/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const reject = paywallReject(/* see existing helper signature */)
  if (reject) return reject

  const body = await req.json().catch(() => null)
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
  if (fullName.length === 0 || fullName.length > 100) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
  }

  await db.update(profiles).set({ fullName }).where(eq(profiles.userId, ctx.user.id))
  return NextResponse.json({ ok: true })
}
```

Account section client component:

```tsx
// components/vt/account-section.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'
import { Module } from '@/components/vt'

export function AccountSection({ initialFullName, email }: { initialFullName: string; email: string }) {
  const [fullName, setFullName] = useState(initialFullName ?? '')
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const router = useRouter()

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch('/api/account/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    // surface error if !res.ok
  }

  async function sendReset() {
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (!error) setResetSent(true)
  }

  return (
    <>
      <Module num="01" label="Profile">
        <form onSubmit={saveName}>
          <label>
            Display name
            <input value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={100} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </Module>
      <Module num="02" label="Password">
        <p>We'll email you a link to set a new password.</p>
        <button onClick={sendReset} className="btn btn-primary" disabled={resetSent}>
          {resetSent ? 'Email sent — check your inbox' : 'Reset password'}
        </button>
      </Module>
    </>
  )
}
```

Reset-password page:

```tsx
// app/(auth)/reset-password/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'

export default function ResetPasswordPage() {
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.updateUser({ password: pwd })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/today')
  }

  return (
    <form onSubmit={setNewPassword}>
      <h1>Set a new password</h1>
      <label>
        New password
        <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} minLength={8} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
```

Signup-form change (additive — shape only; preserve existing logic):

```tsx
// app/(auth)/sign-up/sign-up-form.tsx (snippet near line 36)
const [fullName, setFullName] = useState('')

// In the form JSX, before email input:
<label>
  Your name
  <input value={fullName} onChange={e => setFullName(e.target.value)} required />
</label>

// In the signup call, pass fullName so it ends up in profiles.fullName
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: { data: { full_name: fullName } },  // user_metadata
})
// And/or pass to ensureProfileAndShop after signup confirms
```

`ensureProfileAndShop` modification (in `lib/db/queries.ts`):

```ts
// Add fullName as optional 4th arg; persist if provided
export async function ensureProfileAndShop({ db, supabase, user, fullName }: {
  db: DB
  supabase: SupabaseClient
  user: User
  fullName?: string
}) {
  // ... existing logic ...
  // If creating a new profile, set fullName from arg OR from user.user_metadata.full_name
  const nameToPersist = fullName ?? user.user_metadata?.full_name ?? null
  // INSERT INTO profiles (..., full_name) VALUES (..., nameToPersist)
}
```

## Acceptance criteria

- [ ] `/settings/account` renders Profile + Password modules for any signed-in user
- [ ] Display name field shows current value (empty for users with `null` fullName)
- [ ] Saving display name persists; refresh confirms persistence
- [ ] Display name shows up in places that already reference it (e.g., /today greeting if any)
- [ ] Reset Password button: tap → email arrives in inbox → "Email sent" UI confirms
- [ ] Clicking the email link → lands on `/reset-password` page authenticated
- [ ] Setting a new password works; signing out and signing back in with new password succeeds
- [ ] Old password no longer works after reset
- [ ] Signup form requires `fullName` (cannot submit without)
- [ ] New signups have non-null `fullName` in the database
- [ ] No regression in existing signup flow (Stripe checkout still triggers, etc.)

## Validation checklist

**Mobile (375px):**
- [ ] Account page renders cleanly, fields full-width, button ≥44px
- [ ] Reset-password page (the new one) renders cleanly
- [ ] Signup form renders with new fullName field, no overflow

**Tablet/desktop (≥768px):**
- [ ] Account section renders in the right pane of the split-pane layout
- [ ] Signup form looks right at desktop width

**Behavioral:**
- [ ] Save display name → DB updated (verify via SQL or refresh)
- [ ] Reset password → email arrives at the test account's inbox (within ~30s)
- [ ] Email link → land on `/reset-password` while authenticated (no sign-in prompt)
- [ ] New password set → can sign in with it
- [ ] Old password → fails to sign in
- [ ] Reset link clicked twice → second time still works (or expired — verify Supabase behavior)
- [ ] Reset link clicked after 1+ hour → expired (test ONLY if practical to wait)
- [ ] New signup with empty fullName → form validation blocks
- [ ] New signup with valid fullName → profile created with fullName populated

## Branch + commit guidance

- Stay on `settings-wip`
- Suggested commit boundaries: (1) API endpoint + AccountSection component, (2) reset-password page, (3) signup-form fullName addition, (4) replace Account placeholder with `<AccountSection>`
- DO NOT push to `main`. Brandon merges via GitHub UI.

## Risk notes

- **Email deliverability is the #1 friction point per the team-management UX research.** Test that Supabase's reset email actually arrives — to spam too. If users report not getting emails, the issue is likely Supabase email-provider config, not this PR's code.
- The signup-form change is the most fragile part — touches the existing payment/signup flow. Verify Stripe checkout still triggers for new signups.
- The `requireUserAndProfile()` change MUST handle existing users with `null` fullName gracefully (don't crash; just show empty field in the editor).

## Visual handoff note

Form field styling, Reset Password button visual treatment, and reset-password page polish are Claude Design's call. Functional baseline only here.
