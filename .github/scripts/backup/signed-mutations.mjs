const MUTATION_TTL_MS = 5 * 60 * 1_000
const CIPHERTEXT_CONTENT_TYPE = 'application/octet-stream'

function assertOperation(operation) {
  if (operation !== 'put' && operation !== 'delete') {
    throw new Error('unsupported signed Blob mutation')
  }
}

export async function issueExactMutationUrl({ operation, pathname, ifMatch, maximumSizeInBytes }, client) {
  assertOperation(operation)
  if (typeof pathname !== 'string' || pathname.length === 0) {
    throw new Error('signed Blob pathname is invalid')
  }
  if (operation === 'put' && (!Number.isSafeInteger(maximumSizeInBytes) || maximumSizeInBytes < 1)) {
    throw new Error('signed Blob upload size is invalid')
  }
  if (operation === 'delete' && (typeof ifMatch !== 'string' || ifMatch.length === 0)) {
    throw new Error('signed Blob delete ETag is invalid')
  }

  const validUntil = Date.now() + MUTATION_TTL_MS
  const constraints = operation === 'put'
    ? { allowedContentTypes: [CIPHERTEXT_CONTENT_TYPE], maximumSizeInBytes }
    : {}
  const signedToken = await client.issueSignedToken({
    pathname,
    operations: [operation],
    validUntil,
    ...constraints,
  })
  const signedUrl = await client.presignUrl(signedToken, {
    access: 'private',
    pathname,
    operation,
    validUntil,
    ...constraints,
    ...(operation === 'put'
      ? { addRandomSuffix: false, allowOverwrite: false }
      : { ifMatch }),
  })
  if (!signedUrl || typeof signedUrl.presignedUrl !== 'string' || signedUrl.presignedUrl.length === 0) {
    throw new Error('signed Blob URL is malformed')
  }
  return signedUrl.presignedUrl
}

export function nativeMutationRequest(operation, body) {
  assertOperation(operation)
  if (operation === 'put') {
    return {
      method: 'PUT',
      headers: { 'content-type': CIPHERTEXT_CONTENT_TYPE },
      body,
      duplex: 'half',
    }
  }
  return { method: 'DELETE' }
}
