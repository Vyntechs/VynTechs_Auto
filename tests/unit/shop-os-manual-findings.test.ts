import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import {
  jobLines,
  profiles,
  shopEntitlements,
  stripeCustomers,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { saveReviewedCustomerStory } from '@/lib/shop-os/customer-stories'
import {
  CUSTOMER_STORY_WAIVER,
  parsePersistedCustomerStory,
  parsePersistedCustomerStoryMeta,
} from '@/lib/shop-os/customer-story-contracts'
import { createDraftLine, getQuoteBuilder } from '@/lib/shop-os/quotes'

const CONCERN = 'No start after rain'

async function seedDiagnosticTicket(db: TestDb) {
  const shop = await createShop(db, {
    name: 'Findings Garage',
    laborRateCents: 12_000,
    taxRateBps: 800,
  })
  const profile = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
    role: 'tech',
    skillTier: 2,
  })
  await db.insert(stripeCustomers).values({
    shopId: shop.id,
    stripeCustomerId: `cus_${profile.id.slice(0, 8)}`,
    subscriptionStatus: 'active',
  })
  const [ticket] = await db.insert(tickets).values({
    shopId: shop.id,
    ticketNumber: 1,
    source: 'tech_quick',
    concern: CONCERN,
    createdByProfileId: profile.id,
  }).returning()
  const [job] = await db.insert(ticketJobs).values({
    shopId: shop.id,
    ticketId: ticket.id,
    title: 'Diagnose no-start',
    kind: 'diagnostic',
    requiredSkillTier: 2,
  }).returning()
  return { shop, profile, ticket, job }
}

function reviewInput(
  seed: Awaited<ReturnType<typeof seedDiagnosticTicket>>,
  overrides: Partial<{
    clientKey: string
    expectedStoryRevision: number
    whatWeFound: string
    whatWeRecommend: string
  }> = {},
) {
  return {
    actor: { profileId: seed.profile.id },
    ticketId: seed.ticket.id,
    jobId: seed.job.id,
    clientKey: overrides.clientKey ?? crypto.randomUUID(),
    expectedStoryRevision: overrides.expectedStoryRevision ?? 0,
    whatWeFound: overrides.whatWeFound ?? 'Corroded ground strap at the engine block.',
    whatWeRecommend: overrides.whatWeRecommend ?? 'Replace the ground strap and retest.',
  }
}

