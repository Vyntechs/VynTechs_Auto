// lib/retrieval/types.ts
export type RetrievalContext = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  dtcs?: string[]
  symptomTags?: string[]
  complaintText: string
  observation?: string
}

export type RetrievalResult = {
  source: string
  url?: string
  title: string
  snippet: string
  publishedAt?: string
  weightHint?: number
  raw?: unknown
}

export type Budget = {
  maxQueries: number
  maxWallClockMs: number
  maxTokens: number
}

export const DEFAULT_BUDGET: Budget = { maxQueries: 5, maxWallClockMs: 30_000, maxTokens: 50_000 }

export interface RetrievalAdapter {
  id: string
  weight: number
  query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]>
}
