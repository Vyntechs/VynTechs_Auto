import { getOptionalUser } from '@/lib/supabase-server'
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
  const user = await getOptionalUser()
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
              <strong>
                Customer name, phone number, and (optionally) email
              </strong>{' '}
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
              <strong>
                Which &ldquo;What&apos;s New&rdquo; entries you&apos;ve seen
              </strong>{' '}
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
                  diagnostic suggestions.{' '}
                  <strong>Never receives your name or email.</strong> Anthropic
                  does not train its models on the data we send through its
                  API.
                </td>
              </tr>
              <tr>
                <td data-label="Service">
                  <a href="https://www.voyageai.com/privacy/">Voyage AI</a>
                </td>
                <td data-label="What it sees">
                  Converts text into numbers for similarity matching.
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
            When you (or your shop&apos;s owner) ask us to delete an account, we
            delete it within <strong>30 days</strong>. Our database backups roll
            forward every 90 days, so deleted data fully ages out of backups
            within 90 days of deletion.
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
            the third parties listed above. It&apos;s stored in
            Supabase&apos;s encrypted database. Only you, your shop&apos;s team,
            and the Vyntechs team can read your data inside the app. Our
            sub-processors see only the slices of data we send them as described
            above.
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
