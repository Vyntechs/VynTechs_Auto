export const SHOP_ROLES = ['tech', 'advisor', 'parts', 'owner'] as const

export type ShopRole = (typeof SHOP_ROLES)[number]

export function isShopRole(role: unknown): role is ShopRole {
  return typeof role === 'string' && SHOP_ROLES.includes(role as ShopRole)
}

export function canCreateTickets(role: string | null | undefined): boolean {
  return isShopRole(role)
}

export function canBuildQuotes(role: string | null | undefined): boolean {
  return isShopRole(role)
}

export function canSendQuotes(role: string | null | undefined): boolean {
  return role === 'advisor' || role === 'owner'
}

export const canRecordCustomerApproval = canSendQuotes
export const canCloseTickets = canSendQuotes
export const canAssignWork = canSendQuotes

export function canPlacePartsOrders(role: string | null | undefined): boolean {
  return role === 'parts' || role === 'advisor' || role === 'owner'
}

export function canManageTeam(
  role: string | null | undefined,
  founderOverride = false,
): boolean {
  return founderOverride || role === 'owner'
}

export function canManageCustomerMessaging(
  role: string | null | undefined,
): boolean {
  return role === 'advisor' || role === 'owner'
}

export function canManageMessagingRetention(
  role: string | null | undefined,
  founderOverride = false,
): boolean {
  return founderOverride || role === 'owner'
}

export const canManageRates = canManageTeam
export const canManageIntegrations = canManageTeam
