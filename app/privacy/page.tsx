import { getOptionalUser } from '@/lib/supabase-server'
import { Nav } from '@/components/marketing/nav'
import { Footer } from '@/components/marketing/footer'
import '@/components/marketing/marketing.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Privacy Policy — Vyntechs',
  description: 'How Vyntechs collects, uses, stores, and protects ShopOS data.',
  alternates: { canonical: 'https://vyntechs.dev/privacy' },
  robots: { index: true, follow: true },
}

export default async function PrivacyPage() {
  const isSignedIn = !!(await getOptionalUser())
  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <article className="vm-legal">
        <h1>Vyntechs Privacy Policy</h1>
        <dl className="vm-legal-meta">
          <dt>Effective</dt><dd>Effective July 15, 2026</dd>
          <dt>Contact</dt><dd><a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a></dd>
        </dl>

        <blockquote className="vm-legal-tldr">
          <strong>TL;DR.</strong> Vyntechs processes account and shop data to
          provide ShopOS. We do not sell personal data. The current release is
          text-first and does not accept new operational files.
        </blockquote>

        <section>
          <h2>Who this policy covers</h2>
          <p>This policy covers shop owners, technicians, advisors, and other people who use Vyntechs.</p>
          <p>If a shop enters customer information, the shop controls that customer relationship and is responsible for having an appropriate basis to provide the information to us.</p>
        </section>

        <section>
          <h2>What we collect</h2>
          <ul>
            <li><strong>Account data:</strong> email, profile name, role, shop membership, and authentication events.</li>
            <li><strong>Shop records:</strong> customer and vehicle facts, concerns, work orders, assignments, quotes, authorization decisions, status, manual findings, and text work notes.</li>
            <li><strong>Service data:</strong> subscription state, security events, request metadata, and limited operational logs.</li>
          </ul>
        </section>

        <section>
          <h2>Current operational-media boundary</h2>
          <p><strong>New operational uploads are unavailable.</strong></p>
          <p><strong>Historical uploaded submissions or related metadata may remain until the separately authorized production purge is verified.</strong></p>
          <p><strong>We do not claim deletion from provider temporary systems or infrastructure backups.</strong> Those systems may retain data for their own bounded recovery or security periods even after primary application records are removed.</p>
          <p>After the production purge is independently verified, we will update this policy before publishing any broader deletion claim.</p>
        </section>

        <section>
          <h2>How we use data</h2>
          <ul>
            <li>Provide, secure, support, and improve the paid ShopOS service.</li>
            <li>Keep shop records scoped to the correct shop and role.</li>
            <li>Process subscriptions, investigate failures, and prevent abuse.</li>
            <li>Meet legal obligations and respond to valid legal process.</li>
          </ul>
        </section>

        <section>
          <h2>Service providers</h2>
          <p>We use service providers for hosting, databases and authentication, payments, email, analytics, and security. They receive only the data needed for their role and operate under their own terms and privacy commitments.</p>
          <p>Stripe processes payment-card details; Vyntechs does not store full card numbers.</p>
        </section>

        <section>
          <h2>Retention and deletion</h2>
          <p>Active shop records remain available while needed to provide the service and meet contractual, security, tax, dispute, or legal obligations. Some historical repair records may remain visible to an authorized shop after a team member is deactivated.</p>
          <p>Deletion from the primary service does not mean immediate removal from bounded backups, provider caches, fraud records, or security logs.</p>
        </section>

        <section>
          <h2>Your choices and rights</h2>
          <p>You may request access, correction, export, or deletion by emailing <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a> from the account address. We may verify identity and preserve records that law or legitimate security needs require us to keep.</p>
        </section>

        <section>
          <h2>Security and changes</h2>
          <p>We use encrypted connections and access controls appropriate to a small beta service. No internet service can promise perfect security, and Vyntechs does not currently claim formal compliance certification.</p>
          <p>Material changes receive a new effective date on this page. Questions or suspected mismatches may be sent to <a href="mailto:brandon@vyntechs.com">brandon@vyntechs.com</a>.</p>
        </section>
      </article>
      <Footer isSignedIn={isSignedIn} />
    </main>
  )
}
