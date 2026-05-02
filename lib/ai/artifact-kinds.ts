import type { Artifact } from '../db/schema'

type CaptureKind = Artifact['kind']

/** Kinds that receive full AI extraction inline after capture. */
export const HIGH_SIGNAL_KINDS = new Set<CaptureKind>(['scan_screen', 'wiring_diagram', 'audio'])
