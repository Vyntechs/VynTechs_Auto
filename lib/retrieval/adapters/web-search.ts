import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'
import { buildSearchQuery } from '../query-builder'

/**
 * General-web search adapter via Tavily (https://tavily.com).
 *
 * Complements the source-specific adapters (NHTSA, recall, forum, reddit, youtube)
 * by surfacing broad consensus across the open web — repair shop blogs, OEM
 * service info that's been re-published, YouTube descriptions, parts-supplier
 * write-ups, etc.
 *
 * Weight 0.5 — lower than NHTSA (0.9, official) and the manufacturer recall
 * adapter, similar to forum (0.6). Authoritative sources still win when present.
 *
 * The query passed to Tavily is built via buildSearchQuery — vehicle metadata
 * + DTCs + stopword-stripped symptom terms — instead of the raw complaint
 * sentence. This is what makes "TCC shudder" articles surface against a
 * complaint like "the truck shakes and vibrates at tip in."
 */
export class WebSearchAdapter implements RetrievalAdapter {
  id = 'web-search'
  weight = 0.5

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) return []

    const q = buildSearchQuery(ctx)

    const res = await fetch('https://api.tavily.com/search', {
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: q,
        search_depth: 'basic',
        max_results: 10,
        include_answer: false,
        include_raw_content: false,
      }),
    })
    if (!res.ok) return []

    const json = (await res.json()) as {
      results?: Array<{ title: string; url: string; content: string; score?: number }>
    }
    return (json.results ?? []).slice(0, 8).map((r) => ({
      source: this.id,
      url: r.url,
      title: r.title,
      snippet: r.content,
      weightHint:
        typeof r.score === 'number' ? Math.min(0.9, Math.max(0.3, r.score)) : 0.5,
    }))
  }
}
