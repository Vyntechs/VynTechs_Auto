import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

type PolicyRequest = {
  url: string
  method: string
  mode?: string
  destination?: string
}

type RequestPolicy = 'navigate-network' | 'public-cache' | 'network'

function loadPolicy() {
  const source = readFileSync(resolve(__dirname, '../../public/sw-policy.js'), 'utf-8')
  const context = { URL } as {
    URL: typeof URL
    VyntechsSwPolicy?: {
      cachePolicyCapability: string
      classifyRequest(request: PolicyRequest, origin: string): RequestPolicy
      isPublicOnlyProof(value: unknown): boolean
    }
  }

  runInNewContext(source, context)

  if (!context.VyntechsSwPolicy) throw new Error('service worker policy did not install')
  return context.VyntechsSwPolicy
}

describe('service worker request policy', () => {
  const origin = 'https://app.vyntechs.com'

  const cases = [
    { name: 'signed-in navigation', request: { url: `${origin}/today`, method: 'GET', mode: 'navigate' }, expected: 'navigate-network' },
    { name: 'document destination', request: { url: `${origin}/today`, method: 'GET', destination: 'document' }, expected: 'navigate-network' },
    { name: 'job API response', request: { url: `${origin}/api/jobs/1`, method: 'GET', destination: '' }, expected: 'network' },
    { name: 'Next.js static chunk', request: { url: `${origin}/_next/static/chunk.js`, method: 'GET' }, expected: 'network' },
    { name: 'same-origin icon', request: { url: `${origin}/icons/icon-192.png`, method: 'GET' }, expected: 'public-cache' },
    { name: 'same-origin brand asset', request: { url: `${origin}/brand/mark.svg`, method: 'GET' }, expected: 'public-cache' },
    { name: 'uploaded evidence', request: { url: `${origin}/uploads/evidence.jpg`, method: 'GET' }, expected: 'network' },
    { name: 'cross-origin image', request: { url: 'https://cdn.example.com/brand/mark.svg', method: 'GET' }, expected: 'network' },
    { name: 'non-GET request', request: { url: `${origin}/icons/icon-192.png`, method: 'POST' }, expected: 'network' },
  ] satisfies Array<{ name: string; request: PolicyRequest; expected: RequestPolicy }>

  it.each(cases)('$name → $expected', ({ request, expected }) => {
    expect(loadPolicy().classifyRequest(request, origin)).toBe(expected)
  })
})

describe('service worker cache-policy proof', () => {
  it('publishes one stable public-only capability', () => {
    expect(loadPolicy().cachePolicyCapability).toBe('public-only-v1')
  })

  it('accepts only the exact typed public-only proof', () => {
    const policy = loadPolicy()

    expect(
      policy.isPublicOnlyProof({
        type: 'VYNTECHS_CACHE_POLICY_PROOF',
        capability: 'public-only-v1',
      }),
    ).toBe(true)

    for (const value of [
      null,
      undefined,
      false,
      [],
      {},
      { type: 'VYNTECHS_CACHE_POLICY_PROOF' },
      { capability: 'public-only-v1' },
      {
        type: 'vyntechs_cache_policy_proof',
        capability: 'public-only-v1',
      },
      {
        type: 'VYNTECHS_CACHE_POLICY_PROOF',
        capability: 'PUBLIC-ONLY-V1',
      },
      {
        type: 'VYNTECHS_CACHE_POLICY_PROOF',
        capability: 'public-only-v2',
      },
      {
        type: 'VYNTECHS_CACHE_POLICY_PROOF',
        capability: 'public-only-v1',
        extra: true,
      },
      Object.create({
        type: 'VYNTECHS_CACHE_POLICY_PROOF',
        capability: 'public-only-v1',
      }),
    ]) {
      expect(policy.isPublicOnlyProof(value)).toBe(false)
    }
  })
})
