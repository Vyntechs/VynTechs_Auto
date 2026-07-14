export function isDesktopIntakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'
}

// Gates DRAFT-ONLY cold-case system-data generation in the intake route AND
// inside executePipeline. OFF by default — when unset/!= 'true' no research run
// fires and no system_data_draft write occurs. Apply migration 0025 to the prod
// project (ynmtszuybeenjbigxdyl) before setting this to 'true' in prod.
export function isColdCaseSynthesisEnabled(): boolean {
  return process.env.COLD_CASE_SYNTHESIS_ENABLED === 'true'
}

export function isAdaptiveCanvasEnabled(): boolean {
  return process.env.SHOP_OS_ADAPTIVE_CANVAS_ENABLED === 'true'
}

// Gates the read-only SYNTHETIC Evidence-Receipt preview inside the existing
// diagnostic-job action slot (wedge decision, receipt lane gate 3). OFF by
// default — when unset/!= 'true' the entire preview is invisible and nothing
// changes for anyone. Server-side only: resolved in app/(app)/today/page.tsx
// and passed down as a prop; also requires the shop's diagnostics
// entitlement (hasDiagnostics) at the consuming slot.
export function isEvidenceReceiptPreviewEnabled(): boolean {
  return process.env.EVIDENCE_RECEIPT_PREVIEW === 'true'
}
