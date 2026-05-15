# PR 2: /settings skeleton — list page + responsive layout + redirects + placeholders

> **For agentic workers:** SCOPE CONTRACT, not a typewriter script. Fresh session does its own exploratory work first.
>
> **Spec source:** `docs/superpowers/specs/2026-05-14-settings-page-design.md` (§4)
>
> **Branch base:** `settings-wip` (with PR 1's commits applied)
>
> **Depends on PR 1** being merged into `settings-page` first (the hamburger menu links to `/settings` — without PR 2 this is a 404; without PR 1 there's no entry point to test PR 2)

**Goal:** Build the empty Settings shell — the list page at `/settings`, the responsive list-detail layout, four placeholder section pages, and the 308 redirect from old `/billing` → `/settings/billing`. After this PR, you can reach `/settings`, see the four sections, click into any of them, and see a "Coming soon" placeholder. No section content yet — that's PRs 3-6.

**Architecture:** Next.js App Router with nested layouts. `app/(app)/settings/layout.tsx` owns the responsive grid (one media query at 768px); on mobile the layout becomes a single column showing either list OR detail (depends on which route is active); on tablet/desktop both are shown side-by-side. The list (`page.tsx`) is a server component that role-gates which rows render. Each section page is a placeholder server component for now.

**Tech stack:** Same as existing — React 19 / Next.js App Router, server components by default, plain `.vt-*` global CSS, `--vt-*` tokens.

---

## In scope

- `/settings` route with a list of 4 section rows (My Account, Shop, Team, Billing)
- Responsive grid layout: stacked on mobile, side-by-side on tablet/desktop (≥768px)
- 4 placeholder section detail pages (each renders "Coming soon — PR N"):
  - `/settings/account` (visible to all)
  - `/settings/shop` (Admin gate)
  - `/settings/team` (Admin gate)
  - `/settings/billing` (Admin gate)
- 308 redirect: `/billing` → `/settings/billing` via `next.config.js`
- Delete the old `app/(app)/billing/page.tsx` file (the redirect handles it; the new placeholder is the destination)
- Role-gated list visibility: Tech sees only "My Account" row; Admin sees all 4
- Detail-page back button (visible mobile only, hidden ≥768px since list is always visible at that width)

## Out of scope (do not touch)

- Don't implement any actual section content (all 4 pages are placeholders in this PR)
- Don't add any new API endpoints
- Don't touch the AppHeader or hamburger menu (they're PR 1, already merged)
- Don't move BillingClient yet — that's PR 3

## Files to create

- `app/(app)/settings/layout.tsx` — auth-gated layout with responsive grid
- `app/(app)/settings/page.tsx` — the list (server component, role-gated rows)
- `app/(app)/settings/account/page.tsx` — placeholder
- `app/(app)/settings/shop/page.tsx` — placeholder + Admin gate
- `app/(app)/settings/team/page.tsx` — placeholder + Admin gate
- `app/(app)/settings/billing/page.tsx` — placeholder + Admin gate
- `components/vt/settings-list.tsx` — the list-row component (extracted for reuse + testability)
- (CSS additions to `components/vt/vt.css` for `.vt-settings-grid`, `.vt-settings-list`, `.vt-settings-list-row`, etc.)

## Files to modify

- `next.config.js` — add `redirects()` returning `[{ source: '/billing', destination: '/settings/billing', permanent: true }]`

## Files to delete

- `app/(app)/billing/page.tsx` — replaced by the redirect + new `/settings/billing` placeholder

## Key technical decisions

- **List-detail with nested routes (not show/hide JS state).** On mobile, `/settings` and `/settings/<section>` are literally separate pages — Next.js native routing. No client-state machine to maintain. On tablet+, both render together because the layout grid keeps the list visible.
- **One media query, no JavaScript responsive logic.** `@media (min-width: 768px) { .vt-settings-grid { grid-template-columns: 220px 1fr } }` is the entire responsive logic. Don't introduce a window-size hook or JS detection.
- **Role gate at the list page AND each detail page.** Belt-and-suspenders: even though Tech wouldn't see the row in the list, they could type `/settings/team` directly — gate the detail pages too.
- **Back button on detail pages: visible mobile only.** Use `display: none` at `min-width: 768px`. Don't conditionally render — just CSS-hide. The list is always rendered at desktop widths thanks to the layout, so back has no purpose there.
- **Placeholder content is intentionally crap.** A `<Module>` saying "Coming soon — Section name lands in PR N." This makes it obvious to a validator which sections aren't done yet.
- **List rows are server components, not client components.** No interactivity beyond the `<Link>` element.

## Code shape (load-bearing)

The responsive grid CSS:

```css
.vt-settings-grid {
  display: flex;
  flex-direction: column;
  flex: 1;
}
@media (min-width: 768px) {
  .vt-settings-grid {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 0;
  }
}
.vt-settings-list {
  /* on mobile: full-width vertical list */
  /* on desktop: persistent left rail */
  border-right: 1px solid var(--vt-rule); /* desktop divider */
}
@media (max-width: 767px) {
  .vt-settings-list { border-right: 0; }
  /* on mobile, when a detail is shown, hide the list (or vice versa) — see below */
}
.vt-settings-list-row {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  min-height: 56px;
  border-bottom: 1px solid var(--vt-rule);
  color: var(--vt-fg);
  text-decoration: none;
}
.vt-settings-list-row:hover { background: var(--vt-surface-3); }
.vt-settings-list-row__chevron { margin-left: auto; opacity: 0.5; }
```

The mobile show/hide pattern (clean version with route-based conditional rendering in layout):

```tsx
// app/(app)/settings/layout.tsx
import { headers } from 'next/headers'
import Link from 'next/link'
import { SettingsList } from '@/components/vt/settings-list'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // Auth + role check via existing requireUserAndProfile pattern
  // Determine current pathname (from headers or another mechanism) to know if we're on the list or a detail
  // On mobile, render list OR children (not both) based on pathname
  // On desktop (>=768px), the layout's CSS grid renders both naturally

  return (
    <div className="vt-settings-grid">
      <aside className="vt-settings-list">
        <SettingsList /* role-gated rows */ />
      </aside>
      <main className="vt-settings-detail">{children}</main>
    </div>
  )
}
```

> **Note for fresh session:** the "show list OR detail on mobile" decision can be done two ways: (a) CSS-only by hiding the list when a detail route is active (fragile), or (b) reading the pathname server-side and conditionally rendering. (b) is cleaner. Pick the one that fits Next.js App Router best — explore `usePathname` (client) and `headers()` (server) options.

The list-row component:

```tsx
// components/vt/settings-list.tsx
import Link from 'next/link'

const SECTIONS = [
  { href: '/settings/account', label: 'My Account', desc: 'Edit your name and password', adminOnly: false },
  { href: '/settings/shop', label: 'Shop', desc: 'Rename your shop', adminOnly: true },
  { href: '/settings/team', label: 'Team', desc: 'Invite people, manage roles', adminOnly: true },
  { href: '/settings/billing', label: 'Billing', desc: 'Manage subscription', adminOnly: true },
] as const

export function SettingsList({ isAdmin }: { isAdmin: boolean }) {
  const visible = SECTIONS.filter(s => !s.adminOnly || isAdmin)
  return (
    <nav>
      {visible.map(s => (
        <Link key={s.href} href={s.href} className="vt-settings-list-row">
          <div>
            <div className="vt-settings-list-row__label">{s.label}</div>
            <div className="vt-settings-list-row__desc">{s.desc}</div>
          </div>
          <span className="vt-settings-list-row__chevron" aria-hidden>›</span>
        </Link>
      ))}
    </nav>
  )
}
```

The redirect in `next.config.js`:

```js
async redirects() {
  return [
    { source: '/billing', destination: '/settings/billing', permanent: true },
  ]
}
```

## Acceptance criteria

- [ ] `/settings` renders a list of 4 sections for an Admin
- [ ] `/settings` renders a list of 1 section (My Account only) for a Tech
- [ ] Each section row is a `<Link>` to its detail route
- [ ] On mobile (<768px): clicking a row navigates to the section page; back button visible at top
- [ ] On tablet/desktop (≥768px): list stays on left; clicking a row updates only the right pane
- [ ] Each placeholder detail page renders a Module saying "Coming soon — PR N"
- [ ] Direct navigation to `/settings/team` as a Tech is BLOCKED (server-side role gate)
- [ ] Direct navigation to `/settings/account` as any role works
- [ ] Old `/billing` URL redirects to `/settings/billing` with HTTP 308
- [ ] No regression in any other route

## Validation checklist

**Mobile (375px and 414px):**
- [ ] List rows full-width, ≥56px tall, chevron visible
- [ ] No horizontal scroll
- [ ] Tapping a row navigates to detail
- [ ] Back button visible on detail; tapping returns to list
- [ ] List does NOT show on detail page (mobile only — would be cramped)

**Tablet portrait (768px):**
- [ ] Split-pane layout active: list on left (220px), detail on right
- [ ] Back button HIDDEN on detail (list is right there)
- [ ] Clicking a different list item updates only the right pane (list does not unmount)

**Tablet landscape (1024px) & desktop (>1024px):**
- [ ] Same as 768px, scaled cleanly

**Behavioral:**
- [ ] Sign in as Tech: only "My Account" appears in list
- [ ] Sign in as Admin: all 4 sections appear
- [ ] Old `/billing` URL → 308 → `/settings/billing` placeholder
- [ ] Direct URL: `/settings/team` as Tech → blocked (redirect to /today or 403, decide)
- [ ] Direct URL: `/settings/billing` as Admin → placeholder visible

## Branch + commit guidance

- Stay on `settings-wip` (PR 1's commits already there)
- Suggested commit boundaries: (1) layout + grid CSS + list component, (2) list page + placeholder section pages, (3) redirect + delete old `/billing` page, (4) role gating on detail pages
- DO NOT push to `main`. Brandon merges via GitHub UI.

## Visual handoff note

The list-row visual treatment, chevron icon, "Coming soon" placeholder card design, and any animation between list/detail on mobile are all Claude Design's polish. This PR ships functional baseline only.
