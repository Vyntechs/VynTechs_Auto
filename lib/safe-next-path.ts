const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/**
 * Accept only an unambiguous application-local path.
 *
 * WHATWG URL parsing treats backslashes as forward slashes for special
 * schemes, so `/\\host` can otherwise become an external authority even
 * though it appears to begin with one slash.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = '/today',
): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  if (raw.includes('\\') || CONTROL_CHARACTER.test(raw)) return fallback
  return raw
}
