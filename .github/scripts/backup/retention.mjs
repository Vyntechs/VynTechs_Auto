import { issueExactMutationUrl, nativeMutationRequest } from './signed-mutations.mjs'

export const BACKUP_PREFIX = 'database-backups/'
export const MAX_INVENTORY_ITEMS = 1_000
export const RETENTION_DAYS = 90

const DAILY_PATH = /^database-backups\/daily\/vyntechs-run-([1-9]\d*)\.dump\.age$/
const MANUAL_PATH = /^database-backups\/manual\/vyntechs-run-([1-9]\d*)\.dump\.age$/

function fail(message) {
  throw new Error(`encrypted backup retention failed: ${message}`)
}

function isNotFound(error) {
  return error?.name === 'BlobNotFoundError'
}

export function parseBackupPath(pathname) {
  if (typeof pathname !== 'string') fail('backup inventory contains a non-string pathname')

  if (DAILY_PATH.test(pathname) || MANUAL_PATH.test(pathname)) return { pathname }

  fail('backup inventory contains a pathname outside the backup contract')
}

export async function collectBackupInventory(client) {
  const inventory = []
  const seenPathnames = new Set()
  const seenCursors = new Set()
  let cursor

  while (true) {
    const page = await client.list({
      prefix: BACKUP_PREFIX,
      limit: MAX_INVENTORY_ITEMS,
      mode: 'expanded',
      ...(cursor === undefined ? {} : { cursor }),
    })

    if (!page || !Array.isArray(page.blobs) || typeof page.hasMore !== 'boolean') {
      fail('backup inventory response was malformed')
    }
    if (inventory.length + page.blobs.length > MAX_INVENTORY_ITEMS) {
      fail('backup inventory exceeded the 1,000-object safety cap')
    }

    for (const blob of page.blobs) {
      const parsed = parseBackupPath(blob?.pathname)
      if (typeof blob.etag !== 'string' || blob.etag.length === 0) {
        fail('backup inventory contains an object without an ETag')
      }
      if (!(blob.uploadedAt instanceof Date) || Number.isNaN(blob.uploadedAt.getTime())) {
        fail('backup inventory contains an object without a valid uploadedAt timestamp')
      }
      if (seenPathnames.has(parsed.pathname)) {
        fail('backup inventory contains a duplicate pathname')
      }
      seenPathnames.add(parsed.pathname)
      inventory.push({ ...parsed, etag: blob.etag, uploadedAt: blob.uploadedAt })
    }

    if (!page.hasMore) {
      if (page.cursor !== undefined && page.cursor !== null) {
        fail('complete backup inventory returned an unexpected cursor')
      }
      return inventory
    }

    if (typeof page.cursor !== 'string' || page.cursor.length === 0) {
      fail('paginated backup inventory omitted its cursor')
    }
    if (seenCursors.has(page.cursor)) {
      fail('paginated backup inventory repeated a cursor')
    }
    seenCursors.add(page.cursor)
    cursor = page.cursor
  }
}

export function selectExpiredBackups(inventory, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail('retention cutoff was invalid')
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1_000)
  return inventory.filter((backup) => backup.uploadedAt.getTime() < cutoff.getTime())
}

export async function reconcileDelete(pathname, etag, client, mutationFetch = globalThis.fetch) {
  let signedUrl
  try {
    signedUrl = await issueExactMutationUrl({ operation: 'delete', pathname, ifMatch: etag }, client)
  } catch {
    fail('exact-path deletion could not be prepared')
  }

  try {
    await mutationFetch(signedUrl, nativeMutationRequest('delete'))
  } catch {
    // Exact-path readback below decides whether the one mutation completed.
  }

  try {
    await client.head(pathname)
  } catch (headError) {
    if (isNotFound(headError)) return
    fail('exact-path deletion readback could not be completed')
  }
  fail('exact-path deletion outcome remains ambiguous; it will not be retried')
}

export async function retainExpiredBackups(now = new Date(), client, mutationFetch = globalThis.fetch) {
  const inventory = await collectBackupInventory(client)
  const expired = selectExpiredBackups(inventory, now)
  for (const backup of expired) {
    await reconcileDelete(backup.pathname, backup.etag, client, mutationFetch)
  }
  return { inventoryCount: inventory.length, deletedCount: expired.length }
}
