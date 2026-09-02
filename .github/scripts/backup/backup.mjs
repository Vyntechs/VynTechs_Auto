import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { parseBackupPath, retainExpiredBackups } from './retention.mjs'
import { issueExactMutationUrl, nativeMutationRequest } from './signed-mutations.mjs'

const requireFromBackupRuntime = createRequire(import.meta.url)

function fail(message) {
  throw new Error(`encrypted backup failed: ${message}`)
}

function isNotFound(error) {
  return error?.name === 'BlobNotFoundError'
}

async function sha256File(pathname) {
  const hash = createHash('sha256')
  const input = createReadStream(pathname)
  input.on('data', (chunk) => hash.update(chunk))
  await finished(input)
  return hash.digest('hex')
}

async function ciphertextByteLength(pathname) {
  try {
    const metadata = await stat(pathname)
    if (!metadata.isFile() || metadata.size < 1) fail('encrypted archive is unavailable')
    return metadata.size
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('encrypted backup failed:')) throw error
    fail('encrypted archive is unavailable')
  }
}

async function assertPathnameAbsent(pathname, client) {
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

async function cleanupOwnedUpload(pathname, etag, client, mutationFetch) {
  let signedUrl
  try {
    signedUrl = await issueExactMutationUrl({ operation: 'delete', pathname, ifMatch: etag }, client)
  } catch {
    fail('encrypted upload cleanup could not be prepared')
  }

  try {
    await mutationFetch(signedUrl, nativeMutationRequest('delete'))
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
  client,
  mutationFetch = globalThis.fetch,
) {
  parseBackupPath(objectPath)
  await access(ciphertextPath)
  const maximumSizeInBytes = await ciphertextByteLength(ciphertextPath)
  await assertPathnameAbsent(objectPath, client)

  let signedUrl
  try {
    signedUrl = await issueExactMutationUrl(
      { operation: 'put', pathname: objectPath, maximumSizeInBytes },
      client,
    )
  } catch {
    fail('private encrypted upload could not be prepared')
  }

  let response
  try {
    response = await mutationFetch(
      signedUrl,
      nativeMutationRequest('put', createReadStream(ciphertextPath)),
    )
  } catch {
    await reconcileAmbiguousPut({ ciphertextPath, objectPath, readbackPath }, client)
    return
  }

  let uploaded
  try {
    const result = response?.ok ? await response.json() : undefined
    if (result?.pathname === objectPath && typeof result.etag === 'string' && result.etag.length > 0) {
      uploaded = { pathname: result.pathname, etag: result.etag }
    }
  } catch {
    // A malformed success is reconciled exactly once below.
  }
  if (!uploaded) {
    await reconcileAmbiguousPut({ ciphertextPath, objectPath, readbackPath }, client)
    return
  }

  try {
    await readbackAndVerify({ ciphertextPath, objectPath, readbackPath, etag: uploaded.etag }, client)
  } catch (error) {
    try {
      await cleanupOwnedUpload(objectPath, uploaded.etag, client, mutationFetch)
    } catch {
      fail('encrypted upload verification failed and cleanup outcome remains unknown')
    }
    throw error
  }
}

async function loadBlobClient() {
  try {
    const { get, head, issueSignedToken, list, presignUrl } = requireFromBackupRuntime('@vercel/blob')
    return { get, head, issueSignedToken, list, presignUrl }
  } catch {
    fail('isolated private Blob tooling is unavailable')
  }
}

async function main() {
  const [ciphertextPath, objectPath, readbackPath] = process.argv.slice(2)
  if (!ciphertextPath || !objectPath || !readbackPath || process.argv.length !== 5) {
    fail('backup tool requires ciphertext, object path, and readback path arguments')
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) fail('private Blob credential is not configured')

  const client = await loadBlobClient()
  await uploadAndVerify({ ciphertextPath, objectPath, readbackPath }, client)
  await retainExpiredBackups(new Date(), client)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Do not print provider errors: they can contain an object locator or request data.
    const message = error instanceof Error ? error.message : ''
    console.error(message.startsWith('encrypted backup') ? message : 'encrypted backup failed')
    process.exitCode = 1
  })
}
