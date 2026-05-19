# Privacy Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/privacy` as a public page themed to match the marketing chrome, linked from the marketing footer, accessible to signed-out and deactivated users, with deep-linkable sections — per spec at `docs/superpowers/specs/2026-05-18-privacy-page-design.md`.

**Architecture:** New server-component page at `app/privacy/page.tsx` reusing marketing `<Nav>` + `<Footer>`. Content inlined as semantic JSX, translated from `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` (uncommitted source file on local filesystem). Middleware allowlist (`lib/auth-access.ts`) updated so signed-out and deactivated users can reach the page. Marketing Nav and Footer anchors refactored from same-page (`#how`) to absolute-with-hash (`/#how`) so they navigate correctly from any page.

**Tech Stack:** Next.js 14 App Router (server components), TypeScript, vitest (one test for the middleware allowlist), Supabase auth (read-only for chrome rendering), existing marketing CSS tokens (`--vt-bone-*`, `--vt-font-serif`, `--font-inter-tight`).

---

### Task 1: Add /privacy to middleware paywall-exempt list (TDD)

**Why first:** Without this, the rest of the work is invisible — signed-out visitors and crawlers would bounce to `/sign-in` instead of seeing the policy.

**Files:**
- Modify: `tests/unit/auth-access.test.ts` — append one entry to the `'exempt — page routes'` it.each array
- Modify: `lib/auth-access.ts` — add one entry to the `EXEMPT_EXACT` set

- [ ] **Step 1: Add the failing test entry**

In `tests/unit/auth-access.test.ts`, in the `describe('exempt — page routes')` block, append `'/privacy',` after `'/reset-password',`. Final array:

```ts
    it.each([
      '/',
      '/sign-in',
      '/sign-up',
      '/subscribe',
      '/auth/callback',
      '/auth/confirm',
      '/checkout/success',
      '/billing',
      '/whats-new',
      '/reset-password',
      '/privacy',
    ])('exempts %s', (path) => {
      expect(isPaywallExempt(path)).toBe(true)
    })
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
pnpm test tests/unit/auth-access.test.ts
```

Expected output includes:
```
× isPaywallExempt > exempt — page routes > exempts /privacy
  AssertionError: expected false to be true
```

(All other tests pass — only the new `/privacy` case fails.)

- [ ] **Step 3: Add '/privacy' to EXEMPT_EXACT**

In `lib/auth-access.ts`, in the `EXEMPT_EXACT = new Set<string>([...])` literal, add `'/privacy',` after `'/deactivated',`. Final set entries near the bottom:

```ts
  '/forgot-password',
  '/deactivated',
  '/privacy',
  '/api/health',
])
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm test tests/unit/auth-access.test.ts
```

Expected: all tests pass, including `exempts /privacy`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/auth-access.test.ts lib/auth-access.ts
git commit -m "feat(auth): exempt /privacy from middleware paywall

Without this, signed-out visitors and crawlers hitting /privacy would
be bounced to /sign-in — breaking GDPR Article 12 ('easily accessible')
and search-engine indexing of the policy. /privacy joins /deactivated
and /api/health in the publicly-reachable bucket."
```

---

### Task 2: Append legal-article CSS to marketing.css

**Files:**
- Modify: `components/marketing/marketing.css` — append ~110 lines at end

- [ ] **Step 1: Append CSS block to the end of `components/marketing/marketing.css`**

```css

/* --- Legal page (/privacy, future /terms) --------------------------- */
.vm-legal {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 16px 80px;
  font-family: var(--font-inter-tight);
  font-size: 16px;
  line-height: 1.65;
  color: var(--vt-bone-700);
}
@media (min-width: 768px) {
  .vm-legal { padding: 64px 24px 96px; }
}

.vm-legal h1 {
  font-family: var(--vt-font-serif);
  font-size: clamp(28px, 4vw + 16px, 38px);
  line-height: 1.2;
  color: var(--vt-bone-900);
  margin: 0 0 16px;
}

.vm-legal h2 {
  font-family: var(--vt-font-serif);
  font-size: clamp(22px, 2.4vw + 14px, 28px);
  color: var(--vt-bone-900);
  margin: 40px 0 12px;
}

.vm-legal h3 {
  font-family: var(--font-inter-tight);
  font-weight: 600;
  font-size: 18px;
  color: var(--vt-bone-900);
  margin: 24px 0 8px;
}

