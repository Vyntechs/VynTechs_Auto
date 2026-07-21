export function isExpectedPageNavigationAbort(
  method: string,
  pathname: string,
  failure: string,
): boolean {
  return method === 'GET'
    && !pathname.startsWith('/api/')
    && failure === 'net::ERR_ABORTED'
}
