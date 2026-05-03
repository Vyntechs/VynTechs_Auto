const URL = 'https://api.openai.com/v1/embeddings'
const MODEL = 'text-embedding-3-small'

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: text }),
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
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  })
  if (!res.ok) throw new Error(`embed batch failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> }
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}
