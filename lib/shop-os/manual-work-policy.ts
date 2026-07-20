export function canUseManualWork(input: {
  kind: string
  sessionId: string | null
  diagnosticsEntitled: boolean
}): boolean {
  if (input.sessionId !== null) return false
  if (input.kind === 'repair' || input.kind === 'maintenance') return true
  return input.kind === 'diagnostic' && !input.diagnosticsEntitled
}
