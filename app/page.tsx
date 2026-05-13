import { getServerSupabase } from '@/lib/supabase-server'
import { StickyCTA } from '@/components/marketing/sticky-cta'
import { Hero } from '@/components/marketing/hero'
import { WhatItIs } from '@/components/marketing/what-it-is'
import { Problem } from '@/components/marketing/problem'
import { Motion } from '@/components/marketing/motion'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { Different } from '@/components/marketing/different'
import { NotYet } from '@/components/marketing/not-yet'
import { Improving } from '@/components/marketing/improving'
import { Pricing } from '@/components/marketing/pricing'
import { FAQ } from '@/components/marketing/faq'
import { FinalCTA } from '@/components/marketing/final-cta'
import '@/components/marketing/marketing.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isSignedIn = !!user

  return (
    <main className="mk-page">
      <StickyCTA isSignedIn={isSignedIn} />
      <Hero />
      <WhatItIs />
      <Problem />
      <Motion />
      <HowItWorks />
      <Different />
      <NotYet />
      <Improving />
      <Pricing isSignedIn={isSignedIn} />
      <FAQ />
      <FinalCTA isSignedIn={isSignedIn} />
    </main>
  )
}
