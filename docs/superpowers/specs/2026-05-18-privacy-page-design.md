# Privacy page — design spec

**Status:** Ready for implementation review
**Branch:** `feat/privacy-page` (cut from `origin/main`; current worktree branch `worktree-feat-privacy-page` will be renamed before push)
**Date:** 2026-05-18
**Predecessor:** No legal pages exist on `origin/main`. The policy content was drafted in a prior session by auditing the production code (data flows, sub-processors, retention, auth). The drafted markdown sits **uncommitted** on the local filesystem at `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md`. The implementer reads it via that absolute path — no `git show`, no checkout needed.
**Contact email (rendered in the page):** `brandon@vyntechs.com`

---

## Goal

Ship a public `/privacy` page that displays the FTC-defensible Vyntechs privacy policy, links from the marketing footer, matches the existing marketing chrome, supports section deep-links, and meets baseline a11y. Standards driving placement: GDPR Article 12 ("easily accessible"), CCPA's footer-link convention, and the Stripe/Apple/Google requirements that the policy be a single linkable URL.

## Non-goals

- Terms of Service page (separate brainstorm + PR; user said "A first" — Privacy only).
- Sign-up form consent line ("By signing up you agree to…").
- Stripe checkout consent line.
- Account-settings menu link.
- Acceptable Use Policy.
- Cookie consent banner (no analytics-cookie or marketing-cookie disclosure required today; Vercel Analytics is first-party and consent-free under current Vercel policy).
- Adding OpenGraph / Twitter card metadata (broader marketing-SEO PR).
- Any DB schema changes, API routes, or migrations.

---

## Discovered scope additions

Two items the recon turned up that are required for `/privacy` to actually work as a public page. Both stay in this PR.

### 1. Middleware exempt list (CRITICAL — would block the whole feature without this)

`middleware.ts` on `origin/main` runs on every non-asset route. For paths not in `EXEMPT_EXACT` (defined in `lib/auth-access.ts:7-32`), unauthenticated users are redirected to `/sign-in?next=…`. Without an entry for `/privacy`, signed-out users hitting the privacy page would be bounced through sign-in — defeating GDPR Article 12 ("easily accessible") and breaking the standards-driven goal of this PR.

**Fix:** add `'/privacy'` to the `EXEMPT_EXACT` set in `lib/auth-access.ts`, alongside `/deactivated` and `/api/health` (same "publicly reachable, no auth required" bucket).

This also covers deactivated users: the exempt fast path at `middleware.ts:32` runs BEFORE the deactivation redirect, so a deactivated user can still read the policy. That's the correct behavior — privacy access is a user right, not a subscription perk.

### 2. Nav + Footer same-page anchors

`components/marketing/nav.tsx` and `components/marketing/footer.tsx` use **same-page hash anchors** (`#how`, `#product`, `#pricing`, `#compare`, `#faq`, `#why`, `#top`) for in-page section links. These work on the homepage but become silently broken on `/privacy` — clicks do nothing because those ids don't exist on the privacy page.

**Fix:** convert those anchors to **absolute-with-hash** (`/#how`, `/#product`, etc.). Brand `#top` becomes `/`. Homepage behavior is unchanged — browsers detect the same-path hash and scroll. From `/privacy`, the browser navigates to `/` and the fragment scrolls to the section. ≤ 8 edits across two files, no logic change.

---

## Architecture

### Route
New page at `app/privacy/page.tsx`. No `(legal)` route group yet — a single page doesn't earn the abstraction. When Terms ships in a future PR, evaluate whether shared layout justifies grouping.

### Rendering strategy
- Server component, inline TSX with semantic HTML. No markdown parser added — would be a new dependency for one page, violating Rule 2 (simplicity).
- `export const dynamic = 'force-dynamic'` to match the homepage pattern (`app/page.tsx:14`). Required because the page reads auth state at request time.
- The page is public — no `checkAccess` gate, no redirect. Privacy policy must be reachable signed-out.

