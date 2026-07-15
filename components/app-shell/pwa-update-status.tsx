'use client'

import { useEffect, useRef, useState } from 'react'
import {
  PWA_UPDATE_READY_EVENT,
  type PwaUpdateReadyDetail,
} from '@/components/app-shell/pwa-update-events'

type UpdatePhase = 'ready' | 'updating' | 'error'

export type PwaUpdateStatusProps = {
  reload?: () => void
}

function reloadWindow() {
  window.location.reload()
}

export function PwaUpdateStatus({
  reload = reloadWindow,
}: PwaUpdateStatusProps = {}) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [phase, setPhase] = useState<UpdatePhase>('ready')
  const controllerChangeListener = useRef<EventListener | null>(null)

  useEffect(() => {
    const handleUpdateReady = (event: Event) => {
      const detail = (event as CustomEvent<PwaUpdateReadyDetail>).detail
      if (!detail?.waiting) return

      setWaiting(detail.waiting)
      setPhase('ready')
    }

    window.addEventListener(PWA_UPDATE_READY_EVENT, handleUpdateReady)

    return () => {
      window.removeEventListener(PWA_UPDATE_READY_EVENT, handleUpdateReady)
      if (controllerChangeListener.current) {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          controllerChangeListener.current,
        )
        controllerChangeListener.current = null
      }
    }
  }, [])

  if (!waiting) return null

  const startUpdate = () => {
    if (phase === 'updating') return

    const handleControllerChange = () => {
      controllerChangeListener.current = null
      reload()
    }

    controllerChangeListener.current = handleControllerChange
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange, {
      once: true,
    })
    setPhase('updating')

    try {
      waiting.postMessage({ type: 'ACTIVATE' })
    } catch {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      controllerChangeListener.current = null
      setPhase('error')
    }
  }

  const message =
    phase === 'updating'
      ? 'Updating application…'
      : phase === 'error'
        ? 'Update could not start. Keep working and try again.'
        : 'Application update ready. Finish the current task, then update.'

  return (
    <section aria-label="Application update">
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button type="button" disabled={phase === 'updating'} onClick={startUpdate}>
        Update when ready
      </button>
    </section>
  )
}
