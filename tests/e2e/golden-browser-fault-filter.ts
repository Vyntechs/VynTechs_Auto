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
