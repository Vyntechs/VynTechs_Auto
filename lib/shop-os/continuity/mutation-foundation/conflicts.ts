export class ShopOsMutationConflict extends Error {
  readonly code = 'mutation_conflict'
  readonly retryable = true

  constructor() {
    super('shop_os_mutation_conflict')
    this.name = 'ShopOsMutationConflict'
  }
}

const RETRYABLE_SQLSTATES = new Set(['55P03', '40001', '40P01'])
const MAX_CAUSE_DEPTH = 8

function ownDataProperty(value: object, name: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

export function isRetryableMutationConflict(error: unknown): boolean {
  const seen = new WeakSet<object>()
  let current = error

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if ((typeof current !== 'object' || current === null) && typeof current !== 'function') {
      return false
    }
    if (seen.has(current)) return false
    seen.add(current)

    if (current instanceof ShopOsMutationConflict) return true
    const code = ownDataProperty(current, 'code')
    if (typeof code === 'string' && RETRYABLE_SQLSTATES.has(code)) return true

    current = ownDataProperty(current, 'cause')
  }

  return false
}
