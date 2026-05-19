# Terms of Service Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/terms` as a public page rendering the Vyntechs Terms of Service — per spec at `docs/superpowers/specs/2026-05-19-terms-page-design.md`.

**Architecture:** New server-component page that reuses the marketing `<Nav>` + `<Footer>` and all `.vm-legal*` CSS shipped with `/privacy`. Middleware allowlist (`lib/auth-access.ts`) is extended with `/terms` so signed-out users and crawlers can reach the page. The Footer's Legal column is extended with "Terms" below the existing "Privacy" link.

**Tech Stack:** Next.js 14 App Router (server component), TypeScript, vitest (one new test for the allowlist), Supabase auth (read-only for chrome rendering). No new dependencies.

---

### Task 1: Add /terms to middleware paywall-exempt list (TDD)

**Why first:** Without this, the rest of the work is invisible — signed-out visitors and crawlers hitting `/terms` would be bounced to `/sign-in`.

**Files:**
- Modify: `tests/unit/auth-access.test.ts` — append one entry to the `'exempt — page routes'` it.each array
- Modify: `lib/auth-access.ts` — add one entry to the `EXEMPT_EXACT` set

- [ ] **Step 1: Add the failing test entry**

In `tests/unit/auth-access.test.ts`, in the `describe('exempt — page routes')` block, append `'/terms',` after `'/privacy',`. Final array:

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
      '/terms',
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
× isPaywallExempt > exempt — page routes > exempts /terms
  AssertionError: expected false to be true
```

(All other tests pass — only the new `/terms` case fails.)

- [ ] **Step 3: Add '/terms' to EXEMPT_EXACT**

In `lib/auth-access.ts`, in the `EXEMPT_EXACT = new Set<string>([...])` literal, add `'/terms',` after the `'/privacy',` block. The relevant section becomes:

```ts
  // Privacy policy — must be reachable signed-out (GDPR Article 12) and
  // by deactivated users; sits in the fast-path exempt set so middleware
  // never bounces a public-policy reader to /sign-in.
  '/privacy',
  // Terms of Service — same public-reachability requirement as /privacy;
  // also signs the contract every shop accepts on sign-up, so it must be
  // readable without auth at any point.
  '/terms',
  '/api/health',
])
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm test tests/unit/auth-access.test.ts
```

Expected: all tests pass, including `exempts /terms`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/auth-access.test.ts lib/auth-access.ts
git commit -m "feat(auth): exempt /terms from middleware paywall

Same public-reachability requirement as /privacy — signed-out visitors,
crawlers, and prospective shop owners must reach the Terms without
hitting /sign-in. Joins /privacy in the publicly-reachable bucket."
```

---

### Task 2: Add Terms link to Footer Legal column

**Files:**
- Modify: `components/marketing/footer.tsx` — append a `<li>` to the Legal column

- [ ] **Step 1: Edit the Legal column**

Locate the Legal column in `components/marketing/footer.tsx`. It currently has one item:

```tsx
        <div>
          <h5>Legal</h5>
          <ul>
            <li>
              <a href="/privacy">Privacy</a>
            </li>
          </ul>
        </div>
```

Replace with:

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

(No CSS change needed — existing `.vm-foot li` rules already handle multi-item lists like Product, Account, and About.)

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/footer.tsx
git commit -m "feat(marketing): add Terms link to footer Legal column"
```

---

### Task 3: Create app/terms/page.tsx with full ToS content

**Files:**
- Create: `app/terms/page.tsx`

**Note:** The file is ~470 lines because the full ToS content is inlined as semantic JSX. All clause language is locked per the spec; the surrounding prose is drafted in shop-floor English.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p app/terms
```

