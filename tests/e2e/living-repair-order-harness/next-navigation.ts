function recordRouteChange(kind: 'push' | 'replace' | 'back', value = ''): void {
  const count = Number(document.body.dataset.routeChanges ?? '0') + 1
  document.body.dataset.routeChanges = String(count)
  document.body.dataset.lastRouteChange = `${kind}:${value}`
}

export function useRouter() {
  return {
    push: (href: string) => recordRouteChange('push', href),
    replace: (href: string) => recordRouteChange('replace', href),
    refresh: () => undefined,
    back: () => recordRouteChange('back'),
  }
}

export function usePathname(): string {
  return window.location.pathname
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}
