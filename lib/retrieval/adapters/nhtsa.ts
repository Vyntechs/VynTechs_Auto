import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

export class NHTSAAdapter implements RetrievalAdapter {
  id = 'nhtsa'
  weight = 0.9

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(ctx.vehicleMake)}&model=${encodeURIComponent(ctx.vehicleModel)}&modelYear=${ctx.vehicleYear}`
    const res = await fetch(url, { signal })
    if (!res.ok) return []
    const json = (await res.json()) as { Count: number; Results?: Array<Record<string, string>> }
    return (json.Results ?? []).map(r => ({
      source: this.id,
      url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.NHTSACampaignNumber}`,
      title: `Recall ${r.NHTSACampaignNumber}: ${r.Component}`,
      snippet: `${r.Summary}\n\nConsequence: ${r.Consequence}\n\nRemedy: ${r.Remedy}`,
      publishedAt: parseUSDate(r.ReportReceivedDate),
      weightHint: 0.9,
      raw: r,
    }))
  }
}

function parseUSDate(s?: string): string | undefined {
  if (!s) return undefined
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined
}
