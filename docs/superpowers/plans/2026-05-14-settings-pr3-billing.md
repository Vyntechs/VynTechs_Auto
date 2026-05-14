# PR 3: Billing section — relocate BillingClient into /settings/billing

> **For agentic workers:** SCOPE CONTRACT. Smallest of the 6 PRs — almost a copy-paste move. Use `superpowers:executing-plans` or `superpowers:subagent-driven-development`.
>
> **Spec source:** `docs/superpowers/specs/2026-05-14-settings-page-design.md` (§3.4)
>
> **Branch base:** `settings-wip` (with PRs 1 + 2 applied)
>
> **Depends on PR 2** (the `/settings/billing` placeholder page must exist for us to replace its content).

**Goal:** Replace the "Coming soon" placeholder at `/settings/billing` with the existing `BillingClient` component. Update its `back` prop to point at `/settings`. No functional change to subscription management — same Stripe portal button, same endpoint.

**Architecture:** Trivial — swap the placeholder render for `<BillingClient />` and adjust one prop. The `BillingClient` component stays where it lives (`components/screens/billing-client.tsx`); only its mount point changes.

**Tech stack:** Same as existing.

---

## In scope

- Replace placeholder content in `app/(app)/settings/billing/page.tsx` with `<BillingClient />`
- Update `BillingClient`'s AppHeader `back` prop from `{href:'/today',label:'My Jobs'}` to `{href:'/settings',label:'Settings'}` (mobile-only back; desktop has list always visible)
- No other changes

## Out of scope (do not touch)

- Don't change anything in `/api/stripe/portal` — endpoint is unchanged
- Don't change `BillingClient`'s functional behavior — same button, same flow, same error handling
- Don't touch the redirect from `/billing` (already in PR 2)
- Don't add subscription-status display, plan info, next-billing-date, or any other new UI — that's future scope, NOT this PR

## Files to modify

- `app/(app)/settings/billing/page.tsx` — replace placeholder Module with `<BillingClient />`
- `components/screens/billing-client.tsx` — change the `back` prop value passed to AppHeader

## Files NOT to modify

- `app/api/stripe/portal/route.ts` — unchanged
- `components/screens/billing-client.tsx`'s functional code (everything except the back prop)

## Key technical decisions

- **`BillingClient` stays in `components/screens/`.** No file move. The component is reusable; only its mount route changes. Moving it into `components/vt/settings-sections/` (or similar) is YAGNI — there's no other consumer.
- **Back prop on detail pages: visible mobile only.** The CSS for hiding the back button on tablet+ was set up in PR 2's `<AppHeader>` styling. PR 3 doesn't touch this — just confirms it works through this section.
- **Same Stripe portal endpoint.** `/api/stripe/portal` is unchanged. The Stripe customer portal redirect URL also stays the same (no need to update Stripe-side config).

## Code shape (load-bearing)

`app/(app)/settings/billing/page.tsx` (replacing placeholder):

```tsx
import { BillingClient } from '@/components/screens/billing-client'

// Admin gate already enforced by parent layout via role check
// (server-side gate in app/(app)/settings/billing/ — see PR 2)
export default function SettingsBillingPage() {
  return <BillingClient />
}
```

The single line change in `BillingClient`:

```tsx
// before:
<AppHeader title="Billing" back={{ href: '/today', label: 'My Jobs' }} ... />

// after:
<AppHeader title="Billing" back={{ href: '/settings', label: 'Settings' }} ... />
```

## Acceptance criteria

- [ ] Visiting `/settings/billing` (as Admin) shows the existing BillingClient UI — Module card with "Manage subscription" button
- [ ] Tapping "Manage subscription" still opens the Stripe customer portal (no regression)
- [ ] Back button (mobile) goes to `/settings`
- [ ] Old `/billing` URL still redirects to `/settings/billing` (PR 2's redirect is unchanged)
- [ ] Tech role: cannot reach `/settings/billing` (gate enforced by PR 2's layout)
- [ ] Stripe portal session works identically to before this PR (manage subscription, payment method, invoices)

## Validation checklist

**Mobile (375px):**
- [ ] BillingClient renders cleanly (it already does today — should keep working)
- [ ] Back button visible, tappable, returns to /settings list

**Tablet (768px) and desktop:**
- [ ] BillingClient appears in the right pane; list stays visible on left
- [ ] No back button visible at this width
- [ ] Switching to a different section in the list works (back to /settings/account placeholder, etc.)

**Behavioral:**
- [ ] As Admin, click "Manage subscription" → real Stripe portal opens (use a real session — DO NOT mock)
- [ ] Update a payment method or view invoices in the portal — round-trip works
- [ ] Old `/billing` URL → still 308 → `/settings/billing`
- [ ] Tech role: try `/settings/billing` directly — blocked

## Branch + commit guidance

- Stay on `settings-wip`
- One commit suggested — this is a small change. Title: `feat(settings): move billing section under /settings`
- DO NOT push to `main`. Brandon merges via GitHub UI.

## Risk notes

This PR is the LOWEST risk of the 6 — it's essentially a route move with one prop change. The biggest risk is forgetting to test the live Stripe portal flow (don't ship without verifying it actually opens).

If the Stripe portal stops working after this PR, the issue is almost certainly NOT in BillingClient itself (which is unchanged) — check the `/api/stripe/portal` endpoint and the Stripe configuration.
