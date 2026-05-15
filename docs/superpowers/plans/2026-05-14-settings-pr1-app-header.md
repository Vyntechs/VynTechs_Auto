# PR 1: AppHeader — hamburger menu + shop name display

> **For agentic workers:** This is a SCOPE CONTRACT, not a typewriter script. The fresh session should do its own exploratory work in the codebase and pick the implementation approach that best fits existing patterns. Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to execute task-by-task.
>
> **Spec source:** `docs/superpowers/specs/2026-05-14-settings-page-design.md` (§2, §5)
>
> **Branch base:** `feat/header-polish` (NOT `main` — this work depends on the AppHeader that's only on `feat/header-polish`)
>
> **Branch:** `settings-wip` (this PR will be commits on `settings-wip`; Brandon merges into `settings-page` after validation)

**Goal:** Add a hamburger menu on the LEFT of the V° logo in the AppHeader (slide-down menu with My Jobs · Settings · Curator (Founder only) · Sign Out), and display the shop name somewhere in the header. This is the FIRST persistent navigation element in the app.

**Architecture:** New `<AppHeaderMenu>` client component owns the menu open/close state and the slide-down rendering. The existing `<AppHeader>` is modified to (a) render the menu trigger on the left and (b) accept a `shopName` prop. `requireUserAndProfile()` already returns the shop record, so the shop name is plumbed via the (app) layout into pages that already construct their AppHeader call. Founder check (`isFounder()`) runs server-side; the result is passed into the menu as a boolean prop.

**Tech stack:** Same as existing — React 19 / Next.js App Router, plain `.vt-*` global CSS classes from `components/vt/vt.css`, `--vt-*` tokens from `app/globals.css`, no Tailwind, no CSS modules.

---

## In scope

- New `<AppHeaderMenu>` client component (button + slide-down menu)
- AppHeader modification: hamburger trigger on left, shop name display
- Plumb shop name + isFounder boolean from server (the (app) layout) down to every page that renders AppHeader
- Menu items wired to: `/today` (My Jobs), `/settings` (will 404 until PR 2 — that's OK), `/curator` (Founder only), Sign Out (calls existing logic)
- Click-outside-to-close behavior
- Mobile-friendly tap targets (≥44px)

## Out of scope (do not touch)

- The `<SignOutButton>` on the right side STAYS where it is (familiar redundant access — Brandon explicitly asked for SignOut to remain on every authed page)
- Don't refactor any other AppHeader callers beyond passing `shopName` / `isFounder` props through
- Don't touch `/curator` pages, `/settings` page (doesn't exist yet — PR 2)
- Don't change auth/role logic
- Don't add any new design tokens — reuse `--vt-*` only

## Files to create

- `components/vt/app-header-menu.tsx` — the menu component (`'use client'`)

## Files to modify

- `components/vt/app-header.tsx` — add hamburger trigger on left, accept new props (`shopName: string | null`, `isFounder: boolean`), render `<AppHeaderMenu>`
- `app/(app)/layout.tsx` — fetch shopName + compute isFounder, pass to children OR (cleaner) wrap children in a context provider
- `components/vt/vt.css` — extend `.app-header` rules; add `.app-header__menu-trigger`, `.app-header__menu`, `.app-header__menu-item` styles using `--vt-*` tokens
- Every page that calls `<AppHeader>` — pass new props if AppHeader becomes prop-required (alternative: AppHeader reads from context/layout; check existing patterns to decide)

The cleanest pattern depends on how the codebase handles per-route data — explore first, then decide between prop-drilling vs. layout-context vs. server-component-wrapper.

## Key technical decisions

- **Menu pattern: slide-down, NOT slide-out drawer.** Slide-down is simpler — no overlay scrim, no body-scroll-lock, no animation library. The menu attaches below the header. Click-outside-to-close handled with a single `useEffect` listening on `document`.
- **Hamburger placement: LEFT of V° logo.** Put it before the brand mark. This is industry-standard for mobile-first apps.
- **Shop name placement: Claude Design's call.** Spec only requires "visible in AppHeader on every authed page." Pick a sensible default (e.g., a small line under or beside the V° wordmark on desktop, hidden on mobile if cramped) and flag it for Claude Design polish in handoff.
- **Founder check is server-side, not client-side.** `isFounder(user)` runs in the layout; the result is passed as a prop. Don't expose `FOUNDER_EMAIL` to the client.
- **No new icon library.** Use a plain SVG for the hamburger icon, inline in the component. Three lines, ~24×24, currentColor.

## Code shape (load-bearing)

The menu component's structure:

```tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { SignOutButton } from './sign-out-button'

export function AppHeaderMenu({ isFounder }: { isFounder: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={ref} className="app-header__menu-wrap">
      <button
        type="button"
        className="app-header__menu-trigger"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {/* inline SVG hamburger, 24×24, currentColor */}
      </button>
      {open && (
        <div className="app-header__menu" role="menu">
          <Link href="/today" role="menuitem" onClick={() => setOpen(false)}>My Jobs</Link>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}>Settings</Link>
          {isFounder && (
            <Link href="/curator" role="menuitem" onClick={() => setOpen(false)}>Curator</Link>
          )}
          <SignOutButton /* may need wrapper for closing the menu */ />
        </div>
      )}
    </div>
  )
}
```

CSS shape (slide-down anchored to header, full tokens):

```css
.app-header__menu-trigger {
  background: transparent;
  border: 0;
  padding: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--vt-fg);
  cursor: pointer;
  min-width: 44px;
  min-height: 44px;
}
.app-header__menu {
  position: absolute;
  top: 100%;
  left: 0;
  background: var(--vt-surface-2);
  border: 1px solid var(--vt-rule);
  border-radius: var(--vt-radius-md);
  box-shadow: var(--vt-shadow-sheet);
  min-width: 220px;
  padding: 6px 0;
  display: flex;
  flex-direction: column;
  z-index: 50;
}
.app-header__menu-item {
  padding: 12px 16px;
  min-height: 44px;
  /* etc — reuse existing menu-row patterns if any */
}
```

## Acceptance criteria

- [ ] Hamburger button visible on every authenticated page
- [ ] Tapping the button opens the menu; tapping outside closes it; tapping a menu item navigates AND closes
- [ ] Menu items: My Jobs, Settings, Curator (Founder only), Sign Out — in that order
- [ ] Sign Out from the menu calls the same handler as the existing right-side `<SignOutButton>`
- [ ] Existing right-side `<SignOutButton>` still appears on every authed page (NOT removed)
- [ ] Shop name visible somewhere in the header on every authed page
- [ ] Founder (Brandon, by `FOUNDER_EMAIL` env var) sees Curator menu item
- [ ] Non-Founder user (Mac, anyone else) does NOT see Curator menu item
- [ ] No regression in any existing AppHeader behavior (back button, title, meta, WhatsNewBadge)

## Validation checklist

**Mobile (375px wide, e.g., iPhone SE viewport):**
- [ ] Hamburger button is at least 44×44px tap target
- [ ] Hamburger doesn't overlap V° logo, page title, or right-side SignOut
- [ ] Menu opens cleanly, doesn't get cropped, fits within viewport
- [ ] Menu items are tappable (≥44px tall)
- [ ] Shop name doesn't push other elements off-screen
- [ ] Test at 414px (larger phone) too

**Tablet (768px portrait & 1024px landscape):**
- [ ] Same as mobile, plus shop name placement looks intentional
- [ ] Touch with gloved fingers feasible

**Desktop (>1024px):**
- [ ] Menu trigger looks right at desktop scale
- [ ] All elements aligned cleanly

**Behavioral:**
- [ ] Sign in as Founder (brandon@) — Curator item visible
- [ ] Sign in as non-Founder (a tech) — Curator item hidden
- [ ] Click outside menu while open — menu closes
- [ ] Click menu item — menu closes AND navigates
- [ ] Press Escape — menu closes (nice-to-have, not blocking)

## Branch + commit guidance

- Stay on `settings-wip`
- Suggested commit boundaries: (1) add `<AppHeaderMenu>` component + CSS, (2) modify `<AppHeader>` to render trigger + accept new props, (3) wire layout to plumb `shopName` + `isFounder`, (4) add shop name display
- DO NOT push to `main`. DO NOT merge `settings-wip` → `settings-page`. Brandon merges via GitHub UI after his own validation.
- Push the branch to origin so Brandon can validate via Vercel preview

## Visual handoff note

The visual treatment of (a) the hamburger icon, (b) the slide-down menu styling, and (c) the shop name placement in the header is Claude Design's call. This PR ships a functional baseline using existing `--vt-*` tokens and `.vt-*` patterns; Claude Design polishes after the functional baseline is validated. Per memory `feedback_claude_design_handoff`.
