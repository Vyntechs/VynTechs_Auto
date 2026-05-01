import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | undefined

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const client = getClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

export function cachedSystem(text: string) {
  return [
    {
      type: 'text' as const,
      text,
      cache_control: { type: 'ephemeral' as const },
    },
  ]
}
