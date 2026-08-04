import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  customers,
  jobLines,
  profiles,
  quoteSends,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  createQuoteVersion,
  deleteDraftLine,
  getQuoteBuilder,
  replaceDraftLine,
} from '@/lib/shop-os/quotes'
import { createTestDb } from '@/tests/helpers/db'
import {
  CANONICAL_QUOTE_COMMITMENT_BASE_URL,
  assertQuoteCommitmentHarnessSafety,
} from '@/tests/e2e/quote-composition-commitment-harness/safety.mjs'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('quote composition commitment proof harness safety', () => {
  it('accepts only the exact secret-free loopback envelope', () => {
    expect(assertQuoteCommitmentHarnessSafety({}, CANONICAL_QUOTE_COMMITMENT_BASE_URL)).toEqual({
      baseUrl: CANONICAL_QUOTE_COMMITMENT_BASE_URL,
      loopback: true,
      productionVercelMode: false,
      forbiddenEnvironmentPresent: false,
    })
  })

  it.each([
    'DATABASE_URL',
    'DATABASE_URL_DIRECT',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ])('rejects presence of %s without reading or echoing its value', (name) => {
    const sentinel = 'must-not-appear-in-error'
    let message = ''
    try {
      assertQuoteCommitmentHarnessSafety({ [name]: sentinel })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(name)
    expect(message).not.toContain(sentinel)
  })

  it('rejects production mode and every noncanonical URL', () => {
    expect(() => assertQuoteCommitmentHarnessSafety({ VERCEL_ENV: 'production' }))
      .toThrow(/production Vercel mode/)
    for (const url of [
      'http://localhost:4182',
      'http://127.0.0.1:4181',
      'https://127.0.0.1:4182',
      'https://preview.example.invalid',
    ]) {
      expect(() => assertQuoteCommitmentHarnessSafety({}, url))
        .toThrow(/canonical loopback URL/)
    }
  })
})

describe('PGlite persistence half of quote composition commitment proof', () => {
  it('binds exact money and revisions through V1/V2 while stale actors mutate nothing', async () => {
    const fixture = await createTestDb()
    try {
      const [shop, otherShop] = await fixture.db.insert(shops).values([
        { name: 'Quote proof', laborRateCents: 15_000, taxRateBps: 825 },
        { name: 'Other tenant', laborRateCents: 20_000, taxRateBps: 700 },
      ]).returning()
      await fixture.db.insert(profiles).values([
        { id: uuid(1), userId: uuid(101), shopId: shop.id, role: 'advisor' },
        { id: uuid(2), userId: uuid(102), shopId: shop.id, role: 'tech' },
        { id: uuid(3), userId: uuid(103), shopId: otherShop.id, role: 'owner' },
      ])
      await fixture.db.insert(customers).values({
        id: uuid(10), shopId: shop.id, name: 'Marisol Vega', phone: '2145550197',
      })
      await fixture.db.insert(vehicles).values({
        id: uuid(11), customerId: uuid(10), year: 2019, make: 'Ford', model: 'F-150',
      })
      await fixture.db.insert(tickets).values({
        id: uuid(20), shopId: shop.id, ticketNumber: 42, source: 'counter',
        customerId: uuid(10), vehicleId: uuid(11), concern: 'Brake vibration',
        createdByProfileId: uuid(1),
      })
      await fixture.db.insert(ticketJobs).values({
        id: uuid(30), shopId: shop.id, ticketId: uuid(20), title: 'Replace front brakes',
        kind: 'repair', requiredSkillTier: 2,
      })
      await fixture.db.insert(jobLines).values([
        {
          id: uuid(40), shopId: shop.id, jobId: uuid(30), kind: 'part',
          description: 'Front pad set', sort: 10, quantity: 1, priceCents: 12_000,
          taxable: true, partNumber: 'PAD-1', brand: 'ACME', fitment: 'Front axle',
          source: 'manual', createdAt: new Date('2026-08-04T12:00:00.000Z'),
          updatedAt: new Date('2026-08-04T12:00:00.000Z'),
        },
        {
          id: uuid(41), shopId: shop.id, jobId: uuid(30), kind: 'labor',
          description: 'Brake labor', sort: 20, quantity: 1, priceCents: 18_750,
          taxable: false, laborHours: 1.25, laborRateCents: 15_000,
          source: 'manual', createdAt: new Date('2026-08-04T12:00:00.000Z'),
          updatedAt: new Date('2026-08-04T12:00:00.000Z'),
        },
        {
          id: uuid(42), shopId: shop.id, jobId: uuid(30), kind: 'fee',
          description: 'Shop supplies', sort: 30, quantity: 1, priceCents: 500,
          taxable: true, source: 'manual',
          createdAt: new Date('2026-08-04T12:00:00.000Z'),
          updatedAt: new Date('2026-08-04T12:00:00.000Z'),
        },
      ])

      const actor = { profileId: uuid(1) }
      const secondActor = { profileId: uuid(2) }
      const outsider = { profileId: uuid(3) }
      await expect(getQuoteBuilder(fixture.db, { actor: outsider, ticketId: uuid(20) }))
        .resolves.toEqual({ ok: false, error: 'not_found' })

      const draft = await getQuoteBuilder(fixture.db, { actor, ticketId: uuid(20) })
      expect(draft).toMatchObject({
        ok: true,
        builder: {
          draftCommitment: {
            totalCents: 32_281,
            jobCount: 1,
            lineCount: 3,
          },
        },
      })
      if (!draft.ok || !draft.builder.draftCommitment) {
        throw new Error('quote proof draft commitment unavailable')
      }
      const v1Fingerprint = draft.builder.draftCommitment.fingerprint
      const [firstPrepare, replayPrepare] = await Promise.all([
        createQuoteVersion(fixture.db, {
          actor, ticketId: uuid(20), expectedDraftFingerprint: v1Fingerprint,
        }),
        createQuoteVersion(fixture.db, {
          actor: secondActor, ticketId: uuid(20), expectedDraftFingerprint: v1Fingerprint,
        }),
      ])
      expect([firstPrepare, replayPrepare].filter((result) => result.ok && result.changed))
        .toHaveLength(1)
      expect([firstPrepare, replayPrepare].filter((result) => result.ok && !result.changed))
        .toHaveLength(1)
      const v1 = [firstPrepare, replayPrepare].find((result) => result.ok)?.version
      if (!v1) throw new Error('quote proof V1 unavailable')
      expect(await fixture.db.select().from(quoteVersions)).toHaveLength(1)
      expect((await fixture.db.select().from(quoteVersions))[0].snapshot).toMatchObject({
        totals: {
          subtotalCents: 31_250,
          taxableSubtotalCents: 12_500,
          taxCents: 1_031,
          totalCents: 32_281,
        },
      })

      const sentAt = new Date('2026-08-04T12:30:00.000Z')
      await fixture.db.insert(quoteSends).values({
        shopId: shop.id,
        ticketId: uuid(20),
        quoteVersionId: v1.id,
        customerId: uuid(10),
        subjectKey: uuid(10),
        destinationFingerprint: 'a'.repeat(64),
        fingerprintKeyVersion: 'link_v1',
        channel: 'link',
        tokenHash: 'b'.repeat(64),
        tokenExpiresAt: new Date('2026-08-05T12:30:00.000Z'),
        requestingActorProfileId: uuid(1),
        requestKey: uuid(90),
        requestFingerprint: 'c'.repeat(64),
        state: 'submitted',
        submittingAt: sentAt,
        submittedAt: sentAt,
        createdAt: sentAt,
        updatedAt: sentAt,
      })

      const prepared = await getQuoteBuilder(fixture.db, { actor, ticketId: uuid(20) })
      if (!prepared.ok) throw new Error('prepared quote proof unavailable')
      const originalLine = prepared.builder.jobs[0].lines.find((line) => line.id === uuid(40))
      if (!originalLine?.lineFingerprint) throw new Error('line fingerprint unavailable')
      const staleLineFingerprint = originalLine.lineFingerprint
      const correctedBody = {
        kind: 'part' as const,
        description: 'Front pads and hardware',
        quantity: '1',
        priceCents: 13_000,
        taxable: true,
        partNumber: 'PAD-1',
        brand: 'ACME',
        unitCostCents: null,
        coreChargeCents: null,
        fitment: 'Front axle',
      }
      await expect(replaceDraftLine(fixture.db, {
        actor,
        ticketId: uuid(20),
        jobId: uuid(30),
        lineId: uuid(40),
        expectedLineFingerprint: staleLineFingerprint,
        body: correctedBody,
      })).resolves.toMatchObject({ ok: true, changed: true })
      expect((await fixture.db.select().from(quoteVersions))[0].supersededAt)
        .toBeInstanceOf(Date)
      expect((await fixture.db.select().from(quoteSends))[0]).toMatchObject({
        state: 'expired', tokenHash: null, tokenExpiresAt: null,
      })

      const afterCorrection = {
        lines: await fixture.db.select().from(jobLines),
        versions: await fixture.db.select().from(quoteVersions),
        links: await fixture.db.select().from(quoteSends),
      }
      await expect(replaceDraftLine(fixture.db, {
        actor,
        ticketId: uuid(20),
        jobId: uuid(30),
        lineId: uuid(40),
        expectedLineFingerprint: staleLineFingerprint,
        body: correctedBody,
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      await expect(deleteDraftLine(fixture.db, {
        actor,
        ticketId: uuid(20),
        jobId: uuid(30),
        lineId: uuid(40),
        expectedLineFingerprint: staleLineFingerprint,
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      await expect(createQuoteVersion(fixture.db, {
        actor,
        ticketId: uuid(20),
        expectedDraftFingerprint: v1Fingerprint,
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      expect({
        lines: await fixture.db.select().from(jobLines),
        versions: await fixture.db.select().from(quoteVersions),
        links: await fixture.db.select().from(quoteSends),
      }).toEqual(afterCorrection)

      const revised = await getQuoteBuilder(fixture.db, { actor, ticketId: uuid(20) })
      expect(revised).toMatchObject({
        ok: true,
        builder: {
          activeVersion: null,
          lastPreparedVersion: { versionNumber: 1, state: 'superseded', totalCents: 32_281 },
          draftCommitment: { totalCents: 33_364 },
        },
      })
      if (!revised.ok || !revised.builder.draftCommitment) {
        throw new Error('revised quote proof unavailable')
      }
      await expect(createQuoteVersion(fixture.db, {
        actor,
        ticketId: uuid(20),
        expectedDraftFingerprint: revised.builder.draftCommitment.fingerprint,
      })).resolves.toMatchObject({
        ok: true,
        changed: true,
        version: { versionNumber: 2 },
      })

      const versions = await fixture.db.select().from(quoteVersions)
      expect(versions).toHaveLength(2)
      expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2])
      expect((versions.find((version) => version.versionNumber === 1)?.snapshot as {
        totals: { totalCents: number }
      }).totals.totalCents).toBe(32_281)
      expect((versions.find((version) => version.versionNumber === 2)?.snapshot as {
        totals: { totalCents: number }
      }).totals.totalCents).toBe(33_364)
      await expect(fixture.db.update(quoteVersions)
        .set({ snapshot: { corrupted: true } })
        .where(eq(quoteVersions.id, v1.id))).rejects.toThrow()
    } finally {
      await fixture.close()
    }
  })
})
