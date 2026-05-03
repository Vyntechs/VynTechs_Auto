import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

const FORUM_DOMAINS = [
  'f150forum.com', 'ecoboost.net', 'mustang6g.com', 'tacomaworld.com',
  'bimmerforums.com', 'bimmerfest.com', 'audiworld.com', 'audizine.com',
  'subaruoutback.org', 'nasioc.com', 'rx7club.com',
  'silveradosierra.com', 'tundras.com', '4runners.com', 'priuschat.com',
]

export class ForumAdapter implements RetrievalAdapter {
  id = 'forum'
  weight = 0.6

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY
    if (!apiKey) return []
    const q = `${ctx.vehicleYear} ${ctx.vehicleMake} ${ctx.vehicleModel}${
      ctx.vehicleEngine ? ` ${ctx.vehicleEngine}` : ''
    } ${ctx.dtcs?.join(' ') ?? ''} ${ctx.complaintText}`.trim()
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`
    const res = await fetch(url, {
      signal,
      headers: { accept: 'application/json', 'x-subscription-token': apiKey },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } }
    return (json.web?.results ?? [])
      .filter(r => FORUM_DOMAINS.some(d => r.url.includes(d)))
      .slice(0, 5)
      .map(r => ({
        source: this.id,
        url: r.url,
        title: r.title,
        snippet: r.description,
        weightHint: 0.6,
      }))
  }
}
