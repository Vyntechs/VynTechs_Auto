export function isExpectedPageNavigationAbort(
  method: string,
  pathname: string,
  failure: string,
): boolean {
  return method === 'GET'
    && !pathname.startsWith('/api/')
    && failure === 'net::ERR_ABORTED'
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
