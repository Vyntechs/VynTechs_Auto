export type VersionedEntity<T> = Readonly<{
  id: string
  version: string
  data: Readonly<T>
}>

export type EntityReplacement<T> = Readonly<{
  expectedVersion: string
  entity: VersionedEntity<T>
}>

export type EntityRemoval = Readonly<{
  id: string
  expectedVersion: string
}>

export type EntityApplyResult<T> =
  | Readonly<{ status: 'applied'; entity: VersionedEntity<T> | null }>
  | Readonly<{ status: 'stale'; entity: VersionedEntity<T> }>
  | Readonly<{ status: 'mismatch'; entity: VersionedEntity<T> }>

function isPresent(token: string): boolean {
  return token.length > 0
}

export function applyEntityReplacement<T>(
  current: VersionedEntity<T>,
  replacement: EntityReplacement<T>,
): EntityApplyResult<T> {
  if (
    !isPresent(current.id) ||
    !isPresent(current.version) ||
    !isPresent(replacement.expectedVersion) ||
    !isPresent(replacement.entity.id) ||
    !isPresent(replacement.entity.version) ||
    current.id !== replacement.entity.id
  ) {
    return { status: 'mismatch', entity: current }
  }

  if (current.version !== replacement.expectedVersion) {
    return { status: 'stale', entity: current }
  }

  return { status: 'applied', entity: replacement.entity }
}

export function applyEntityRemoval<T>(
  current: VersionedEntity<T>,
  removal: EntityRemoval,
): EntityApplyResult<T> {
  if (
    !isPresent(current.id) ||
    !isPresent(current.version) ||
    !isPresent(removal.id) ||
    !isPresent(removal.expectedVersion) ||
    current.id !== removal.id
  ) {
    return { status: 'mismatch', entity: current }
  }

  if (current.version !== removal.expectedVersion) {
    return { status: 'stale', entity: current }
  }

  return { status: 'applied', entity: null }
}
