export function getAuthRedirect(path: string, signedIn: boolean): string | null {
  const isAppRoute = path.startsWith('/sessions') || path.startsWith('/billing')
  const isAuthPage = path === '/sign-in' || path === '/sign-up'
  if (isAppRoute && !signedIn) return '/sign-in'
  if (isAuthPage && signedIn) return '/sessions'
  return null
}
