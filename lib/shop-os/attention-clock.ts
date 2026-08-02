const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export type AttentionClock = {
  label: string
  tier: 'normal' | 'stale'
}

export function formatAttentionClock(
  attentionAt: string,
  nowMs: number,
): AttentionClock | null {
  const attentionMs = Date.parse(attentionAt)
  if (!Number.isFinite(attentionMs) || !Number.isFinite(nowMs)) return null

  const elapsedMs = Math.max(0, nowMs - attentionMs)
  const tier = elapsedMs >= DAY_MS ? 'stale' : 'normal'

  if (elapsedMs < MINUTE_MS) return { label: 'Quiet now', tier }
  if (elapsedMs < HOUR_MS) {
    return { label: `Quiet ${Math.floor(elapsedMs / MINUTE_MS)}m`, tier }
  }
  if (elapsedMs < DAY_MS) {
    return { label: `Quiet ${Math.floor(elapsedMs / HOUR_MS)}h`, tier }
  }
  return { label: `Quiet ${Math.floor(elapsedMs / DAY_MS)}d`, tier }
}