describe('manual findings — sessionless diagnostic story path', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('fills the exact customerStory shape the AI path fills, with reviewed manual meta', async () => {
    const seed = await seedDiagnosticTicket(db)
    const result = await saveReviewedCustomerStory(db, reviewInput(seed))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.story).toEqual({
      whatYouToldUs: CONCERN,
      whatWeFound: 'Corroded ground strap at the engine block.',
      howWeKnow: [],
      whatItMeansIfWaived: CUSTOMER_STORY_WAIVER,
      whatWeRecommend: 'Replace the ground strap and retest.',
    })
    expect(result.storyRevision).toBe(1)
    expect(result.storyMeta.source).toBe('manual')
    expect(result.storyMeta.reviewStatus).toBe('reviewed')
    expect(result.storyMeta.sessionId).toBeUndefined()

    // Persisted row parses with the SAME contracts every other path uses.
    const [row] = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.id, seed.job.id))
    expect(parsePersistedCustomerStory(row.customerStory)).not.toBeNull()
    const meta = parsePersistedCustomerStoryMeta(row.storyMeta)
    expect(meta?.source).toBe('manual')
    expect(meta?.reviewStatus).toBe('reviewed')
  })

  it('is idempotent for the same clientKey and CAS-guarded for stale revisions', async () => {
    const seed = await seedDiagnosticTicket(db)
    const clientKey = crypto.randomUUID()
    const first = await saveReviewedCustomerStory(db, reviewInput(seed, { clientKey }))
    expect(first.ok).toBe(true)

    const replay = await saveReviewedCustomerStory(db, reviewInput(seed, { clientKey }))
    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error('expected ok')
    expect(replay.changed).toBe(false)
    expect(replay.storyRevision).toBe(1)

    const stale = await saveReviewedCustomerStory(
      db,
      reviewInput(seed, { expectedStoryRevision: 0 }),
    )
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('expected conflict')
    expect(stale.error).toBe('conflict')

    const reEdit = await saveReviewedCustomerStory(
      db,
      reviewInput(seed, {
        expectedStoryRevision: 1,
        whatWeFound: 'Ground strap corroded through; battery cables OK.',
      }),
    )
    expect(reEdit.ok).toBe(true)
    if (!reEdit.ok) throw new Error('expected ok')
    expect(reEdit.storyRevision).toBe(2)
  })

  it('rejects non-diagnostic sessionless jobs as not_found (unchanged behavior)', async () => {
    const seed = await seedDiagnosticTicket(db)
    const [repairJob] = await db.insert(ticketJobs).values({
      shopId: seed.shop.id,
      ticketId: seed.ticket.id,
      title: 'Replace strap',
      kind: 'repair',
      requiredSkillTier: 1,
    }).returning()
    const result = await saveReviewedCustomerStory(db, {
      ...reviewInput(seed),
      jobId: repairJob.id,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toBe('not_found')
  })

  it('reuses the existing manual line entry: draft lines land on the sessionless diagnostic job', async () => {
    const seed = await seedDiagnosticTicket(db)
    const created = await createDraftLine(db, {
      actor: { profileId: seed.profile.id },
      ticketId: seed.ticket.id,
      jobId: seed.job.id,
      clientKey: crypto.randomUUID(),
      body: {
        kind: 'labor',
        description: 'Trace and repair ground fault',
        taxable: false,
        laborHours: '1.5',
      },
    })
    expect(created.ok).toBe(true)
    const lines = await db.select().from(jobLines).where(and(
      eq(jobLines.shopId, seed.shop.id),
      eq(jobLines.jobId, seed.job.id),
    ))
    expect(lines).toHaveLength(1)
    expect(lines[0].source).toBe('manual')
  })

  describe('storyMode in the quote builder', () => {
    it('offers authorization-only scope before an entitled shop records findings', async () => {
      const seed = await seedDiagnosticTicket(db)
      // No entitlement row: DIAGNOSTICS_DEFAULT_UNTIL_PRICED keeps the shop entitled.
      const builder = await getQuoteBuilder(db, {
        actor: { profileId: seed.profile.id },
        ticketId: seed.ticket.id,
      })
      expect(builder.ok).toBe(true)
      if (!builder.ok) throw new Error('expected ok')
      expect(builder.builder.jobs[0].storyMode).toBe('authorization_only')
    })

    it('offers authorization-only scope before an unentitled shop records findings', async () => {
      const seed = await seedDiagnosticTicket(db)
      await db.insert(shopEntitlements).values({
        shopId: seed.shop.id,
        diagnostics: false,
      })
      const builder = await getQuoteBuilder(db, {
        actor: { profileId: seed.profile.id },
        ticketId: seed.ticket.id,
      })
      expect(builder.ok).toBe(true)
      if (!builder.ok) throw new Error('expected ok')
      expect(builder.builder.jobs[0].storyMode).toBe('authorization_only')
    })

    it('keeps comp actors entitled even when the shop row says false', async () => {
      const seed = await seedDiagnosticTicket(db)
      await db.insert(shopEntitlements).values({
        shopId: seed.shop.id,
        diagnostics: false,
      })
      await db.update(profiles).set({ isComp: true })
        .where(eq(profiles.id, seed.profile.id))
      const builder = await getQuoteBuilder(db, {
        actor: { profileId: seed.profile.id },
        ticketId: seed.ticket.id,
      })
      expect(builder.ok).toBe(true)
      if (!builder.ok) throw new Error('expected ok')
      expect(builder.builder.jobs[0].storyMode).toBe('authorization_only')
    })

    it('parses the saved manual findings story into the builder projection', async () => {
      const seed = await seedDiagnosticTicket(db)
      await db.insert(shopEntitlements).values({
        shopId: seed.shop.id,
        diagnostics: false,
      })
      const saved = await saveReviewedCustomerStory(db, reviewInput(seed))
      expect(saved.ok).toBe(true)
      const builder = await getQuoteBuilder(db, {
        actor: { profileId: seed.profile.id },
        ticketId: seed.ticket.id,
      })
      expect(builder.ok).toBe(true)
      if (!builder.ok) throw new Error('expected ok')
      const job = builder.builder.jobs[0]
      expect(job.story.source).toBe('manual')
      expect(job.story.reviewStatus).toBe('reviewed')
      expect(job.story.content?.whatWeFound)
        .toBe('Corroded ground strap at the engine block.')
    })
  })
})
