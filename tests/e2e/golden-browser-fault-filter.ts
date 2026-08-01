// Today keeps itself current with a background poll. Leaving the page while
// one is in flight cancels it, which is the browser doing exactly the right
// thing — the answer was about to be thrown away. That single read is the only
// API request allowed to abort; every mutation and every other endpoint still
// counts as a fault.
const CANCELLABLE_BACKGROUND_READS = new Set(['/api/today/jobs'])

export function isExpectedPageNavigationAbort(
  method: string,
  pathname: string,
  failure: string,
): boolean {
  if (method !== 'GET' || failure !== 'net::ERR_ABORTED') return false
  if (!pathname.startsWith('/api/')) return true
  return CANCELLABLE_BACKGROUND_READS.has(pathname)
}

// Proving the product refuses something means letting the browser say so:
// Chrome logs every non-2xx fetch to the console as an error. Closing a repair
// order that still carries live work is answered 409 by design, and the journey
// asserts the sentence the counter actually reads. Only that one endpoint and
// only that one status is forgiven — every other refusal still counts.
// The reason phrase is not part of the status. HTTP/2 dropped it, so a hosted
// preview logs "409 ()" where a local HTTP/1.1 server logs "409 (Conflict)".
// Matching the code and leaving the phrase free is what makes this filter mean
// the same thing on both.
const EXPECTED_REFUSALS: ReadonlyArray<{ path: RegExp; message: RegExp }> = [
  {
    path: /^\/api\/tickets\/[0-9a-f-]+\/close$/i,
    message: /^Failed to load resource: the server responded with a status of 409 \([^)]*\)$/,
  },
]

export function isExpectedProductRefusal(sourceUrl: string, message: string): boolean {
  const pathname = safeUrl(sourceUrl)?.pathname
  if (!pathname) return false
  return EXPECTED_REFUSALS.some((refusal) => (
    refusal.message.test(message) && refusal.path.test(pathname)
  ))
}

export function isExpectedLocalAnalyticsConsole(
  pageUrl: string,
  sourceUrl: string,
  message: string,
): boolean {
  const hostname = safeUrl(pageUrl)?.hostname ?? ''
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    return false
  }
  const analyticsPath = '/_vercel/insights/script.js'
  const sourceIsAnalytics = safeUrl(sourceUrl)?.pathname === analyticsPath
  const messageNamesAnalytics = message.includes(analyticsPath)
  if (!sourceIsAnalytics && !messageNamesAnalytics) return false
  if (sourceIsAnalytics
    && message === 'Failed to load resource: the server responded with a status of 404 (Not Found)') {
    return true
  }
  return message.startsWith('Refused to execute script from ')
    && messageNamesAnalytics
    && message.includes("because its MIME type ('text/html') is not executable")
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
