import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

export class YouTubeAdapter implements RetrievalAdapter {
  id = 'youtube'
  weight = 0.55

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const key = process.env.YOUTUBE_API_KEY
    if (!key) return []
    const q = `${ctx.vehicleYear} ${ctx.vehicleMake} ${ctx.vehicleModel} ${ctx.dtcs?.join(' ') ?? ''} ${ctx.complaintText}`.trim()
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(q)}&key=${key}`
    const res = await fetch(searchUrl, { signal })
    if (!res.ok) return []
    const json = (await res.json()) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; description: string; channelTitle: string } }> }
    const items = json.items ?? []

    const results: RetrievalResult[] = []
    for (const item of items) {
      let transcriptSnippet = item.snippet.description
      try {
        const ttUrl = `https://video.google.com/timedtext?lang=en&v=${item.id.videoId}`
        const tr = await fetch(ttUrl, { signal })
        if (tr.ok) {
          const text = await tr.text()
          const keywords = [ctx.dtcs?.[0], ctx.complaintText.split(' ')[0]].filter(Boolean) as string[]
          let snippet: string | null = null
          for (const kw of keywords) {
            snippet = extractFirstSnippet(text, kw)
            if (snippet) break
          }
          transcriptSnippet = snippet || transcriptSnippet
        }
      } catch {
        // ignore — keep description as snippet
      }
      results.push({
        source: this.id,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        title: `${item.snippet.title} — ${item.snippet.channelTitle}`,
        snippet: transcriptSnippet.slice(0, 600),
        weightHint: 0.55,
      })
    }
    return results
  }
}

function extractFirstSnippet(transcript: string, keyword: string): string | null {
  const idx = transcript.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx === -1) return null
  return transcript.slice(Math.max(0, idx - 100), idx + 400).replace(/\s+/g, ' ').trim()
}