.vm-legal p { margin: 0 0 16px; }
.vm-legal ul { margin: 0 0 16px; padding-left: 24px; }
.vm-legal li { margin: 0 0 6px; }
.vm-legal a { text-decoration: underline; text-underline-offset: 3px; color: inherit; }
.vm-legal a:hover { color: var(--vt-bone-900); }

.vm-legal-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 0 0 24px;
  color: var(--vt-bone-600);
}
.vm-legal-meta dt { font-weight: 600; }
.vm-legal-meta dd { margin: 0; }

.vm-legal-tldr {
  margin: 0 0 32px;
  padding: 16px;
  background: transparent;
  border: none;
  font-size: 16px;
}
@media (min-width: 768px) {
  .vm-legal-tldr {
    padding: 12px 24px;
    border-left: 4px solid color-mix(in oklch, var(--vt-bone-700) 50%, transparent);
  }
}
.vm-legal-tldr strong { font-weight: 700; }

.vm-legal-table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0 24px;
  font-size: 15px;
}
.vm-legal-table caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
}
.vm-legal-table th,
.vm-legal-table td {
  text-align: left;
  vertical-align: top;
  padding: 12px;
  border-bottom: 1px solid var(--vt-bone-200);
}
.vm-legal-table th {
  font-weight: 600;
  color: var(--vt-bone-900);
  background: var(--vt-bone-100);
}
.vm-legal-table .vm-legal-group td {
  font-weight: 600;
  color: var(--vt-bone-900);
  background: color-mix(in oklch, var(--vt-bone-100) 60%, transparent);
  padding-top: 20px;
}
@media (max-width: 767px) {
  .vm-legal-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
  }
  .vm-legal-table tr {
    display: block;
    border: 1px solid var(--vt-bone-200);
    border-radius: 6px;
    padding: 12px;
    margin: 0 0 12px;
  }
  .vm-legal-table .vm-legal-group {
    border: none;
    padding: 16px 0 4px;
    background: transparent;
    margin: 0;
  }
  .vm-legal-table .vm-legal-group td {
    padding: 0;
    background: transparent;
  }
  .vm-legal-table tbody:first-child .vm-legal-group {
    padding-top: 0;
  }
  .vm-legal-table td {
    display: block;
    border: none;
    padding: 4px 0;
  }
  .vm-legal-table td::before {
    content: attr(data-label);
    display: block;
    font-weight: 600;
    color: var(--vt-bone-900);
    font-size: 13px;
    margin: 6px 0 2px;
  }
  .vm-legal-table td:first-child::before {
    margin-top: 0;
  }
}

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

- [ ] **Step 2: TypeScript check (confirms no JSX regression)**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/marketing.css
git commit -m "feat(marketing): css for /privacy article + footer legal link"
```

---

### Task 3: Convert Nav anchors to absolute-with-hash

**Files:**
- Modify: `components/marketing/nav.tsx` — 6 anchor `href` edits

- [ ] **Step 1: Apply anchor edits**

In `components/marketing/nav.tsx`:

| Old | New |
|---|---|
| `<a href="#top"` (brand link) | `<a href="/"` |
| `<a href="#how">` | `<a href="/#how">` |
| `<a href="#product">` | `<a href="/#product">` |
| `<a href="#pricing">` | `<a href="/#pricing">` |
| `<a href="#compare">` | `<a href="/#compare">` |
| `<a href="#faq">` | `<a href="/#faq">` |

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/nav.tsx
git commit -m "refactor(marketing): nav anchors absolute-with-hash

Clicking 'Pricing' from /privacy now navigates to /#pricing instead of
doing nothing. Homepage behavior unchanged — same-path hash still
scrolls in-place."
```

---

### Task 4: Footer — add Privacy link + convert anchors

**Files:**
- Modify: `components/marketing/footer.tsx` — 1 link addition + 7 anchor `href` edits

- [ ] **Step 1: Anchor edits**

In `components/marketing/footer.tsx`:

| Old | New |
|---|---|
| `<a href="#top"` (brand link) | `<a href="/"` |
| `<a href="#how">` | `<a href="/#how">` |
| `<a href="#product">` | `<a href="/#product">` |
| `<a href="#pricing">` | `<a href="/#pricing">` |
| `<a href="#compare">` | `<a href="/#compare">` |
| `<a href="#faq">` | `<a href="/#faq">` |
| `<a href="#why">` (About column) | `<a href="/#why">` |

