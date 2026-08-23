import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, put } from '@vercel/blob'
import { parseBackupPath, retainExpiredBackups } from './retention.mjs'

function fail(message) {
  throw new Error(`encrypted backup failed: ${message}`)
}

function isNotFound(error) {
  return error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError'
}

function isPreconditionFailure(error) {
  return error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError'
}

async function sha256File(pathname) {
  const hash = createHash('sha256')
  const input = createReadStream(pathname)
  input.on('data', (chunk) => hash.update(chunk))
  await finished(input)
  return hash.digest('hex')
}

async function assertPathnameAbsent(pathname, client = { head }) {
  try {
    await client.head(pathname)
  } catch (error) {
    if (isNotFound(error)) return
    fail('private Blob duplicate preflight could not be completed')
  }
  fail('the deterministic private Blob pathname already exists')
}

async function readbackAndVerify({ ciphertextPath, objectPath, readbackPath, etag }, client) {
  let response
  try {
    response = await client.get(objectPath, { access: 'private', useCache: false })
  } catch {
    fail('encrypted private readback could not be completed')
  }
  if (
    !response ||
    response.statusCode !== 200 ||
    !response.stream ||
    response.blob?.pathname !== objectPath ||
    response.blob?.etag !== etag
  ) {
    fail('encrypted private readback did not match the uploaded archive')
  }

  try {
    await pipeline(Readable.fromWeb(response.stream), createWriteStream(readbackPath, { flags: 'wx', mode: 0o600 }))
  } catch {
    fail('encrypted private readback stream could not be completed')
  }

  let localHash
  let readbackHash
  try {
    ;[localHash, readbackHash] = await Promise.all([sha256File(ciphertextPath), sha256File(readbackPath)])
  } catch {
    fail('encrypted private readback checksum could not be completed')
  }
  if (localHash !== readbackHash) fail('encrypted readback checksum did not match the uploaded archive')
}

async function cleanupOwnedUpload(pathname, etag, client) {
  try {
    await client.del(pathname, { ifMatch: etag })
  } catch {
    // Reconcile exactly once below. Never retry a conditionally-owned deletion.
  }

  try {
    await client.head(pathname)
  } catch (error) {
    if (isNotFound(error)) return
    fail('encrypted upload cleanup outcome remains unknown')
  }
  fail('encrypted upload cleanup outcome remains unknown')
}

async function reconcileAmbiguousPut({ ciphertextPath, objectPath, readbackPath }, client) {
  let uploaded
  try {
    uploaded = await client.head(objectPath)
  } catch {
    fail('private encrypted upload outcome is unknown')
  }
  if (!uploaded || uploaded.pathname !== objectPath || typeof uploaded.etag !== 'string' || uploaded.etag.length === 0) {
    fail('private encrypted upload outcome is unknown')
  }

  try {
    await readbackAndVerify({ ciphertextPath, objectPath, readbackPath, etag: uploaded.etag }, client)
  } catch {
    fail('private encrypted upload outcome is unknown')
  }
}

export async function uploadAndVerify(
  { ciphertextPath, objectPath, readbackPath },
  client = { put, get, head, del },
) {
  parseBackupPath(objectPath)
  await access(ciphertextPath)
  await assertPathnameAbsent(objectPath, client)

  let uploaded
  try {
    uploaded = await client.put(objectPath, createReadStream(ciphertextPath), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/octet-stream',
      multipart: false,
    })
  } catch (error) {
    if (isPreconditionFailure(error)) fail('the deterministic private Blob pathname already exists')
    await reconcileAmbiguousPut({ ciphertextPath, objectPath, readbackPath }, client)
    return
  }

  if (!uploaded || uploaded.pathname !== objectPath || typeof uploaded.etag !== 'string' || uploaded.etag.length === 0) {
    fail('private encrypted upload outcome is unknown')
  }

  try {
    await readbackAndVerify({ ciphertextPath, objectPath, readbackPath, etag: uploaded.etag }, client)
  } catch (error) {
    try {
      await cleanupOwnedUpload(objectPath, uploaded.etag, client)
    } catch {
      fail('encrypted upload verification failed and cleanup outcome remains unknown')
    }
    throw error
  }
}

async function main() {
  const [ciphertextPath, objectPath, readbackPath] = process.argv.slice(2)
  if (!ciphertextPath || !objectPath || !readbackPath || process.argv.length !== 5) {
    fail('backup tool requires ciphertext, object path, and readback path arguments')
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) fail('private Blob credential is not configured')

  await uploadAndVerify({ ciphertextPath, objectPath, readbackPath })
  await retainExpiredBackups()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Do not print provider errors: they can contain an object locator or request data.
    const message = error instanceof Error ? error.message : ''
    console.error(message.startsWith('encrypted backup') ? message : 'encrypted backup failed')
    process.exitCode = 1
  })
}
