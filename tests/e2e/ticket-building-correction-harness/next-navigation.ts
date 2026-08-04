import { useSyncExternalStore } from 'react'

function announceNavigation(): void {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRouter() {
  return {
    push(href: string) {
      window.history.pushState(null, '', href)
      announceNavigation()
    },
    replace(href: string) {
      window.history.replaceState(null, '', href)
      announceNavigation()
    },
    back() { window.history.back() },
    refresh() { announceNavigation() },
    prefetch: async () => undefined,
  }
}

export function usePathname(): string {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener('popstate', notify)
      return () => window.removeEventListener('popstate', notify)
    },
    () => window.location.pathname,
    () => '/',
  )
}

export function useSearchParams(): URLSearchParams {
  usePathname()
  return new URLSearchParams(window.location.search)
}