- [ ] **Step 2: Add Privacy link to `vm-foot-bot`**

Replace the `vm-foot-bot` block:

```tsx
<div className="vm-foot-bot">
  <span>© 2026 Vyntechs &middot; vyntechs.dev</span>
  <span className="vm-foot-mark">Built in the bay, not the boardroom.</span>
  <span>Beta &middot; invite-only</span>
</div>
```

with:

```tsx
<div className="vm-foot-bot">
  <span>© 2026 Vyntechs &middot; vyntechs.dev</span>
  <a href="/privacy" className="vm-foot-legal">Privacy</a>
  <span className="vm-foot-mark">Built in the bay, not the boardroom.</span>
  <span>Beta &middot; invite-only</span>
</div>
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add components/marketing/footer.tsx
git commit -m "feat(marketing): footer Privacy link + absolute-with-hash anchors"
```

---

### Task 5: Create app/privacy/page.tsx

**Files:**
- Create: `app/privacy/page.tsx`

**Note:** The full file is ~280 lines because policy content is inlined as JSX. Content is derived from `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` (read absolute path; file is uncommitted on local filesystem). Translation rules in spec §"Content source and translation".

- [ ] **Step 1: Confirm PRIVACY.md is readable**

```bash
test -f /Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md && echo "ok" || echo "missing"
```

Expected: `ok`. (If `missing`, escalate — implementer needs to re-source the content before proceeding.)

