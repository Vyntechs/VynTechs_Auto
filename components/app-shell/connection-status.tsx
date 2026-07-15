'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)

  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

function getSnapshot() {
  return navigator.onLine
}

function getServerSnapshot() {
  return true
}

export function ConnectionStatus() {
  const isOnline = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )

  if (isOnline) return null

  return (
    <p role="status" aria-live="polite">
      Connection needed · Unsaved actions require a connection
    </p>
  )
}
