// At MVP, the founder is both shop owner and curator — the same human runs
// the calibration loop and signs off on suggestions. Owners and curators both
// pass the curator gate; everyone else (techs, undefined) is redirected.
export function canCurate(role: string | null | undefined): boolean {
  return role === 'curator' || role === 'owner'
}
