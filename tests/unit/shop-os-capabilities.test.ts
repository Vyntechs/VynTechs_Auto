import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { profiles } from '@/lib/db/schema'
import {
  canAssignWork,
  canBuildQuotes,
  canCloseTickets,
  canCreateTickets,
  canManageCustomerMessaging,
  canManageMessagingRetention,
  canManageTeam,
  canPlacePartsOrders,
  canSendQuotes,
} from '@/lib/shop-os/capabilities'

describe('Shop OS role capabilities', () => {
  it('declares a durable pending-to-active membership lifecycle', () => {
    expect(getTableColumns(profiles)).toMatchObject({
      membershipStatus: expect.anything(),
      membershipActivatedAt: expect.anything(),
    })
  })

  it('keeps create and quote-build universal across shop roles', () => {
    for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
      expect(canCreateTickets(role)).toBe(true)
      expect(canBuildQuotes(role)).toBe(true)
    }
  })

  it('grants counter and closeout authority only to advisor and owner', () => {
    expect(['tech', 'parts', 'advisor', 'owner'].map(canSendQuotes)).toEqual([
      false,
      false,
      true,
      true,
    ])
    expect(['tech', 'parts', 'advisor', 'owner'].map(canCloseTickets)).toEqual([
      false,
      false,
      true,
      true,
    ])
    expect(['tech', 'parts', 'advisor', 'owner'].map(canAssignWork)).toEqual([
      false,
      false,
      true,
      true,
    ])
  })

  it('grants parts ordering to parts, advisor, and owner', () => {
    expect(['tech', 'parts', 'advisor', 'owner'].map(canPlacePartsOrders)).toEqual([
      false,
      true,
      true,
      true,
    ])
  })

  it('keeps team authority owner-only while founder override stays explicit', () => {
    expect(canManageTeam('owner')).toBe(true)
    expect(canManageTeam('advisor')).toBe(false)
    expect(canManageTeam('curator')).toBe(false)
    expect(canManageTeam('curator', true)).toBe(true)
  })

  it('limits customer messaging management to advisors and owners', () => {
    expect(['tech', 'parts', 'advisor', 'owner'].map(canManageCustomerMessaging)).toEqual([
      false,
      false,
      true,
      true,
    ])
  })

  it('keeps messaging retention owner-only while founder override stays explicit', () => {
    expect(canManageMessagingRetention('owner')).toBe(true)
    expect(canManageMessagingRetention('advisor')).toBe(false)
    expect(canManageMessagingRetention('curator')).toBe(false)
    expect(canManageMessagingRetention('curator', true)).toBe(true)
  })
})