### Auth-state handling
Mirrors the homepage: `getServerSupabase()` → `auth.getUser()` → `isSignedIn = !!user`, passed to `<Nav>` and `<Footer>` so the signed-in CTA renders correctly. **Error handling matches the homepage** — no try/catch is added. If Supabase auth is unreachable, the page fails to render the same way the homepage does today; introducing privacy-page-only error handling would diverge from the existing pattern without solving a Vyntechs-specific risk.

### Composition skeleton

```tsx
import { getServerSupabase } from '@/lib/supabase-server'
import { Nav } from '@/components/marketing/nav'
import { Footer } from '@/components/marketing/footer'
import '@/components/marketing/marketing.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Privacy Policy — Vyntechs',
  description:
    'How Vyntechs collects, uses, stores, and protects your data. Plain-English, code-backed, FTC-defensible.',
  alternates: { canonical: 'https://vyntechs.dev/privacy' },
  robots: { index: true, follow: true },
}

export default async function PrivacyPage() {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const isSignedIn = !!user

  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <article className="vm-legal">
        {/* header → TL;DR → 10 named sections */}
      </article>
      <Footer isSignedIn={isSignedIn} />
    </main>
  )
}
```

---

## Content source and translation

**Source of truth for content:** `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` on the local filesystem (also accessible via `git show docs/in-flight-snapshot-2026-05-18:PRIVACY.md`). The implementation reads it once, translates markdown to semantic JSX, and inlines the result into `page.tsx`. After the page is wired and verified, `PRIVACY.md` is deleted from the in-flight branch so there is exactly one source of truth.

**Translation rules:**
- `# Vyntechs Privacy Policy` → `<h1>` inside the `<article>` header.
- The `**Effective:**` / `**Contact:**` block → `<dl class="vm-legal-meta">` with `<dt>` / `<dd>` pairs. The email becomes a `<a href="mailto:brandon@vyntechs.com">`.
- The `> **TL;DR.** …` blockquote → `<blockquote class="vm-legal-tldr">` with `<strong>TL;DR.</strong>` inline at the front of the text.
- Each `## Heading` → `<section id="…"><h2>…</h2>…</section>`.
- `### Sub-heading` → `<h3>` inside the parent section.
- Markdown `- bullet` lists → `<ul>` / `<li>`.
- Bold (`**text**`) → `<strong>`.
- Italic (`*text*`) → `<em>`.
- Markdown links `[text](url)` → `<a href="url">text</a>` with no `target="_blank"` (screen-reader-friendly; user controls tab behavior).
- The "Who else sees your data" section's per-category sub-processor groups → semantic `<table class="vm-legal-table">` (one row per service; see §Sub-processor table).

### Section anchor ids (for deep-linking)

| Section title | Anchor id |
|---|---|
| TL;DR | `tldr` |
| Who this policy is for | `who-this-is-for` |
| What we collect | `what-we-collect` |
| Who else sees your data | `sub-processors` |
| How your diagnostic outcomes can help other shops | `shared-knowledge` |
| What we never do | `what-we-never-do` |
| How long we keep your data | `retention` |
| Your rights | `your-rights` |
| Security | `security` |
| Changes to this policy | `changes` |
| How you can verify this policy | `verify` |

Heading hierarchy is strict: h1 → h2 → h3 (no skipping levels).

---

## Sub-processor table

Renders the "Who else sees your data" content as a semantic `<table>` instead of a styled bullet list. Twelve total rows, grouped by category via `<tbody>`:

- **Hosting & data storage:** Vercel, Supabase
- **Payments:** Stripe
- **AI and reference data:** Anthropic, Voyage AI, Tavily, Brave Search, YouTube Data API, Reddit
- **Recall & safety data:** NHTSA, Ford, Chevrolet, Toyota, BMW
- **Backups:** GitHub

