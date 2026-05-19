# Terms of Service page — design spec

**Status:** Ready for implementation review
**Branch:** `feat/terms-page` (cut from `origin/main` at `da74c98`; current worktree branch `worktree-feat-terms-page` will be renamed before push)
**Date:** 2026-05-19
**Predecessor:** `/privacy` shipped 2026-05-19 via PR #77 (merged at `da74c98`). ToS follows the same delivery pattern: public page, marketing-themed chrome, footer Legal column for discovery, deep-linkable sections, middleware allowlist entry.
**Entity & jurisdiction:** Vyntechs is a DBA (sole proprietorship) of Brandon Nichols filed in Texas. Governing law: Texas. Venue: state and federal courts in **Johnson County, Texas**.
**Source of legal substance:** Sonnet research subagent's 10-section brief (2026-05-19) mapping Tekmetric, Shopmonkey, ALLDATA, AutoLeap, Mitchell 1 ToS patterns; medical-AI disclaimer parallels (UpToDate, Watson Health); customer-of-customer data pattern from Shopmonkey's DPA; founder-gap analysis.

---

## Goal

Ship a public `/terms` page displaying the Vyntechs Terms of Service. Written in plain shop-floor English with the Vyntechs voice. Contains every legally meaningful clause a sole-proprietor B2B SaaS needs to protect against its specific exposures: AI-output misuse, vehicle damage claims, customer-of-customer data, payment disputes, IP claims, class-action exposure.

The reader test: a shop owner, a competitor's lawyer, or a journalist reading it should think "they wrote this themselves, they know exactly what they're protecting against, no gaps." Lawyer-speak alone fails that test; folksy alone fails it too. The doc must do both.

## Non-goals

