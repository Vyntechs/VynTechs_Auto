// The meter-hookup primitives. Exactly one shows per step (the engine picks).
// scope-clip is DEFERRED in v1 → a labeled stub, never a waveform.
//
// Canonical overlay vocabulary is frozen in C3 (Wave 0). Import, never re-declare.
// (R4) Net: there is exactly ONE OverlayKind union in the codebase — C3's.
export { ALL_OVERLAY_KINDS as OVERLAY_KINDS } from '@/lib/diagnostics/diagram/slot-interface'
export type { OverlayKind } from '@/lib/diagnostics/diagram/slot-interface'
