import { createTestDb } from '@/tests/helpers/db'
import { profiles, shopEntitlements, shops } from '@/lib/db/schema'
import { ticketActorFromProfile, type TicketActor } from '@/lib/tickets'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

export const GOLDEN_KEYS = {
  story: uuid(201),
  line: uuid(202),
  approval: uuid(203),
  part: uuid(204),
  payment: uuid(205),
} as const

export async function createGoldenShopDay() {
  const testDb = await createTestDb()
  const [shop] = await testDb.db.insert(shops).values({
    id: uuid(1),
    name: 'Golden Shop',
    laborRateCents: 12_000,
    taxRateBps: 800,
  }).returning()

  const [owner, advisor, tech, parts] = await testDb.db.insert(profiles).values([
    {
      id: uuid(10), userId: uuid(110), shopId: shop.id, role: 'owner',
      skillTier: 3, fullName: 'Golden Owner',
    },
    {
      id: uuid(11), userId: uuid(111), shopId: shop.id, role: 'advisor',
      skillTier: null, fullName: 'Golden Advisor',
    },
    {
      id: uuid(12), userId: uuid(112), shopId: shop.id, role: 'tech',
      skillTier: 3, fullName: 'Golden Technician',
    },
    {
      id: uuid(13), userId: uuid(113), shopId: shop.id, role: 'parts',
      skillTier: null, fullName: 'Golden Parts',
    },
  ]).returning()

  await testDb.db.insert(shopEntitlements).values({
    shopId: shop.id,
    diagnostics: false,
  })

  const people = { owner, advisor, tech, parts }
  const actors = Object.fromEntries(
    Object.entries(people).map(([role, profile]) => [role, ticketActorFromProfile(profile)]),
  ) as Record<keyof typeof people, TicketActor>

  return {
    ...testDb,
    shop,
    people,
    actors,
    customer: {
      name: 'Golden Customer',
      phone: '202-555-0100',
      email: 'golden.customer@example.invalid',
    },
    vehicle: {
      year: 2020,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L',
      mileage: 48_000,
    },
  }
}
