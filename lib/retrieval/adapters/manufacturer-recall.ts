import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

const MAKER_SEARCH: Record<string, (ctx: RetrievalContext) => string> = {
  ford: ctx => `https://www.ford.com/support/recalls/?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
  chevrolet: ctx => `https://my.chevrolet.com/owner-center/recalls?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
  toyota: ctx => `https://www.toyota.com/recall?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
  bmw: ctx => `https://www.bmwusa.com/recalls.html?model=${encodeURIComponent(ctx.vehicleModel)}&year=${ctx.vehicleYear}`,
}

export class ManufacturerRecallAdapter implements RetrievalAdapter {
  id = 'manufacturer-recall'
  weight = 0.85

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const make = ctx.vehicleMake.toLowerCase()
    const builder = MAKER_SEARCH[make]
    if (!builder) return []
    const url = builder(ctx)
    let html: string
    try {
      const res = await fetch(url, { signal, headers: { 'user-agent': 'Mozilla/5.0 Vyntechs/1.0' } })
      if (!res.ok) return []
      html = await res.text()
    } catch {
      return []
    }
    return parseRecallSummaries(html, url).slice(0, 5)
  }
}

function parseRecallSummaries(html: string, baseUrl: string): RetrievalResult[] {
  const results: RetrievalResult[] = []
  const sections = html.split(/<(h1|h2|h3)[^>]*>/i)
  for (let i = 1; i < sections.length; i += 2) {
    const heading = stripTags(sections[i + 1] ?? '').slice(0, 200)
    if (!/recall|tsb|bulletin/i.test(heading)) continue
    const summary = extractFollowingParagraph(sections[i + 1] ?? '')
    if (!summary) continue
    results.push({
      source: 'manufacturer-recall',
      url: baseUrl,
      title: heading.trim(),
      snippet: summary.trim(),
      weightHint: 0.85,
    })
  }
  return results
}

function extractFollowingParagraph(s: string): string {
  const m = s.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  return m ? stripTags(m[1]) : ''
}

function stripTags(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