- [ ] **Step 2: Write `app/privacy/page.tsx`**

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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isSignedIn = !!user

  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <article className="vm-legal">
        <h1>Vyntechs Privacy Policy</h1>
        <dl className="vm-legal-meta">
          <dt>Effective</dt>
          <dd>May 18, 2026</dd>
          <dt>Contact</dt>
          <dd>
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>
          </dd>
        </dl>

        <blockquote className="vm-legal-tldr" id="tldr">
          <strong>TL;DR.</strong> We collect what you type and upload to run the
          diagnostic tool. We share narrow slices of it with named third parties
          so we can host the app, process payments, and generate AI suggestions.
          We never sell your data, never send your name or email to the AI, and
          never store payment cards. We keep your data until you ask us to
          delete it; backups age out within 90 days.
        </blockquote>

        <section id="who-this-is-for">
          <h2>Who this policy is for</h2>
          <p>
            Vyntechs is a diagnostic tool for automotive shops. This policy is
            written for the people who sign in and use Vyntechs directly: shop
            owners, techs, and other team members.
          </p>
          <p>
            If your shop enters its own customers&apos; information into
            Vyntechs, your shop is responsible for the consent under its own
            customer agreements. This policy explains how we handle that
            customer information on your shop&apos;s behalf.
          </p>
          <p>
            You can email{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a> about
            anything below.
          </p>
        </section>

        <section id="what-we-collect">
          <h2>What we collect</h2>

          <h3>When you sign up or are invited to a shop</h3>
          <ul>
            <li>
              Your <strong>email address</strong> (you need it to sign in)
            </li>
            <li>
              Your <strong>name</strong> (you type it in)
            </li>
            <li>
              Your <strong>role</strong> in your shop (tech, advisor, owner,
              etc.)
            </li>
            <li>
              Your <strong>shop&apos;s name</strong> (your shop&apos;s owner sets
              this once)
            </li>
          </ul>

          <h3>When you use the diagnostic tool</h3>
          <ul>
            <li>
              <strong>Vehicle details</strong> — year, make, model, engine, VIN,
              mileage, license plate
            </li>
            <li>
              <strong>Diagnostic content</strong> — the customer&apos;s
              complaint, your observations, the steps you tried, root cause,
              repair notes
            </li>
            <li>
              <strong>Files you upload</strong> — photos, videos, audio
              recordings, scan-tool screenshots, wiring diagrams
            </li>
            <li>
              <strong>Ambient conditions</strong> if you choose to log them —
              temperature, humidity, optional location
            </li>
          </ul>

          <h3>When your shop enters customer information</h3>
          <ul>
            <li>
              <strong>Customer name, phone number, and (optionally) email</strong>{' '}
              — stored on behalf of your shop so techs can reference customer
              history
            </li>
          </ul>

          <h3>Automatically while you use the app</h3>
          <ul>
            <li>
              <strong>Timestamps</strong> for every action
            </li>
            <li>
              <strong>Page views and basic interaction events</strong>, via
              Vercel Analytics
            </li>
            <li>
              <strong>Which &quot;What&apos;s New&quot; entries you&apos;ve seen</strong>{' '}
              (one date per user)
            </li>
          </ul>

          <h3>What we do NOT collect</h3>
          <ul>
            <li>
              We do not log your <strong>IP address</strong> or browser
              fingerprint in our application code
            </li>
            <li>
              We do not collect any data about <strong>children</strong> —
              Vyntechs is a tool for working shop staff and is not directed at
              minors
            </li>
            <li>
              We do not store <strong>payment card details</strong> ourselves —
              Stripe handles all of that
            </li>
          </ul>
        </section>

        <section id="sub-processors">
          <h2>Who else sees your data</h2>
          <p>
            To run Vyntechs we share narrow slices of your data with the
            third-party services below. Each link goes to the vendor&apos;s own
            privacy policy.
          </p>

          <table className="vm-legal-table">
            <caption>Sub-processors and what each receives</caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">What this service does and what it sees</th>
              </tr>
            </thead>
            <tbody>
              <tr className="vm-legal-group">
                <td colSpan={2}>Hosting and data storage</td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://vercel.com/legal/privacy-policy">Vercel</a>
                </td>
                <td data-label="What it sees">
                  Hosts the app, runs scheduled background jobs, captures basic
                  page-view analytics.
                </td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://supabase.com/privacy">Supabase</a>
                </td>
                <td data-label="What it sees">
                  Runs the database, handles sign-in (including magic-link
                  emails), stores the files you upload.
                </td>
              </tr>

              <tr className="vm-legal-group">
                <td colSpan={2}>Payments</td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://stripe.com/privacy">Stripe</a>
                </td>
                <td data-label="What it sees">
                  Sees your email, your shop&apos;s identifier, and your
                  subscription status; holds payment cards (we never see them).
                </td>
              </tr>

              <tr className="vm-legal-group">
                <td colSpan={2}>AI and reference data</td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://www.anthropic.com/legal/privacy">
                    Anthropic (Claude)
                  </a>
                </td>
                <td data-label="What it sees">
                  Receives vehicle data, customer complaint text, your
                  observations, and uploaded file contents to generate
                  diagnostic suggestions. <strong>Never receives your name or email.</strong>{' '}
                  Anthropic does not train its models on the data we send
                  through its API.
                </td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://www.voyageai.com/privacy/">Voyage AI</a>
                </td>
                <td data-label="What it sees">
                  Converts text into numerical vectors for similarity matching.
                </td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://tavily.com/privacy">Tavily</a>,{' '}
                  <a href="https://search.brave.com/help/privacy-policy">
                    Brave Search
                  </a>
                  ,{' '}
                  <a href="https://policies.google.com/privacy">
                    YouTube Data API
                  </a>{' '}
                  (Google),{' '}
                  <a href="https://www.reddit.com/policies/privacy-policy">
                    Reddit
                  </a>
                </td>
                <td data-label="What it sees">
                  Receive a search query made up of the vehicle&apos;s
                  year/make/model and the complaint text, to fetch outside
                  repair information.
                </td>
              </tr>

              <tr className="vm-legal-group">
                <td colSpan={2}>Recall and safety data</td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://www.nhtsa.gov/privacy-policy">NHTSA</a> and
                  manufacturer recall pages for{' '}
                  <a href="https://www.ford.com/help/privacy/">Ford</a>,{' '}
                  <a href="https://www.chevrolet.com/privacy-statement">
                    Chevrolet
                  </a>
                  ,{' '}
                  <a href="https://www.toyota.com/support/privacy-rights">
                    Toyota
                  </a>
                  , and{' '}
                  <a href="https://www.bmwusa.com/standalone/privacy-policy.html">
                    BMW
                  </a>
                </td>
                <td data-label="What it sees">
                  Receive only the vehicle year/make/model when we look up
                  recalls.
                </td>
              </tr>

              <tr className="vm-legal-group">
                <td colSpan={2}>Backups</td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">
                    GitHub
                  </a>
                </td>
                <td data-label="What it sees">
                  Receives an encrypted-in-transit daily snapshot of our
                  database. Snapshots older than 90 days are deleted
                  automatically.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section id="shared-knowledge">
          <h2>How your diagnostic outcomes can help other shops</h2>
          <p>
            When you close a diagnostic session, an{' '}
            <strong>anonymized summary</strong> of the outcome — root cause +
            vehicle year/make/model/engine + symptoms + diagnostic trouble codes
            — may be added to a shared knowledge base. Other shops&apos; AI may
            use this summary to suggest similar fixes for similar vehicles.
          </p>
          <p>We never share back to other shops:</p>
          <ul>
            <li>
              Your <strong>name or email</strong>
            </li>
            <li>
              Your <strong>shop&apos;s name</strong> or identity
            </li>
            <li>
              <strong>Customer</strong> name, phone, email, or other customer
              details
            </li>
            <li>
              The <strong>original free-text complaint</strong> (it&apos;s used
              internally to match similar cases but is not displayed back to
              other shops)
            </li>
          </ul>
        </section>

        <section id="what-we-never-do">
          <h2>What we never do</h2>
          <ul>
            <li>
              We never <strong>sell</strong> your data
            </li>
            <li>
              We never share your data for{' '}
              <strong>marketing or advertising</strong>, ours or anyone
              else&apos;s
            </li>
            <li>
              We never send your <strong>name or email</strong> to the AI
            </li>
            <li>
              We never store <strong>payment card details</strong> ourselves
            </li>
            <li>
              We never use your data to <strong>train our own AI models</strong>
              , and our AI provider (Anthropic) is contractually prohibited from
              training on the data we send through its API
            </li>
          </ul>
        </section>

        <section id="retention">
          <h2>How long we keep your data</h2>
          <p>
            We keep your account and its data for as long as your account is
            active. We do not yet run automatic deletion of old diagnostic
            sessions or uploaded files.
          </p>
          <p>
            When you (or your shop&apos;s owner) ask us to delete an account,
            we delete it within <strong>30 days</strong>. Our database backups
            roll forward every 90 days, so deleted data fully ages out of
            backups within 90 days of deletion.
          </p>
          <p>We want you to know up front:</p>
          <ul>
            <li>
              <strong>
                Deactivated team members&apos; past diagnostic sessions remain
                visible to the shop
              </strong>{' '}
              as part of the shop&apos;s repair record. If you want yours fully
              removed, contact us.
            </li>
            <li>
              <strong>Vercel runtime logs</strong> are retained by Vercel for
              roughly 24 hours and may contain request metadata.
            </li>
            <li>
              <strong>Vehicle and customer records</strong> entered by your shop
              persist until your shop deletes them.
            </li>
          </ul>
        </section>

        <section id="your-rights">
          <h2>Your rights</h2>
          <p>You can ask us to:</p>
          <ul>
            <li>
              <strong>Send you a copy</strong> of all the data we hold on you
            </li>
            <li>
              <strong>Correct anything</strong> that is wrong
            </li>
            <li>
              <strong>Delete your account</strong> and the personal data tied to
              it
            </li>
          </ul>
          <p>
            Email{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a> from
            the address on your account. We will respond within{' '}
            <strong>30 days</strong> and complete deletions within{' '}
            <strong>30 days</strong> of confirming the request.
          </p>
        </section>

        <section id="security">
          <h2>Security</h2>
          <p>
            Your data travels over <strong>encrypted connections (TLS)</strong>{' '}
            between your browser and our servers, and between our servers and
            the third parties listed above. It&apos;s stored in Supabase&apos;s
            encrypted database. Only you, your shop&apos;s team, and the
            Vyntechs team can read your data inside the app. Our sub-processors
            see only the slices of data we send them as described above.
          </p>
          <p>
            We are a small team and we don&apos;t issue formal security
            certifications today. If your shop needs one, email us.
          </p>
        </section>

        <section id="changes">
          <h2>Changes to this policy</h2>
          <p>
            When we change this policy, we publish a new version with a new
            effective date on this page. We also show a notice in the app the
            first time you sign in after the change.
          </p>
        </section>

        <section id="verify">
          <h2>How you can verify this policy</h2>
          <p>
            Every claim in this policy can be checked against our source code.
            If you ever find a place where our code does something this policy
            doesn&apos;t describe, or describes something the code doesn&apos;t
            actually do, email{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a> and
            we&apos;ll fix the gap.
          </p>
        </section>
      </article>
      <Footer isSignedIn={isSignedIn} />
    </main>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Expected: passes (or only pre-existing warnings; no new ones from this file).

- [ ] **Step 5: Commit**

```bash
git add app/privacy/page.tsx
git commit -m "feat(marketing): /privacy page with code-backed policy content

Renders the FTC-defensible Vyntechs privacy policy as a public page
themed with the marketing chrome. All 11 sections deep-linkable; the
sub-processor block uses a responsive semantic table that stacks as
cards on mobile."
```

---

### Task 6: Rename branch to feat/privacy-page and push

**Files:**
- Git: rename branch, push with upstream tracking

- [ ] **Step 1: Rename worktree-feat-privacy-page → feat/privacy-page**

```bash
git branch -m worktree-feat-privacy-page feat/privacy-page
git rev-parse --abbrev-ref HEAD
```

Expected output: `feat/privacy-page`.

- [ ] **Step 2: Sanity-check commit history vs origin/main**

```bash
git log --oneline origin/main..HEAD
```

Expected: 6 commits — the spec commit + 5 implementation commits (Tasks 1–5), in this order:

```
<sha> feat(marketing): /privacy page with code-backed policy content
<sha> feat(marketing): footer Privacy link + absolute-with-hash anchors
<sha> refactor(marketing): nav anchors absolute-with-hash
<sha> feat(marketing): css for /privacy article + footer legal link
<sha> feat(auth): exempt /privacy from middleware paywall
<sha> docs(spec): privacy page design (2026-05-18)
```

- [ ] **Step 3: Push with upstream tracking**

```bash
git push -u origin feat/privacy-page
```

Expected: branch pushed; Vercel webhook starts a preview deployment.

---

### Task 7: Open PR with test plan and surface the preview URL

- [ ] **Step 1: Open the PR**

```bash
gh pr create --title "feat(marketing): add /privacy page + footer link" --body "$(cat <<'EOF'
## Summary

- Adds `/privacy` as a public page with the full FTC-defensible Vyntechs privacy policy (11 deep-linkable sections, responsive sub-processor table for 12 vendors)
- Adds **Privacy** link to the marketing footer bottom bar
- Adds `/privacy` to `EXEMPT_EXACT` so middleware lets signed-out + deactivated users through (covered by a new test in `tests/unit/auth-access.test.ts`)
- Converts Nav + Footer same-page hash anchors (`#how`, `#pricing`, etc.) to absolute-with-hash (`/#how`, `/#pricing`) so they navigate correctly from any page

Design spec: `docs/superpowers/specs/2026-05-18-privacy-page-design.md`.
Implementation plan: `docs/superpowers/plans/2026-05-18-privacy-page.md`.

## Test plan

- [ ] Open `/privacy` in a private/incognito window — page loads, NO redirect to `/sign-in`
- [ ] Scroll the whole policy on mobile (375 px) — no horizontal scroll, sub-processor table stacks as cards
- [ ] Click 2–3 sub-processor links — each opens the vendor's privacy policy
- [ ] Append `#sub-processors` to the URL — page scrolls to that section
- [ ] From `/privacy`, click "Pricing" in the Nav — lands at homepage pricing section
- [ ] Verify Nav reflects signed-in state ("Go to app") when signed in
- [ ] Repeat on desktop (1280 or 1440 px)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Vercel preview URL is auto-posted by the Vercel bot as the first PR comment, usually within 30–60 seconds.

- [ ] **Step 2: Fetch preview URL once Vercel has posted**

```bash
sleep 30
gh pr view --json comments --jq '.comments[] | select(.author.login | test("vercel"; "i")) | .body' | grep -oE 'https://[a-z0-9-]+\.vercel\.app[^ )]*' | head -1
```

If empty, Vercel hasn't posted yet — wait another 30s and retry. Cap at 3 retries.

- [ ] **Step 3: Surface the PR + preview URL to Brandon**

Print the PR URL and the Vercel preview URL to the chat so Brandon can validate per the PR's test plan. Do **not** merge — Brandon merges to `main` manually after his validation pass.

---

## Done (full plan)

Implementation is complete when:
- All 7 tasks above are checked off
- PR is open with a working Vercel preview URL
- Brandon has the preview URL for his manual verification pass
- `PRIVACY.md` at `/Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md` is removed from the filesystem (run `rm /Volumes/Creativity/dev/projects/vyntechs/PRIVACY.md`) **after** the PR is merged — this is a cleanup-only step, not gating the PR
