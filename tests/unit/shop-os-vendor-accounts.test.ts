import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { profiles, shops, vendorAccounts } from '@/lib/db/schema'
import {
  createManualVendorAccount,
  listVendorAccounts,
  updateManualVendorAccount,
  vendorAccountActorFromProfile,
  vendorAccountDomainStatus,
  vendorAccountErrorBody,
  type VendorAccountActor,
} from '@/lib/shop-os/parts'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS manual vendor accounts', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let actor: VendorAccountActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North' },
      { name: 'South' },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'owner' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'tech' },
      { id: uuid(3), userId: uuid(103), shopId, role: 'parts' },
      { id: uuid(4), userId: uuid(104), shopId, role: 'founder' },
      { id: uuid(5), userId: uuid(105), shopId: otherShopId, role: 'owner' },
    ])
    actor = vendorAccountActorFromProfile({ id: uuid(1) })
  })

  afterEach(async () => close())

  const create = (overrides: Record<string, unknown> = {}, actorOverride = actor) =>
    createManualVendorAccount(db, {
      actor: actorOverride,
      clientKey: uuid(50),
      body: { displayName: '  Main Street Parts  ', ...overrides },
    })

  it('allows all active quote builders to list enabled manual accounts but gates scope=all to integration managers', async () => {
    const enabled = await create()
    const disabled = await createManualVendorAccount(db, {
      actor, clientKey: uuid(51), body: { displayName: 'Disabled supplier' },
    })
    if (!disabled.ok) throw new Error('create failed')
    await updateManualVendorAccount(db, {
      actor, vendorAccountId: disabled.vendorAccount.id,
      body: { displayName: 'Disabled supplier', enabled: false, expectedUpdatedAt: disabled.vendorAccount.updatedAt },
    })

    for (const profileId of [uuid(1), uuid(2), uuid(3)]) {
      await expect(listVendorAccounts(db, { actor: { profileId }, scope: 'enabled' }))
        .resolves.toEqual({ ok: true, vendorAccounts: [enabled.ok ? enabled.vendorAccount : null] })
    }
    await expect(listVendorAccounts(db, { actor: { profileId: uuid(2) }, scope: 'all' }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(listVendorAccounts(db, { actor, scope: 'all' })).resolves.toMatchObject({
      ok: true,
      vendorAccounts: [
        { displayName: 'Disabled supplier', enabled: false },
        { displayName: 'Main Street Parts', enabled: true },
      ],
    })
  })

  it('allows only integration managers to create or update, including an explicit trusted founder override', async () => {
    await expect(create({}, { profileId: uuid(2) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({}, { profileId: uuid(4), founderOverride: false })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({ displayName: 'Founder supplier' }, { profileId: uuid(4), founderOverride: true }))
      .resolves.toMatchObject({ ok: true, changed: true })
  })

  it('forces the complete manual account truth and returns only the safe five-field projection', async () => {
    const result = await create()
    expect(result).toEqual({
      ok: true,
      changed: true,
      vendorAccount: {
        id: uuid(50),
        displayName: 'Main Street Parts',
        mode: 'manual',
        enabled: true,
        updatedAt: expect.stringMatching(/Z$/),
      },
    })
    const [stored] = await db.select().from(vendorAccounts).where(eq(vendorAccounts.id, uuid(50)))
    expect(stored).toMatchObject({
      id: uuid(50), shopId, vendor: 'manual', displayName: 'Main Street Parts',
      mode: 'manual', nonSecretConfig: {}, secretRef: null, enabled: true,
    })
    expect(JSON.stringify(result)).not.toMatch(/shopId|nonSecretConfig|secretRef|createdAt|credential|token/)
  })

  it('uses tenant-bound client keys for exact normalized replay and rejects changed or cross-tenant reuse', async () => {
    const first = await create()
    const retry = await create({ displayName: 'Main Street Parts' })
    const changed = await create({ displayName: 'Different supplier' })
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(retry).toEqual({ ...(first as Extract<typeof first, { ok: true }>), changed: false })
    expect(changed).toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(create({ displayName: 'Other tenant' }, { profileId: uuid(5) }))
      .resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('CAS-updates only display and enabled, supports exact delayed replay, and rejects stale changed intent', async () => {
    const created = await create()
    if (!created.ok) throw new Error('create failed')
    const updated = await updateManualVendorAccount(db, {
      actor,
      vendorAccountId: created.vendorAccount.id,
      body: { displayName: 'Warehouse account', enabled: false, expectedUpdatedAt: created.vendorAccount.updatedAt },
    })
    expect(updated).toMatchObject({ ok: true, changed: true, vendorAccount: { displayName: 'Warehouse account', enabled: false } })
    if (!updated.ok) throw new Error('update failed')
    expect(updated.vendorAccount.updatedAt).not.toBe(created.vendorAccount.updatedAt)

    await expect(updateManualVendorAccount(db, {
      actor,
      vendorAccountId: created.vendorAccount.id,
      body: { displayName: ' Warehouse account ', enabled: false, expectedUpdatedAt: created.vendorAccount.updatedAt },
    })).resolves.toEqual({ ...updated, changed: false })
    await expect(updateManualVendorAccount(db, {
      actor,
      vendorAccountId: created.vendorAccount.id,
      body: { displayName: 'Stale different change', enabled: false, expectedUpdatedAt: created.vendorAccount.updatedAt },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('reauthorizes active membership on every operation and keeps tenant identities private', async () => {
    const other = await createManualVendorAccount(db, {
      actor: { profileId: uuid(5) }, clientKey: uuid(60), body: { displayName: 'South supplier' },
    })
    if (!other.ok) throw new Error('create failed')
    await expect(updateManualVendorAccount(db, {
      actor, vendorAccountId: other.vendorAccount.id,
      body: { displayName: 'Probe', enabled: true, expectedUpdatedAt: other.vendorAccount.updatedAt },
    })).resolves.toEqual({ ok: false, error: 'not_found' })

    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null })
      .where(eq(profiles.id, uuid(1)))
    await expect(listVendorAccounts(db, { actor, scope: 'enabled' })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({ displayName: 'Blocked' })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects hostile input and fails closed on corrupted persisted manual truth', async () => {
    for (const [index, body] of [
      {},
      { displayName: '' },
      { displayName: 'x'.repeat(121) },
      { displayName: 'Supplier', vendor: 'oreilly' },
      { displayName: 'Supplier', mode: 'api' },
      { displayName: 'Supplier', config: {} },
      { displayName: 'Supplier', nonSecretConfig: {} },
      { displayName: 'Supplier', secretRef: 'env:SECRET' },
      { displayName: 'Supplier', credentials: 'secret' },
      { displayName: 'Supplier', enabled: false },
    ].entries()) {
      await expect(createManualVendorAccount(db, { actor, clientKey: uuid(100 + index), body }))
        .resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    await expect(createManualVendorAccount(db, { actor, clientKey: 'bad', body: { displayName: 'Supplier' } }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(listVendorAccounts(db, { actor, scope: 'hostile' as never }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })

    await db.insert(vendorAccounts).values({
      id: uuid(90), shopId, vendor: 'manual', displayName: 'Corrupt', mode: 'manual',
      nonSecretConfig: { leaked: true }, enabled: true,
    })
    await expect(listVendorAccounts(db, { actor, scope: 'enabled' }))
      .resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('maps domain failures without adding internal context', () => {
    expect(vendorAccountDomainStatus({ ok: false, error: 'invalid_input' })).toBe(422)
    expect(vendorAccountDomainStatus({ ok: false, error: 'not_found' })).toBe(404)
    expect(vendorAccountDomainStatus({ ok: false, error: 'conflict', retryable: false })).toBe(409)
    expect(vendorAccountErrorBody({ ok: false, error: 'conflict', retryable: false })).toEqual({ error: 'conflict' })
  })
})
