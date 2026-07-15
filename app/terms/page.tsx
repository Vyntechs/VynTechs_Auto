import { getOptionalUser } from '@/lib/supabase-server'
import { Nav } from '@/components/marketing/nav'
import { Footer } from '@/components/marketing/footer'
import '@/components/marketing/marketing.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Terms of Service — Vyntechs',
  description: 'Terms for the Vyntechs paid ShopOS service.',
  alternates: { canonical: 'https://vyntechs.dev/terms' },
  robots: { index: true, follow: true },
}

export default async function TermsPage() {
  const isSignedIn = !!(await getOptionalUser())
  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <article className="vm-legal">
        <h1>Vyntechs Terms of Service</h1>
        <dl className="vm-legal-meta">
          <dt>Revised</dt><dd>Revised July 15, 2026</dd>
          <dt>Effective</dt><dd>Effective for new acceptances when published; for existing subscribers 30 days after the in-app notice.</dd>
          <dt>Contact</dt><dd><a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a></dd>
        </dl>

        <blockquote className="vm-legal-tldr">
          <strong>TL;DR.</strong> Vyntechs is a paid ShopOS service for work
          orders, assignments, quotes, status, manual findings, and text work
          notes. It costs $100 per technician each month. Use it as an
          operating record, not as a substitute for professional judgment.
        </blockquote>

        <section>
          <h2>§1 — Agreement and accounts</h2>
          <p>These Terms are an agreement between the subscribing shop and Vyntechs, a Texas sole proprietorship of Brandon Nichols. Creating an account, accepting an invitation, subscribing, or using the service means you accept these Terms and the <a href="/privacy">Privacy Policy</a>.</p>
          <p>You must provide accurate account information, protect credentials, use the correct role, and promptly report suspected unauthorized access. A shop is responsible for people it invites and for removing access when it should end.</p>
        </section>

        <section>
          <h2>§2 — Current service</h2>
          <p>The current paid ShopOS service supports <strong>work orders, assignments, quotes, status, manual findings, and text work notes</strong>, together with related customer, vehicle, authorization, and job-flow records.</p>
          <p><strong>Operational file intake is unavailable in this release.</strong> The diagnostic engine is also unavailable. Historical submissions or records may remain where described in the Privacy Policy, but that history does not make either capability part of the current offer.</p>
          <p>Beta features may change, be corrected, or be removed. We will not represent an unavailable feature as included in the paid service.</p>
        </section>

        <section>
          <h2>§3 — Subscription and cancellation</h2>
          <p>Each technician seat is <strong>$100 USD per month</strong>, billed monthly through Stripe. Taxes may apply. You may cancel future renewal at any time; access ordinarily continues through the paid period. Except where law requires otherwise or we state otherwise in writing, fees already paid are not refundable.</p>
          <p>Failed, disputed, reversed, or expired payment may suspend access. Restoring a subscription uses the current checkout flow and price shown before purchase.</p>
        </section>

        <section>
          <h2>§4 — Shop data and acceptable use</h2>
          <p>The shop retains its rights in the records it enters. The shop gives Vyntechs permission to host, process, secure, back up, and display those records only as needed to provide and protect the service.</p>
          <p>Do not use Vyntechs to violate law, invade privacy, upload malicious material, probe security, evade access controls, overload the service, misrepresent identity or authorization, or store unrelated sensitive material.</p>
        </section>

        <section>
          <h2>§5 — Professional responsibility</h2>
          <p><strong>Technicians and shops remain responsible</strong> for vehicle inspection, testing, diagnosis, repair decisions, parts, labor, safety procedures, customer communication, legal compliance, and the accuracy of every work order and quote.</p>
          <p>Vyntechs organizes information and workflow. It does not inspect the vehicle, authorize work for the customer, guarantee a repair outcome, or replace service information, tools, training, or professional judgment.</p>
        </section>

        <section>
          <h2>§6 — Availability and warranties</h2>
          <p>The service is provided on an &ldquo;as available&rdquo; basis. We work to keep it reliable, but do not promise uninterrupted operation, permanent availability of a beta feature, error-free records, or compatibility with every device or browser.</p>
          <p>To the extent permitted by law, Vyntechs disclaims implied warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
        </section>

        <section>
          <h2>§7 — Liability</h2>
          <p>To the extent permitted by law, Vyntechs is not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, lost profits, lost business, vehicle downtime, or loss caused by inaccurate shop input or professional decisions.</p>
          <p>Vyntechs&apos; aggregate liability relating to the service will not exceed the fees the affected shop paid Vyntechs during the three months before the event giving rise to the claim. Limits do not apply where law prohibits them.</p>
        </section>

        <section>
          <h2>§8 — Ending service</h2>
          <p>We may suspend or terminate access for nonpayment, abuse, security risk, legal requirement, or material breach. Data handling after termination follows the Privacy Policy and applicable law.</p>
        </section>

        <section>
          <h2>§9 — Disputes, arbitration, and Texas law</h2>
          <p><strong>Read this section carefully; it affects legal rights.</strong> Before filing a claim, email <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a> with the issue and requested resolution. The parties will try to resolve it informally for 30 days.</p>
          <p>If it remains unresolved, the dispute goes to binding individual arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules. Arbitration takes place in Johnson County, Texas, or remotely if the arbitrator permits. The Federal Arbitration Act governs this provision.</p>
          <p>Claims must be individual, not class, collective, or representative. You may opt out of arbitration and the class-action waiver by emailing us within 30 days after first accepting these Terms. If you opt out, individual disputes go to state or federal courts in Johnson County, Texas.</p>
          <p>Either party may seek urgent injunctive relief in those courts. Other claims must be filed within one year after they arise unless applicable law requires more time. Texas law governs these Terms without regard to conflict-of-law rules.</p>
        </section>

        <section>
          <h2>§10 — Changes</h2>
          <p><strong>Existing subscribers keep their prior Terms until 30 days after this version is first shown in the signed-in app.</strong></p>
          <p>For new acceptances, this version is effective on the date shown above. For an existing subscriber entitled to advance notice under an earlier version, a material change takes effect only after the promised notice period.</p>
          <p>We provide at least 30 days&apos; notice before material changes to pricing, liability, arbitration, or acceptable use take effect for existing subscribers. You may cancel before the effective date. Non-material corrections may take effect when published.</p>
        </section>
      </article>
      <Footer isSignedIn={isSignedIn} />
    </main>
  )
}
