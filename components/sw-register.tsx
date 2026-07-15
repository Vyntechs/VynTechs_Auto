'use client'

import { useEffect } from 'react'
import { announcePwaUpdateReady } from '@/components/app-shell/pwa-update-events'

export function SwRegister() {
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return
    }

    let disposed = false
    let removeUpdateListeners: (() => void) | undefined

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          '/sw.js?cache-policy=public-v4',
          {
            scope: '/',
            updateViaCache: 'none',
          },
        )
        if (disposed) return

        if (registration.waiting) {
          announcePwaUpdateReady(registration.waiting)
        }

        const observedWorkers = new Set<ServiceWorker>()
        const stateListeners = new Map<ServiceWorker, EventListener>()

        const handleUpdateFound = () => {
          const installing = registration.installing
          if (!installing || observedWorkers.has(installing)) return

          observedWorkers.add(installing)
          const handleStateChange = () => {
            if (
              installing.state !== 'installed' &&
              installing.state !== 'redundant'
            ) {
              return
            }

            installing.removeEventListener('statechange', handleStateChange)
            stateListeners.delete(installing)
            observedWorkers.delete(installing)

            if (
              installing.state === 'installed' &&
              !disposed &&
              navigator.serviceWorker.controller
            ) {
              announcePwaUpdateReady(installing)
            }
          }

          stateListeners.set(installing, handleStateChange)
          installing.addEventListener('statechange', handleStateChange)
          handleStateChange()
        }

        registration.addEventListener('updatefound', handleUpdateFound)
        handleUpdateFound()

        removeUpdateListeners = () => {
          registration.removeEventListener('updatefound', handleUpdateFound)
          for (const [worker, listener] of stateListeners) {
            worker.removeEventListener('statechange', listener)
          }
          stateListeners.clear()
          observedWorkers.clear()
        }

        void (async () => {
          try {
            await registration.update()
          } catch {
            if (!disposed) {
              console.warn('Service worker update check failed')
            }
          }
        })()
      } catch {
        if (!disposed) {
          console.warn('Service worker registration failed')
        }
      }
    })()

    return () => {
      disposed = true
      removeUpdateListeners?.()
    }
  }, [])

  return null
}
