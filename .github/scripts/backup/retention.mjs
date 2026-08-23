import { BlobNotFoundError, del, head, list } from '@vercel/blob'

export const BACKUP_PREFIX = 'database-backups/'
export const MAX_INVENTORY_ITEMS = 1_000
export const RETENTION_DAYS = 90

const DAILY_PATH = /^database-backups\/daily\/(\d{4})\/(\d{2})\/vyntechs-(\d{4}-\d{2}-\d{2})\.dump\.age$/
const MANUAL_PATH = /^database-backups\/manual\/(\d{4})\/(\d{2})\/vyntechs-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-run-([1-9]\d*)\.dump\.age$/

function fail(message) {
  throw new Error(`encrypted backup retention failed: ${message}`)
}

function parseUtcDate(date, time = '00:00:00') {
  const parsed = new Date(`${date}T${time}Z`)
  if (Number.isNaN(parsed.getTime())) fail('backup pathname contains an invalid UTC date')

  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    fail('backup pathname contains a non-existent UTC date')
  }
  return parsed
}

export function parseBackupPath(pathname) {
  if (typeof pathname !== 'string') fail('backup inventory contains a non-string pathname')

  const daily = pathname.match(DAILY_PATH)
  if (daily) {
    const [, directoryYear, directoryMonth, date] = daily
    if (date.slice(0, 4) !== directoryYear || date.slice(5, 7) !== directoryMonth) {
      fail('daily backup pathname date does not match its directory')
    }
    return { pathname, createdAt: parseUtcDate(date) }
  }

  const manual = pathname.match(MANUAL_PATH)
  if (manual) {
    const [, directoryYear, directoryMonth, date, hour, minute, second] = manual
    if (date.slice(0, 4) !== directoryYear || date.slice(5, 7) !== directoryMonth) {
      fail('manual backup pathname date does not match its directory')
    }
    return { pathname, createdAt: parseUtcDate(date, `${hour}:${minute}:${second}`) }
  }

  fail('backup inventory contains a pathname outside the backup contract')
}

export async function collectBackupInventory(client = { list }) {
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
      if (seenPathnames.has(parsed.pathname)) {
        fail('backup inventory contains a duplicate pathname')
      }
      seenPathnames.add(parsed.pathname)
      inventory.push({ ...parsed, etag: blob.etag })
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
  return inventory.filter((backup) => backup.createdAt.getTime() < cutoff.getTime())
}

export async function reconcileDelete(pathname, etag, client = { del, head }) {
  try {
    await client.del(pathname, { ifMatch: etag })
    return
  } catch (deleteError) {
    try {
      await client.head(pathname)
    } catch (headError) {
      if (headError instanceof BlobNotFoundError || headError?.name === 'BlobNotFoundError') {
        return
      }
      fail('exact-path deletion readback could not be completed')
    }
    void deleteError
    fail('exact-path deletion outcome remains ambiguous; it will not be retried')
  }
}

export async function retainExpiredBackups(now = new Date(), client = { list, del, head }) {
  const inventory = await collectBackupInventory(client)
  const expired = selectExpiredBackups(inventory, now)
  for (const backup of expired) {
    await reconcileDelete(backup.pathname, backup.etag, client)
  }
  return { inventoryCount: inventory.length, deletedCount: expired.length }
}
