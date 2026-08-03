export type DiagnosticsRelease = 'off' | 'legacy'
export type OperationalMediaRelease = 'off'

export const OPERATIONAL_MEDIA_UNAVAILABLE = {
  status: 404,
  body: { error: 'not_available' },
} as const

export const CUSTOMER_APPROVAL_UNAVAILABLE = {
  status: 404,
  body: { error: 'unavailable' },
} as const

export function getDiagnosticsRelease(): DiagnosticsRelease {
  if (process.env.NODE_ENV === 'production') return 'off'
  return process.env.DIAGNOSTICS_RELEASE === 'legacy' ? 'legacy' : 'off'
}

export function isDiagnosticsReleaseEnabled(): boolean {
  return getDiagnosticsRelease() === 'legacy'
}

export function getOperationalMediaRelease(): OperationalMediaRelease {
  return 'off'
}

export function isOperationalMediaEnabled(): false {
  return false
}

export function isCustomerApprovalEnabled(): boolean {
  return process.env.SHOP_OS_CUSTOMER_APPROVAL_ENABLED === 'true'
}
