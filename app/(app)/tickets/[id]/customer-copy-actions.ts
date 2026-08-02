'use server'

import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { getCustomerCopy, type CustomerCopyResult } from '@/lib/shop-os/customer-copy'
import { getServerSupabase } from '@/lib/supabase-server'
import { ticketActorFromProfile } from '@/lib/tickets'

export async function refreshCustomerCopy(ticketId: string): Promise<CustomerCopyResult> {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) return { ok: false, error: 'forbidden' }
  const access = await checkAccess(db, ctx.user.id)
  if (access.kind !== 'allow') return { ok: false, error: 'forbidden' }

  return getCustomerCopy(db, {
    actor: ticketActorFromProfile(ctx.profile),
    ticketId,
  })
}
