import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getShopById } from '@/lib/db/queries'
import { listTodayTicketJobs, ticketActorFromProfile } from '@/lib/tickets'
import { FloorBoard } from '@/components/screens/floor-board'

// The wall board sits outside the (app) route group on purpose: it inherits
// the same middleware auth and the same shop-scoped projection as Today, but
// none of the app shell. Nothing on this screen is touchable, so a header,
// a nav rail, and a notice region would only spend wall space.

export const metadata = { title: 'Floor — Vyntechs' }

export default async function FloorPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const [shop, todayJobs] = await Promise.all([
    ctx.profile.shopId ? getShopById(db, ctx.profile.shopId) : Promise.resolve(null),
    listTodayTicketJobs(db, { actor: ticketActorFromProfile(ctx.profile) }),
  ])

  return <FloorBoard shopName={shop?.name ?? null} todayJobs={todayJobs} />
}
