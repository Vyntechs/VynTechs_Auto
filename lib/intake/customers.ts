import { and, eq } from 'drizzle-orm'
import { customers, type Customer } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export type UpsertCustomerInput = {
  shopId: string
  name: string
  phone: string
  email: string | null
}

export async function upsertCustomer(db: AppDb, input: UpsertCustomerInput): Promise<Customer> {
  const normalizedEmail = input.email && input.email.trim() !== '' ? input.email.trim() : null

  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.shopId, input.shopId), eq(customers.phone, input.phone)))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(customers)
    .values({
      shopId: input.shopId,
      name: input.name,
      phone: input.phone,
      email: normalizedEmail,
    })
    .returning()

  return created
}
