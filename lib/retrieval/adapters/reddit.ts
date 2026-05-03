import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '../types'

const SUBREDDITS = ['MechanicAdvice', 'AskMechanics', 'Cartalk', 'Justrolledintotheshop']
let cachedToken: { value: string; expiresAt: number } | null = null

export class RedditAdapter implements RetrievalAdapter {
  id = 'reddit'
  weight = 0.5

  async query(ctx: RetrievalContext, signal: AbortSignal): Promise<RetrievalResult[]> {
    const id = process.env.REDDIT_CLIENT_ID
    const secret = process.env.REDDIT_CLIENT_SECRET
    const ua = process.env.REDDIT_USER_AGENT ?? 'vyntechs/1.0'
    if (!id || !secret) return []

    const token = await this.getToken(id, secret, ua, signal)
    if (!token) return []

    const q = `${ctx.vehicleYear} ${ctx.vehicleMake} ${ctx.vehicleModel} ${ctx.dtcs?.join(' ') ?? ''} ${ctx.complaintText}`.trim()
    const sub = SUBREDDITS.join('+')
    const url = `https://oauth.reddit.com/r/${sub}/search?q=${encodeURIComponent(q)}&restrict_sr=true&limit=5&sort=relevance`
    const res = await fetch(url, {
      signal,
      headers: { authorization: `Bearer ${token}`, 'user-agent': ua },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: { children: Array<{ data: { title: string; permalink: string; selftext: string; subreddit: string; score: number } }> } }
    return json.data.children.slice(0, 5).map(c => ({
      source: this.id,
      url: `https://www.reddit.com${c.data.permalink}`,
      title: `r/${c.data.subreddit}: ${c.data.title}`,
      snippet: c.data.selftext.slice(0, 800),
      weightHint: Math.min(0.7, 0.4 + Math.log10(Math.max(1, c.data.score)) / 5),
    }))
  }

  private async getToken(id: string, secret: string, ua: string, signal: AbortSignal): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value
    const body = new URLSearchParams({ grant_type: 'client_credentials' })
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      signal,
      headers: {
        authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'user-agent': ua,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { access_token: string; expires_in: number }
    cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
    return cachedToken.value
  }
}
