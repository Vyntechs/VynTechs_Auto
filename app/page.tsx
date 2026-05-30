import { getOptionalUser } from '@/lib/supabase-server'
import { Nav } from '@/components/marketing/nav'
import { Hero } from '@/components/marketing/hero'
import { Strip } from '@/components/marketing/strip'
import { Why } from '@/components/marketing/why'
import { Ladder } from '@/components/marketing/ladder'
import { Gate } from '@/components/marketing/gate'
import { Pricing } from '@/components/marketing/pricing'
import { Compare } from '@/components/marketing/compare'
import { FAQ } from '@/components/marketing/faq'
import { FinalCTA } from '@/components/marketing/final-cta'
import { Footer } from '@/components/marketing/footer'
import '@/components/marketing/marketing.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await getOptionalUser()
  const isSignedIn = !!user

  return (
    <main className="vm-page">
      <Nav isSignedIn={isSignedIn} />
      <Hero isSignedIn={isSignedIn} />
      <Strip />
      <Why />
      <Ladder />
      <Gate />
      <Pricing isSignedIn={isSignedIn} />
      <Compare />
      <FAQ />
      <FinalCTA isSignedIn={isSignedIn} />
      <Footer isSignedIn={isSignedIn} />
    </main>
  )
}