Three columns: **Service** (linked vendor name → vendor's privacy policy URL from `PRIVACY.md`), **What they see**, **Why**.

Includes a visually-hidden `<caption>` ("Sub-processors and what each receives") for screen readers.

**Mobile (<768 px):** the table becomes a stacked card layout via CSS — `thead` is hidden, each `<tr>` becomes `display: block` with `border` + `padding`, and each `<td>` carries its column label via a `data-label` attribute rendered as a pseudo-element. No horizontal scroll. (Standard responsive-table pattern, ~15 lines of CSS.)

---

## Theming

### Typography
- Body: Inter Tight, 16 px, line-height 1.65, color `var(--vt-bone-700)`.
- H1: serif (`var(--vt-font-serif)`), `clamp(28px, 4vw + 16px, 38px)`, line-height 1.2, color `var(--vt-bone-900)` — the same token `.vm-hero-title` uses at `components/marketing/marketing.css:117`.
- H2: serif, `clamp(22px, 2.4vw + 14px, 28px)`, top margin 40 px.
- H3: Inter Tight 600, 18 px, top margin 24 px.
- Article max-width: 720 px, centered.
- Padding: 16 px sides on mobile, 24 px sides ≥ 768 px, plus 48 px top / 80 px bottom.

### CSS strategy
All new rules added to `components/marketing/marketing.css`. Estimated scope: ~80 lines covering `.vm-legal`, `.vm-legal-head`, `.vm-legal-meta`, `.vm-legal-tldr`, `.vm-legal-table` (with the mobile responsive override), and `.vm-foot-legal`. Reuses existing color / font tokens; no new design tokens introduced.

### TL;DR blockquote
- ≥ 768 px: 4 px left accent border in `var(--vt-bone-700)` at 0.5 opacity, 24 px padding. The `<strong>TL;DR.</strong>` label leads the blockquote inline in body weight 700 (no italic).
- < 768 px: full width, 16 px padding, no left border (avoids horizontal shift on narrow screens).

---

## Footer integration

Edit to `components/marketing/footer.tsx` at the `vm-foot-bot` bottom bar — add one link between the copyright span and the tagline:

```tsx
<div className="vm-foot-bot">
  <span>© 2026 Vyntechs &middot; vyntechs.dev</span>
  <a href="/privacy" className="vm-foot-legal">Privacy</a>
  <span className="vm-foot-mark">Built in the bay, not the boardroom.</span>
  <span>Beta &middot; invite-only</span>
</div>
```

CSS:
```css
.vm-foot-bot .vm-foot-legal {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  opacity: 0.8;
  transition: opacity 120ms ease;
}
.vm-foot-bot .vm-foot-legal:hover,
.vm-foot-bot .vm-foot-legal:focus-visible {
  opacity: 1;
}
```

Mobile (<768 px) bottom bar already stacks vertically via existing `vm-foot-bot` styles; the link inherits this — no extra rules.

---

## Nav + Footer anchor refactor

**`components/marketing/nav.tsx`:**
- `#how` → `/#how`
- `#product` → `/#product`
- `#pricing` → `/#pricing`
- `#compare` → `/#compare`
- `#faq` → `/#faq`
- Brand link `#top` → `/`

**`components/marketing/footer.tsx`:**
- All section anchors converted the same way.
- Brand link `#top` → `/`.
- "About" column: `#why` → `/#why`.

Same-page behavior on the homepage is unchanged. No regressions expected.

---

## SEO + accessibility

**SEO** (set via Next 14 App Router `export const metadata`):
- `title`: "Privacy Policy — Vyntechs"
- `description`: as above
- `alternates.canonical`: `https://vyntechs.dev/privacy`
- `robots`: `index: true`, `follow: true` (discoverable)

**A11y:**
- Strict heading hierarchy (h1 → h2 → h3).
- Every `<h2>` has a unique `id` for deep-linking.
- Sub-processor table has a `<caption>` (visually hidden via `.sr-only` — to be added to `marketing.css` if not already present).
- All links have visible text (no icon-only).
- External vendor links open in the same tab (no `target="_blank"`); screen-reader users keep control.
- Color contrast: body ≥ 4.5:1, headings ≥ 3:1 (already met by existing tokens — to be verified on the preview).

---

## Files touched

**ADD:**
- `app/privacy/page.tsx`

**EDIT:**
- `lib/auth-access.ts` — add `'/privacy'` to the `EXEMPT_EXACT` set so middleware lets signed-out and deactivated users through.
- `components/marketing/footer.tsx` — add Privacy link to `vm-foot-bot`; convert section anchors to absolute-with-hash.
- `components/marketing/nav.tsx` — convert section anchors to absolute-with-hash.
- `components/marketing/marketing.css` — add `.vm-legal*` rules, mobile table override, `.vm-foot-legal` styles, and `.sr-only` if not present.

**DELETE (filesystem-only, no git change):**
- `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` — staging artifact, never committed to git. After the PR merges, `rm /Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` removes the staging file. Because it was never tracked, no commit is needed.

---

## Testing

No automated tests added in this PR. The page has no business logic — only static content and routing — and the existing codebase has no Playwright / E2E suite that would catch a visual or routing regression on a static page. Verification is manual on the Vercel preview per the §Verification section.

If a future PR adds Terms or other legal pages, a small Playwright test covering "footer link → page → all section anchors resolve" would be worth adding once.

---

## Branch + PR flow

1. Rename worktree branch: `git branch -m worktree-feat-privacy-page feat/privacy-page`.
2. Implement per §Files touched.
3. `git push origin feat/privacy-page` (first push opens a Vercel preview).
4. `gh pr create` with title `feat(marketing): add /privacy page + footer link` and body containing: spec link, sub-processor count, test plan checklist (§Verification items as checkboxes).
5. Brandon validates the preview URL. Brandon merges to `main`. Claude does not merge.

---

## Done criteria

- `/privacy` returns 200 at 375, 768, 1280, and 1440 px viewports (manual check on preview).
- No horizontal scroll at 375 px on any section, including the sub-processor table.
- All 12 sub-processor links resolve to the vendor's privacy policy URL (one click each).
- All section deep-links work (`/privacy#sub-processors`, `/privacy#retention`, etc.).
- Footer "Privacy" link is visible and clickable on the homepage.
- From `/privacy`, every Nav section link navigates to the homepage and lands at the correct section.
- TypeScript compiles cleanly (`pnpm tsc --noEmit`).
- ESLint passes (`pnpm lint`).
- No new `package.json` dependencies.
- (Optional, nice-to-have) Lighthouse a11y score ≥ 95 when run via Chrome DevTools → Lighthouse → Accessibility on the preview URL.
- `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` removed from the local filesystem after merge (one `rm` command; not gating this PR).

---

## Verification — Brandon's manual pass on the preview URL

1. **Open `/privacy` in a private/incognito window** (no auth) — page loads, NO redirect to `/sign-in`. (Catches the middleware fix.)
2. Open preview URL on mobile (iPhone or 375 px devtools).
3. Scroll the whole policy — no horizontal scroll, all sections readable, sub-processor cards stack cleanly.
4. Click 2–3 sub-processor links — each opens the vendor's privacy policy.
5. Append `#sub-processors` to the URL — page scrolls to that section.
6. From `/privacy`, click "Pricing" in the Nav — lands on the homepage at the pricing section.
7. From `/privacy`, click the footer "Privacy" link — same page (no-op is fine).
8. Verify Nav reflects signed-in state ("Go to app") when you're signed in.
9. Repeat on desktop (1280 or 1440 px).
10. Merge when satisfied. Claude does not merge.

---

## Future work (out of scope, future PRs)

- Terms of Service page (separate brainstorm session, separate PR).
- Sign-up form consent line ("By signing up you agree to our Privacy Policy").
- Account-settings menu link to `/privacy`.
- Cookie consent banner if/when EU/UK users are targeted.
- OpenGraph + Twitter card metadata across marketing pages (broader SEO PR).
- Static rendering for `/privacy` (currently `force-dynamic` because of auth state in chrome; could split chrome into a client island to enable static body).
