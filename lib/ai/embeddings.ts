// Voyage AI embeddings — Anthropic-recommended for RAG / similarity search.
// voyage-3 produces 1024-dim vectors; the corpus_entries.embedding column
// is sized to match.
const URL = 'https://api.voyageai.com/v1/embeddings'
const MODEL = 'voyage-3'

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: [text] }),
  })
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { data?: Array<{ embedding: number[] }> }
  if (!json.data?.[0]?.embedding) throw new Error('embed: malformed response')
  return json.data[0].embedding
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  })
  if (!res.ok) throw new Error(`embed batch failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> }
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}