- Privacy Policy revisions (already shipped; no overlap)
- Cookie Policy (no third-party cookies in scope today)
- DPA as a separate document (incorporated as inline clause in §7; full DPA available on shop request later)
- Sign-up consent checkbox / "I agree" modal (separate PR if/when public signup ships)
- Account-settings menu link to legal docs (separate small PR; both docs reachable from the Legal footer column today)
- Versioned ToS archive at `/terms/[version]` (one current version live for now; archive shipping at second material update)
- In-app post-update banner (ships with the first material change)
- LLC formation / corporate-veil protection (separate decision for Brandon outside this PR's scope; flagged in chat once)

---

## Discovered scope additions

### 1. Footer Legal column expansion (small)

The Legal column added in the Privacy PR currently contains just "Privacy." This PR appends "Terms" as a second `<li>`. The column header stays "Legal" — it now genuinely earns its name with two items.

### 2. Middleware exempt list (same pattern as Privacy)

`/terms` must be added to `EXEMPT_EXACT` in `lib/auth-access.ts` so signed-out users and crawlers can reach it. Without it, middleware redirects to `/sign-in` and the page is unreachable to the audience that needs it (window shoppers, lawyers, journalists, search-engine crawlers). Same one-line addition + one-test addition as the Privacy PR.

---

## Architecture

### Route
- `app/terms/page.tsx` — top-level public page at `/terms`
- Still no `(legal)` route group. Two pages doesn't earn the abstraction either; re-evaluate at three.
- Reuses marketing `<Nav>` + `<Footer>` (which includes the updated Legal column after this PR)

### Rendering strategy
- Server component, inline TSX with semantic HTML
- `export const dynamic = 'force-dynamic'` — reads auth state for Nav/Footer chrome, same pattern as `/privacy` and the homepage
- Public route — no `checkAccess` gate, no redirect; this MUST be reachable signed-out

### Auth-state handling
Mirrors `/privacy` exactly: `getServerSupabase()` → `auth.getUser()` → `isSignedIn = !!user` → passed to `<Nav>` and `<Footer>` so CTAs render correctly. No try/catch — matches the homepage error-handling baseline.

### Composition skeleton

```tsx
import { getServerSupabase } from '@/lib/supabase-server'
import { Nav } from '@/components/marketing/nav'
import { Footer } from '@/components/marketing/footer'
import '@/components/marketing/marketing.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Terms of Service — Vyntechs',
  description:
    'The Vyntechs subscription agreement, acceptable use, liability, AI disclaimer, and dispute resolution terms. Plain-English, founder-honest, Texas governing law.',
  alternates: { canonical: 'https://vyntechs.dev/terms' },
  robots: { index: true, follow: true },
}

export default async function TermsPage() {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const isSignedIn = !!user

  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <article className="vm-legal">
        {/* h1 + meta block + TL;DR + 17 numbered sections */}
      </article>
      <Footer isSignedIn={isSignedIn} />
    </main>
  )
}
```

### Reusing /privacy styles
All `.vm-legal*` rules in `components/marketing/marketing.css` are reused as-is: typography (Inter Tight body, serif headings), meta block, TL;DR callout, list styles, link underlines, mobile breakpoints. The sub-processor table styles aren't used (no table in ToS). **No new CSS rules needed in this PR.**

---

## Content — 17 numbered sections + TL;DR

Voice: shop-floor plain-English with surgical legal weight. Numbered sections (unlike Privacy, which used named sections only) so clauses can be cited cleanly ("see §11" in correspondence). No all-caps disclaimers — the legal weight comes from the language, not the typography.

| § | Section title | Anchor id | Target words |
|---|---|---|---|
| — | TL;DR (blockquote at top) | tldr | ~120 |
| 1 | Who we are and who this applies to | who-we-are | ~100 |
| 2 | What you're agreeing to | acceptance | ~80 |
| 3 | Your account, your shop, your team | account | ~120 |
| 4 | What you pay and how it works | subscription | ~180 |
| 5 | Cancellation and refunds | cancellation | ~120 |
| 6 | What you can and can't do with Vyntechs | acceptable-use | ~280 |
| 7 | Your data, your customers' data, our role | data | ~280 |
| 8 | The AI is a tool — you are the technician | ai-disclaimer | ~280 |
| 9 | What Vyntechs owns vs. what you own | ip | ~160 |
| 10 | We don't promise the impossible | warranty-disclaimer | ~140 |
| 11 | How much we can owe you if something goes wrong | liability-cap | ~140 |
| 12 | You cover us if you misuse it | indemnification | ~140 |
| 13 | How either of us can end this | termination | ~160 |
| 14 | When we can suspend access right away | suspension | ~110 |
| 15 | Disputes — arbitration and Texas courts | dispute-resolution | ~280 |
| 16 | If we update these terms | modifications | ~110 |
| 17 | The boring fine print | general | ~160 |
| — | Contact | contact | ~40 |

**Total target: ~2,800 words.** Shorter than Shopmonkey (~4,200) and Tekmetric (~3,800) because we cut redundancy and write in shop-floor English. Long enough to cover every clause; short enough to actually read.

Section numbering convention: TL;DR and Contact are unnumbered (they're not enforceable provisions). §1–§17 are numbered so they can be cited cleanly in correspondence ("see §11 for the liability cap" rather than "see the section about liability limits"). The Privacy Policy used named sections only; the Terms uses numbered ones because a contract benefits from precise citation more than a notice does.

### Critical clause language (locked from research and Brandon's input)

These specific clause texts are decided. The implementer writes the surrounding prose; these phrases ship verbatim.

**§6 — Acceptable Use — the "don't type personal stuff" clause (Brandon-approved Version C):**

> Vyntechs is a diagnostic tool for vehicles — not a journal, not a filing cabinet, and not a place for anything that doesn't belong in a shop. Keep it professional: vehicle info, symptoms, codes, and repair history. Don't input customer personal details beyond what the job requires, and definitely not anything that has nothing to do with the car on the lift.

Followed immediately by a one-sentence legalese restatement listing prohibited categories so the clause is enforceable:

> Prohibited input categories include, without limitation: financial account numbers, government identification numbers, medical or health information, login credentials for any other system, sexual or relationship content, and any information unrelated to vehicle diagnosis or repair.

**§8 — AI Disclaimer — three layers:**

- *Layer 1 — Output disclaimer:* "AI-generated suggestions are statistical patterns drawn from training data and outside sources. They may be incomplete, inaccurate, or inapplicable to the specific vehicle and condition in front of you."
- *Layer 2 — Professional responsibility:* "You represent that the personnel using Vyntechs are qualified automotive technicians, and that every repair decision is made by those personnel exercising independent professional judgment. Vyntechs' AI output is one input among many — not a directive, not a diagnosis, and not a substitute for the work the technician does."
- *Layer 3 — Vehicle damage carve-out* (the single most important auto-specific clause, ALLDATA's pattern adapted): "Vyntechs is not liable for vehicle damage, customer injury, property damage, lost revenue, or any other consequence arising from reliance on AI-generated diagnostic suggestions, regardless of whether those suggestions were inaccurate, incomplete, or misapplied."

**§7 — Customer-of-customer data:**

The shop is the data controller. Vyntechs is the data processor acting only on the shop's documented instructions. The shop is responsible for obtaining any consent required by law from its own customers before entering their information into Vyntechs, and is responsible for responding to customer rights requests (access, deletion, correction). The shop indemnifies Vyntechs for any claim by a customer that arises from the shop's data-handling failures.

**§11 — Liability cap:**

Vyntechs' total cumulative liability arising from or related to this agreement is capped at the greater of (a) the fees the shop has paid to Vyntechs in the twelve (12) months immediately preceding the claim, or (b) one hundred US dollars (\$100). Vyntechs is not liable for indirect, incidental, consequential, special, exemplary, or punitive damages — including lost profits, lost revenue, loss of goodwill, or vehicle damage — even if Vyntechs has been advised of the possibility.

**§15 — Dispute resolution:**

- Binding individual arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules
- Forum: Johnson County, Texas (in-person, or remote/virtual at the arbitrator's discretion)
- **Class action waiver:** disputes must be brought individually, not as a class, collective, or representative action
- **30-day opt-out window** from first acceptance (Shopmonkey pattern — strengthens court-survivability by giving users a meaningful choice)
- **1-year statute of limitations:** any claim must be filed within one year of the event giving rise to the claim, or be forever barred (Tekmetric pattern)
- Carve-out: either party may seek injunctive or other equitable relief in Johnson County state or federal court without waiving the arbitration right

**§4 — Subscription:**

- $100 per active technician seat per month, billed monthly via Stripe
- Auto-renews each month unless cancelled
- Price changes get 30 days' email notice; continued use after the effective date is acceptance
- Past-due accounts (30+ days) may be suspended or terminated for cause

**§5 — Cancellation & Refunds:**

- Cancel anytime from account settings or by emailing brandon@vyntechs.com
- Access continues through the end of the current paid period
- **No refunds**, including for partial months, unused seats, suspension, or termination for cause
- Vyntechs-initiated termination for convenience entitles the shop to a pro-rated refund for the unused portion of the current paid period

**§9 — IP / Training data:**

- Vyntechs owns the platform, AI models, UI, documentation, and all derivative works
- The shop owns its Customer Data (data the shop enters + data their customers enter via the shop)
- The shop grants Vyntechs a non-exclusive license to use Customer Data to provide the service to the shop
- The shop grants Vyntechs a separate, perpetual license to use **anonymized, aggregated** session data — root cause + vehicle year/make/model/engine + symptoms + DTCs, with no shop, technician, or customer identifiers — to improve the AI
- Feedback (feature requests, bug reports) is licensed to Vyntechs perpetually and royalty-free

**§13 — Termination:**

- Shop may cancel anytime, effective end of paid period
- Vyntechs may terminate for cause (nonpayment, material breach, AUP violation, fraud) with reasonable notice
- Vyntechs may terminate for convenience with 30 days' notice + pro-rated refund
- After termination, Vyntechs provides a 30-day window for the shop to export their data; after that, data is deleted in accordance with the Privacy Policy

**§14 — Suspension:**

Vyntechs may suspend access **immediately, without termination**, for: imminent security risk, suspected fraud, AUP violation under active investigation, or compliance with a court order. Suspension does not entitle the shop to a refund and does not waive any of Vyntechs' termination rights.

**§16 — Modifications:**

- Material changes (pricing, liability, arbitration, AUP) get **30 days' in-app banner notice on the first sign-in after the change is posted**. Shops who do not sign in during the notice period are deemed to accept the changes the next time they access the Service. (Honest constraint: there is no transactional email sender wired up today; Supabase Auth handles only confirmation/magic-link emails. When/if a Resend-or-equivalent integration ships, this clause can be tightened to add email notice.)
- Non-material changes (grammar, typos, contact info, formatting) take effect immediately
- For arbitration-related changes specifically, the 30-day opt-out window is offered again (court-survivability protection)

**§17 — General:** standard severability, entire agreement, no waiver, assignment (Vyntechs may assign to an acquirer; shop may not assign without Vyntechs' consent), notices (email is sufficient written notice), force majeure (no liability for outages caused by third-party infrastructure failures, natural disasters, etc.).

---

## Footer Legal column update

Edit `components/marketing/footer.tsx` Legal column — append a Terms `<li>` after Privacy:

```tsx
<div>
  <h5>Legal</h5>
  <ul>
    <li>
      <a href="/privacy">Privacy</a>
    </li>
    <li>
      <a href="/terms">Terms</a>
    </li>
  </ul>
</div>
```

No CSS change needed — existing `.vm-foot li` rules already handle multi-item lists (Product, Account, About all have multi-items).

---

## Middleware allowlist

Edit `lib/auth-access.ts` — add `'/terms'` to `EXEMPT_EXACT`, immediately after `'/privacy'` (and add a one-line comment matching the Privacy entry's style):

```ts
'/privacy',
// Terms of Service — same public-reachability requirement as /privacy; also
// signs the contract every shop accepts on sign-up, so it must be readable
// without auth at any point.
'/terms',
'/api/health',
```

And edit `tests/unit/auth-access.test.ts` — append `'/terms'` to the `'exempt — page routes'` `it.each` array, right after `'/privacy'`.

---

## SEO + accessibility

**SEO** (via Next 14 App Router `export const metadata`):
- `title`: "Terms of Service — Vyntechs"
- `description`: as in composition skeleton above
- `alternates.canonical`: `https://vyntechs.dev/terms`
- `robots`: `index: true, follow: true`

**A11y:**
- Strict heading hierarchy: h1 → h2 (no h3 needed — sections are short enough)
- Every section has a unique `id` for deep-linking
- Numbered section titles ("§4 — What you pay and how it works") help screen-reader users navigate
- All links have visible text
- No external links in this doc (different from Privacy, which links to vendor privacy policies)
- Color contrast inherited from existing tokens — same as `/privacy`, already verified

---

## Files touched

**ADD:**
- `app/terms/page.tsx`

**EDIT:**
- `lib/auth-access.ts` — add `'/terms'` to `EXEMPT_EXACT`
- `tests/unit/auth-access.test.ts` — append `'/terms'` to the page-routes `it.each` array
- `components/marketing/footer.tsx` — add Terms `<li>` to the Legal column

(No CSS edits — all `.vm-legal*` rules from the Privacy PR are reused.)

---

## Testing

- **TDD on the middleware allowlist** (same pattern as Privacy): add the failing test for `isPaywallExempt('/terms') === true`, watch it fail, add `/terms` to `EXEMPT_EXACT`, watch it pass, commit.
- No automated tests for the page itself. Static content + routing, same as `/privacy`. Manual verification on the Vercel preview is the gate.

---

## Branch + PR flow

1. Rename worktree branch: `git branch -m worktree-feat-terms-page feat/terms-page`
2. Implement per §Files touched
3. `git push -u origin feat/terms-page` (Vercel preview deploys automatically)
4. `gh pr create` with title `feat(marketing): add /terms page + Legal column link` and the test-plan checklist in the body
5. Brandon validates the preview URL → Brandon merges to main. Claude does not merge.

---

## Done criteria

- `/terms` returns 200 at 375, 768, 1280, and 1440 px viewports
- No horizontal scroll at 375 px on any section
- All section deep-links work (`/terms#liability-cap`, `/terms#dispute-resolution`, etc.)
- Footer Legal column shows both "Privacy" and "Terms" on every page
- Bottom-bar Privacy link still works (no regression)
- Anchor refactor on Nav/Footer (shipped with Privacy PR) still works from `/terms`
- `pnpm tsc --noEmit` clean
- `pnpm test tests/unit/auth-access.test.ts` 53/53 pass (52 existing + 1 new `/terms` test)
- No new `package.json` dependencies
- (Optional, nice-to-have) Lighthouse a11y ≥ 95 via Chrome DevTools → Lighthouse

---

## Verification — Brandon's manual pass on the preview URL

1. **Open `/terms` in a private/incognito window** (no auth) — page loads, NO redirect to `/sign-in`. (Catches the middleware fix.)
2. Mobile viewport (iPhone or 375 px devtools) — scroll the whole policy. No horizontal scroll. All 17 sections readable. TL;DR callout has no left border at mobile.
3. Append `#dispute-resolution` to the URL — page scrolls to that section.
4. Append `#ai-disclaimer` to the URL — page scrolls to that section.
5. From `/terms`, click "Privacy" in the footer Legal column — `/privacy` loads.
6. From `/privacy`, click "Terms" in the footer Legal column — `/terms` loads.
7. From `/terms`, click "Pricing" in the Nav — lands at homepage pricing section.
8. Verify Nav reflects signed-in state ("Go to app") when you're signed in.
9. Read §6 (acceptable use) and confirm the goofy clause reads the way you want.
10. Read §8 (AI disclaimer) and §11 (liability cap) — these are the founder-protective core. Make sure you're comfortable signing your shops to these.
11. Repeat on desktop (1280 or 1440 px).
12. Merge when satisfied. Claude does not merge.

---

## Pre-publish CYA reminder (one-time)

Before merging, consider a 30-minute review with a Texas business attorney. Specifically worth asking the attorney about:

1. **DTPA (Texas Deceptive Trade Practices Act) exposure and waiver eligibility.** The DTPA covers "consumers" — Texas courts have held that B2B "business consumers" are eligible to bring DTPA claims under some circumstances. A TX-specific lawyer can confirm whether a DTPA-waiver clause is appropriate to add (some Texas B2B contracts include one).
2. **AAA arbitration enforceability with the 30-day opt-out and 1-year statute-of-limitations under Texas law specifically** (FAA preempts most state limits, but Texas has some quirks around adhesion-contract analysis).
3. **The vehicle damage carve-out in §8** — ALLDATA's pattern has held up nationally; worth confirming it would hold up against a Texas DTPA "unconscionability" challenge from a sympathetic shop owner.

$200–300 typical attorney fee; much less than fixing a gap in court. This is a suggestion, not a gate.

---

## Future work (out of scope for this PR)

- Sign-up consent checkbox ("I agree to the Privacy Policy and Terms of Service")
- Account settings menu link to legal docs
- Full Data Processing Addendum (DPA) as separate document for enterprise shops who request one
- Versioned ToS archive at `/terms/[version]` (ships at first material update)
- In-app banner surfacing on next sign-in after a material ToS change
- Click-to-accept modal for material ToS changes (B2B SaaS best practice)
- LLC formation to add corporate-veil protection on top of contractual liability cap (Brandon's separate decision — outside engineering scope)