- [ ] **Step 2: Write `app/terms/page.tsx`**

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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isSignedIn = !!user

  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <article className="vm-legal">
        <h1>Vyntechs Terms of Service</h1>
        <dl className="vm-legal-meta">
          <dt>Effective</dt>
          <dd>May 19, 2026</dd>
          <dt>Contact</dt>
          <dd>
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>
          </dd>
        </dl>

        <blockquote className="vm-legal-tldr" id="tldr">
          <strong>TL;DR.</strong> Vyntechs is a paid diagnostic tool for
          automotive shops. You pay $100 per tech per month, billed monthly
          through Stripe. You can cancel anytime; access continues through the
          paid period; no refunds. The AI gives suggestions, not directives —
          the technician is still the professional in the loop. We are not on
          the hook for vehicle damage caused by reliance on AI output. Disputes
          go to binding arbitration in Johnson County, Texas. If you
          don&apos;t agree with any of this, don&apos;t use Vyntechs.
        </blockquote>

        <section id="who-we-are">
          <h2>§1 — Who we are and who this applies to</h2>
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) are a binding contract
            between you (the &ldquo;Customer&rdquo; — the shop and everyone the
            shop authorizes to use Vyntechs) and{' '}
            <strong>
              Vyntechs, a Texas sole proprietorship of Brandon Nichols
            </strong>{' '}
            (&ldquo;Vyntechs,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;).
          </p>
          <p>
            By creating an account, accepting an invitation, paying for a
            subscription, or using the Vyntechs service in any way, you agree
            to these Terms. If you don&apos;t agree, do not use Vyntechs.
          </p>
        </section>

        <section id="acceptance">
          <h2>§2 — What you&apos;re agreeing to</h2>
          <p>
            These Terms, together with the Vyntechs Privacy Policy (available
            at <a href="/privacy">/privacy</a>) and any order form, invoice, or
            written addendum we sign with you, form the entire agreement
            between us.
          </p>
          <p>
            You confirm that you are at least 18 years old, that you are
            authorized to enter into this agreement on behalf of the shop you
            represent, and that the shop is a legitimate business operating in
            compliance with applicable law.
          </p>
        </section>

        <section id="account">
          <h2>§3 — Your account, your shop, your team</h2>
          <p>
            The account holder is responsible for everything that happens under
            the account — including actions taken by techs, advisors, or
            anyone else on the shop&apos;s team. Keep credentials private.
            Don&apos;t share logins between people. If you suspect unauthorized
            access, email us at{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>.
          </p>
          <p>
            You&apos;re responsible for keeping your account information
            accurate (billing email, payment method, team roster). We&apos;re
            not liable for charges you missed or messages you didn&apos;t see
            because your contact info was stale.
          </p>
        </section>

        <section id="subscription">
          <h2>§4 — What you pay and how it works</h2>
          <p>
            Vyntechs is{' '}
            <strong>$100 per active technician seat per month</strong>. We bill
            monthly through Stripe. Your subscription auto-renews each month
            until you cancel.
          </p>
          <p>
            All prices are in US dollars and don&apos;t include applicable
            taxes. If we&apos;re required to collect sales tax in your
            jurisdiction, it&apos;ll be added to your invoice.
          </p>
          <p>
            If you add a technician mid-cycle, that seat is pro-rated for the
            remainder of the current billing period. If you remove a technician
            mid-cycle, you&apos;re not charged for that seat in the following
            period — but no refund is issued for the remainder of the current
            period.
          </p>
          <p>
            Price changes get <strong>30 days&apos; notice</strong>. We post a
            notice in the app on your next sign-in and update the date at the
            top of this page. Continued use after the effective date is
            acceptance of the new price. If you don&apos;t want the new price,
            cancel before the effective date.
          </p>
          <p>
            If a payment fails, we&apos;ll try again according to
            Stripe&apos;s standard retry schedule. If the account is more than{' '}
            <strong>30 days past due</strong>, we may suspend or terminate
            access for cause (see §13).
          </p>
        </section>

        <section id="cancellation">
          <h2>§5 — Cancellation and refunds</h2>
          <p>
            Cancel anytime from your account settings, or by emailing{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>.
            Cancellation is effective at the end of your current paid period —
            you keep access through that date and the auto-renewal
            doesn&apos;t fire.
          </p>
          <p>
            We don&apos;t issue refunds. That includes refunds for partial
            months, unused seats, downgrades, suspension or termination for
            cause, or any other situation. We&apos;re a $100/month service;
            the no-refund policy is what lets us keep prices low.
          </p>
          <p>
            If we terminate your access for convenience (not for cause), you
            get a pro-rated refund for the unused portion of the current paid
            period.
          </p>
        </section>

        <section id="acceptable-use">
          <h2>§6 — What you can and can&apos;t do with Vyntechs</h2>
          <p>
            You agree to use Vyntechs only for legitimate automotive diagnostic
            and repair purposes. You agree not to:
          </p>
          <ul>
            <li>Use Vyntechs in any way that violates applicable law</li>
            <li>
              Access or attempt to access another shop&apos;s account or data
            </li>
            <li>
              Resell, sublicense, or otherwise commercially exploit access to
              Vyntechs without our written consent
            </li>
            <li>
              Reverse engineer, decompile, scrape, or attempt to extract the
              underlying models, prompts, or training data
            </li>
            <li>Use Vyntechs to abuse, harass, or defraud anyone</li>
            <li>
              Upload malware, run automated bot traffic, or otherwise interfere
              with the service
            </li>
          </ul>
          <p>
            <strong>And one specific request that matters:</strong>
          </p>
          <blockquote className="vm-legal-tldr">
            Vyntechs is a diagnostic tool for vehicles — not a journal, not a
            filing cabinet, and not a place for anything that doesn&apos;t
            belong in a shop. Keep it professional: vehicle info, symptoms,
            codes, and repair history. Don&apos;t input customer personal
            details beyond what the job requires, and definitely not anything
            that has nothing to do with the car on the lift.
          </blockquote>
          <p>
            Specifically, prohibited input categories include, without
            limitation: financial account numbers, government identification
            numbers (Social Security, driver&apos;s license, passport),
            medical or health information, login credentials for any other
            system, sexual or relationship content, and any information
            unrelated to vehicle diagnosis or repair.
          </p>
        </section>

        <section id="data">
          <h2>§7 — Your data, your customers&apos; data, our role</h2>
          <p>
            The shop owns the data the shop and its team enter into Vyntechs
            (&ldquo;Customer Data&rdquo;). This includes vehicle records,
            customer contact info the shop chooses to enter, diagnostic notes,
            files uploaded, and anything else the shop submits.
          </p>
          <p>
            Vyntechs processes Customer Data only to provide the service to
            the shop, and according to the shop&apos;s documented instructions.
            We follow the practices described in our{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>
          <p>
            <strong>
              The shop is the data controller. Vyntechs is the data processor.
            </strong>{' '}
            That means:
          </p>
          <ul>
            <li>
              The shop is responsible for obtaining any consent required by
              law from its own customers (the car owners) before entering their
              information into Vyntechs.
            </li>
            <li>
              The shop is responsible for responding to its customers&apos;
              rights requests (access, deletion, correction). Vyntechs will
              assist with the technical execution of a deletion or export
              request when the shop asks.
            </li>
            <li>
              The shop indemnifies and holds Vyntechs harmless from any claim
              by one of the shop&apos;s customers that arises from the
              shop&apos;s data-handling failures (see §12).
            </li>
          </ul>
          <p>
            For the shop&apos;s own data — and for the customer data the shop
            puts into Vyntechs — we treat it according to the Privacy Policy.
            We never sell it. We never use it for advertising. We never send
            the shop&apos;s identifying information to the AI provider.
          </p>
        </section>

        <section id="ai-disclaimer">
          <h2>§8 — The AI is a tool — you are the technician</h2>
          <p>
            Vyntechs generates diagnostic suggestions using AI. Three things
            you need to understand about this:
          </p>
          <p>
            <strong>1. The output is statistical, not certified.</strong>{' '}
            AI-generated suggestions are based on statistical patterns drawn
            from training data, retrieved sources, and your shop&apos;s prior
            corpus entries. They may be incomplete, inaccurate, or inapplicable
            to the specific vehicle and condition in front of you.
          </p>
          <p>
            <strong>2. The technician is still the professional.</strong> You
            represent that the personnel using Vyntechs are qualified
            automotive technicians, and that every repair decision is made by
            those personnel exercising independent professional judgment.
            Vyntechs&apos; AI output is one input among many — not a directive,
            not a diagnosis, and not a substitute for the work the technician
            does.
          </p>
          <p>
            <strong>
              3. We are not liable for vehicle damage caused by reliance on AI
              output.
            </strong>{' '}
            Vyntechs is not liable for vehicle damage, customer injury,
            property damage, lost revenue, or any other consequence arising
            from reliance on AI-generated diagnostic suggestions, regardless of
            whether those suggestions were inaccurate, incomplete, or
            misapplied.
          </p>
          <p>
            This is the most important clause in this agreement, and it&apos;s
            why we wrote it three different ways: the AI is the assistant, not
            the responsible party. If you don&apos;t agree that the technician
            owns the diagnosis and the repair, Vyntechs is not the right tool
            for your shop.
          </p>
        </section>

        <section id="ip">
          <h2>§9 — What Vyntechs owns vs. what you own</h2>
          <p>
            <strong>Vyntechs owns:</strong> the platform, the AI models we use
            or train, the user interface, our prompts and tuning, our
            documentation, and any derivative works of any of these. Nothing
            in these Terms transfers ownership of Vyntechs&apos; intellectual
            property to you.
          </p>
          <p>
            <strong>You own:</strong> your Customer Data (everything you and
            your customers put into Vyntechs).
          </p>
          <p>
            <strong>Your license to us:</strong> you grant Vyntechs a
            non-exclusive, worldwide license to use your Customer Data to
            provide the service to you. You separately grant Vyntechs a
            perpetual, royalty-free license to use{' '}
            <strong>anonymized, aggregated</strong> session data — root cause
            plus vehicle year/make/model/engine plus symptoms plus DTCs, with
            no shop, technician, or customer identifiers attached — to train
            and improve the Vyntechs AI. Without this, we couldn&apos;t keep
            getting better.
          </p>
          <p>
            <strong>Feedback:</strong> any suggestion, feature request, or bug
            report you send us is licensed to Vyntechs perpetually and
            royalty-free. We can build it (or not), ship it, and improve it
            without owing you a thing.
          </p>
        </section>

        <section id="warranty-disclaimer">
          <h2>§10 — We don&apos;t promise the impossible</h2>
          <p>
            Vyntechs is provided <strong>&ldquo;as is&rdquo;</strong> and{' '}
            <strong>&ldquo;as available.&rdquo;</strong> We don&apos;t promise
            that the service will be uninterrupted, error-free, secure against
            every attack, or that diagnostic suggestions will be accurate,
            complete, current, or fit for any particular purpose.
          </p>
          <p>
            To the maximum extent permitted by law, Vyntechs disclaims all
            warranties — express, implied, statutory, or otherwise — including
            warranties of merchantability, fitness for a particular purpose,
            title, non-infringement, and any warranty arising from a course of
            dealing or usage of trade.
          </p>
          <p>
            Some jurisdictions don&apos;t allow exclusion of certain
            warranties; in those jurisdictions, the disclaimer applies to the
            maximum extent allowed.
          </p>
        </section>

        <section id="liability-cap">
          <h2>§11 — How much we can owe you if something goes wrong</h2>
          <p>
            <strong>Vyntechs&apos; total cumulative liability</strong> arising
            from or related to these Terms or your use of Vyntechs is capped
            at the{' '}
            <strong>
              greater of (a) the fees the shop has paid to Vyntechs in the
              twelve (12) months immediately preceding the event giving rise
              to the claim, or (b) one hundred US dollars ($100)
            </strong>
            .
          </p>
          <p>
            Vyntechs is not liable for indirect, incidental, consequential,
            special, exemplary, or punitive damages — including but not
            limited to lost profits, lost revenue, loss of goodwill, loss of
            data, business interruption, or vehicle damage — even if we have
            been advised of the possibility.
          </p>
          <p>
            The liability cap and the consequential-damages exclusion apply{' '}
            <strong>even if a remedy fails of its essential purpose</strong>,
            and they survive termination of these Terms.
          </p>
        </section>

        <section id="indemnification">
          <h2>§12 — You cover us if you misuse it</h2>
          <p>
            <strong>You indemnify Vyntechs</strong> against any claim, damage,
            loss, or expense (including reasonable attorneys&apos; fees)
            arising from:
          </p>
          <ul>
            <li>
              Your or your team&apos;s misuse of Vyntechs in violation of
              these Terms
            </li>
            <li>
              Your failure to comply with applicable law (privacy,
              consumer-protection, professional licensing, anything else)
            </li>
            <li>
              Claims by your customers (the car owners) arising from your
              data-handling practices or your use of Vyntechs&apos; output
            </li>
            <li>
              Claims that your Customer Data infringes a third party&apos;s
              rights
            </li>
          </ul>
          <p>
            <strong>Vyntechs indemnifies you</strong> against any third-party
            claim that the Vyntechs platform itself infringes a US patent,
            copyright, or trademark, provided you notify us promptly, let us
            control the defense, and reasonably cooperate. This indemnification
            is capped at the same liability cap in §11.
          </p>
        </section>

        <section id="termination">
          <h2>§13 — How either of us can end this</h2>
          <p>
            <strong>You can cancel</strong> anytime, as described in §5. No
            reason required.
          </p>
          <p>
            <strong>Vyntechs can terminate for cause</strong> if you (a) fail
            to pay and remain past due for more than 30 days, (b) materially
            breach these Terms, (c) violate §6 (acceptable use), or (d) we
            have reason to believe you&apos;re using Vyntechs for fraud or
            illegal activity. We&apos;ll give reasonable notice except in
            cases of active abuse, security risk, or fraud, where we may
            terminate immediately.
          </p>
          <p>
            <strong>Vyntechs can terminate for convenience</strong> (no fault
            on your side) with at least 30 days&apos; notice. In that case,
            we issue a pro-rated refund for the unused portion of your current
            paid period.
          </p>
          <p>
            <strong>After termination:</strong> you have{' '}
            <strong>30 days</strong> to export your data from Vyntechs
            (we&apos;ll assist if needed). After 30 days, your data is deleted
            according to the Privacy Policy. Sections that by their nature
            survive termination — including §8 (AI disclaimer), §9 (IP), §11
            (liability), §12 (indemnification), and §15 (disputes) — survive.
          </p>
        </section>

        <section id="suspension">
          <h2>§14 — When we can suspend access right away</h2>
          <p>
            Vyntechs may{' '}
            <strong>
              suspend access immediately, without terminating the account
            </strong>
            , if we have reasonable belief that (a) there&apos;s an imminent
            security risk, (b) the account is being used for fraud, (c)
            you&apos;re in active violation of §6 (acceptable use) and
            we&apos;re investigating, or (d) we&apos;re required to suspend by
            a court order or law-enforcement request.
          </p>
          <p>
            Suspension does not entitle you to a refund. It does not waive any
            of Vyntechs&apos; rights, including the right to terminate for
            cause later.
          </p>
        </section>

        <section id="dispute-resolution">
          <h2>§15 — Disputes — arbitration and Texas courts</h2>
          <p>
            <strong>
              Read this section carefully — it affects your legal rights.
            </strong>
          </p>
          <p>
            <strong>First, talk to us.</strong> If you have a dispute, email{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>{' '}
            with a description and what resolution you&apos;re seeking. Most
            issues get resolved this way in less than a week.
          </p>
          <p>
            <strong>Binding arbitration.</strong> If we can&apos;t resolve the
            dispute informally within 30 days, it goes to{' '}
            <strong>binding individual arbitration</strong> administered by
            the American Arbitration Association (AAA) under its Commercial
            Arbitration Rules. The arbitration takes place in{' '}
            <strong>Johnson County, Texas</strong> (in-person, or
            remote/virtual at the arbitrator&apos;s discretion). The
            arbitrator&apos;s decision is final and enforceable in court.
          </p>
          <p>
            <strong>Class action waiver.</strong> Disputes between you and
            Vyntechs must be brought individually. You waive the right to
            bring a class, collective, or representative action. The
            arbitrator cannot consolidate claims or preside over class
            proceedings.
          </p>
          <p>
            <strong>30-day opt-out window.</strong> You may opt out of the
            arbitration and class action waiver provisions of this §15 by
            emailing{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>{' '}
            within 30 days of first accepting these Terms. If you opt out,
            disputes go to the courts in Johnson County, Texas (state or
            federal) on an individual basis.
          </p>
          <p>
            <strong>One-year statute of limitations.</strong> Any claim
            arising from or related to these Terms must be filed within{' '}
            <strong>one (1) year</strong> of the event giving rise to the
            claim or be forever barred. This shortens the default Texas
            statute of limitations.
          </p>
          <p>
            <strong>Carve-out for injunctive relief.</strong> Either party may
            seek injunctive or other equitable relief in the state or federal
            courts located in Johnson County, Texas, without waiving the
            arbitration right. This protects against urgent harms (data leaks,
            IP infringement) that can&apos;t wait for arbitration scheduling.
          </p>
          <p>
            <strong>Governing law.</strong> These Terms are governed by the
            laws of the State of Texas, without regard to conflict-of-law
            principles. The Federal Arbitration Act governs the interpretation
            and enforcement of the arbitration provisions.
          </p>
        </section>

        <section id="modifications">
          <h2>§16 — If we update these terms</h2>
          <p>
            We may update these Terms. For{' '}
            <strong>material changes</strong> (pricing, liability, arbitration,
            acceptable use), we&apos;ll post an in-app banner on your next
            sign-in at least <strong>30 days before the effective date</strong>
            . You may cancel before the effective date if you don&apos;t
            agree. Continued use after the effective date is acceptance.
          </p>
          <p>
            For <strong>non-material changes</strong> (grammar, typos,
            formatting, contact info), updates take effect immediately. The
            current effective date appears at the top of this page.
          </p>
          <p>
            If a future update modifies the arbitration provisions in §15, the
            30-day opt-out window is offered again so you can opt out of the
            new version specifically.
          </p>
        </section>

        <section id="general">
          <h2>§17 — The boring fine print</h2>
          <p>
            <strong>Severability.</strong> If any provision of these Terms is
            held unenforceable, the rest stays in effect.
          </p>
          <p>
            <strong>Entire agreement.</strong> These Terms, the Privacy
            Policy, and any signed order form are the entire agreement between
            you and Vyntechs, and supersede any prior discussions, demos,
            marketing copy, or emails.
          </p>
          <p>
            <strong>No waiver.</strong> If we don&apos;t enforce a provision,
            we haven&apos;t waived our right to enforce it later.
          </p>
          <p>
            <strong>Assignment.</strong> Vyntechs may assign these Terms to a
            successor or acquirer. You may not assign these Terms without our
            written consent.
          </p>
          <p>
            <strong>Notices.</strong> Email is sufficient written notice.
            Notices to you go to the billing email on file. Notices to us go
            to <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>.
          </p>
          <p>
            <strong>Force majeure.</strong> Neither party is liable for delays
            or failures caused by events outside its reasonable control —
            natural disasters, internet outages, failures of cloud
            infrastructure providers (Vercel, Supabase, Stripe, Anthropic),
            government action, or similar events.
          </p>
          <p>
            <strong>Export controls.</strong> You agree not to use Vyntechs in
            any country or jurisdiction subject to comprehensive US trade
            sanctions, or for any purpose prohibited by US export-control law.
          </p>
        </section>

        <section id="contact">
          <h2>Contact</h2>
          <p>
            Questions about these Terms? Email{' '}
            <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>.
            We&apos;re a small team — Brandon reads everything.
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

- [ ] **Step 4: Commit**

```bash
git add app/terms/page.tsx
git commit -m "feat(marketing): /terms page with founder-protective ToS

17 numbered sections + TL;DR + Contact, ~2,500 words in shop-floor
plain English with surgical legal weight. Key clauses:

- §6 acceptable use: 'this is for automotive, not your love life'
  (Brandon-approved goofy clause + legalese restatement)
- §8 AI disclaimer: 3 layers, vehicle damage carve-out (ALLDATA pattern)
- §11 liability cap: 12mo fees or \$100 (Shopmonkey pattern)
- §15 arbitration: AAA Johnson County TX + class waiver + 30-day
  opt-out + 1yr SoL (Tekmetric pattern)
- §7 data: shop is controller, Vyntechs is processor; shop indemnifies"
```

---

### Task 4: Rename branch and push

**Files:**
- Git: rename branch, push with upstream tracking

- [ ] **Step 1: Rename `worktree-feat-terms-page` → `feat/terms-page`**

```bash
git branch -m worktree-feat-terms-page feat/terms-page
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/terms-page`.

- [ ] **Step 2: Sanity-check commit history**

```bash
git log --oneline origin/main..HEAD
```

Expected: 4 commits — spec + 3 implementation commits, in this order:

```
<sha> feat(marketing): /terms page with founder-protective ToS
<sha> feat(marketing): add Terms link to footer Legal column
<sha> feat(auth): exempt /terms from middleware paywall
<sha> docs(spec): terms of service page design (2026-05-19)
```

- [ ] **Step 3: Push with upstream tracking**

```bash
git push -u origin feat/terms-page
```

Expected: branch pushed; Vercel webhook starts the preview build.

---

### Task 5: Open PR and surface preview URL

- [ ] **Step 1: Create the PR**

```bash
gh pr create --title "feat(marketing): add /terms page + Legal column link" --body "$(cat <<'EOF'
## Summary

- Adds `/terms` as a public page with the full Vyntechs Terms of Service (17 numbered sections + TL;DR + Contact, ~2,500 words, shop-floor plain English)
- Adds **Terms** link to the marketing footer Legal column, below Privacy
- Adds `/terms` to `EXEMPT_EXACT` so middleware lets signed-out users + crawlers + lawyers through (covered by a new test in `tests/unit/auth-access.test.ts`)
- Reuses all `.vm-legal*` CSS shipped with /privacy — no new CSS rules

Design spec: `docs/superpowers/specs/2026-05-19-terms-page-design.md`.
Implementation plan: `docs/superpowers/plans/2026-05-19-terms-page.md`.

**Key clause highlights:**
- §6 Acceptable Use: includes Brandon's "this is for automotive, not your love life" clause + a legalese restatement listing prohibited input categories
- §8 AI Disclaimer: 3-layer disclaimer with vehicle damage carve-out (ALLDATA pattern)
- §11 Liability Cap: 12 months of fees or \$100 floor (Shopmonkey pattern)
- §15 Dispute Resolution: AAA arbitration in Johnson County, TX + class waiver + 30-day opt-out + 1-year statute of limitations (Tekmetric pattern)
- §7 Data: shop is controller, Vyntechs is processor; shop indemnifies for customer-of-customer claims

## Test plan

- [ ] Open `/terms` in a private/incognito window — page loads, NO redirect to `/sign-in`
- [ ] Scroll the whole policy on mobile (375 px) — no horizontal scroll, all 17 sections readable
- [ ] Append `#dispute-resolution` to the URL — page scrolls to that section
- [ ] Append `#ai-disclaimer` to the URL — page scrolls to that section
- [ ] From `/terms`, click "Privacy" in the footer Legal column — `/privacy` loads
- [ ] From `/privacy`, click "Terms" in the footer Legal column — `/terms` loads
- [ ] From `/terms`, click "Pricing" in the Nav — lands at homepage pricing section
- [ ] Verify Nav reflects signed-in state ("Go to app") when signed in
- [ ] Repeat on desktop (1280 or 1440 px)
- [ ] Read §6 (acceptable use), §8 (AI disclaimer), §11 (liability cap) — these are the founder-protective core; confirm comfortable signing shops to these

**Pre-publish CYA reminder** (one-time, not blocking): consider a 30-min Texas business attorney review before merging. The spec lists specific TX questions to ask.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Vercel preview URL is auto-posted by the Vercel bot as the first PR comment, usually within 30-60 seconds.

- [ ] **Step 2: Wait for Vercel preview to build**

Replace `<PR#>` with the PR number from Step 1's output (the URL ends with `/pull/<PR#>`). Run in background:

```bash
until gh pr checks <PR#> 2>&1 | grep -E "^Vercel\s+(pass|fail)" >/dev/null; do sleep 5; done
```

When the loop exits, fetch the preview URL:

```bash
gh pr view <PR#> --json comments --jq '.comments[] | select(.author.login=="vercel") | .body' \
  | grep -oE 'https://vyntechs[a-zA-Z0-9_-]+\.vercel\.app' | head -1
```

- [ ] **Step 3: Surface the PR + preview URL to Brandon**

Print the PR URL and the Vercel preview URL to the chat. Wait for his validation.

---

## Done

Implementation is complete when:
- All 5 tasks above are checked off
- PR is open with a working Vercel preview URL
- Brandon has the preview URL for his manual verification pass
- Brandon merges (Claude does not merge)

The pre-existing `calibration-manual-trigger.test.ts` failure on `origin/main` (unrelated to this work) is **not** a gate. If anything new in the full test run goes red, debug before handoff.
