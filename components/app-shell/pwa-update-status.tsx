'use client'

import { useEffect, useRef, useState } from 'react'
import {
  PWA_UPDATE_READY_EVENT,
  type PwaUpdateReadyDetail,
} from '@/components/app-shell/pwa-update-events'

type UpdatePhase =
  | 'ready'
  | 'updating'
  | 'external-updating'
  | 'reload-ready'
  | 'error'

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
  const waitingRef = useRef<ServiceWorker | null>(null)
  const localActivation = useRef(false)
  const readyEventVersion = useRef(0)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let disposed = false

    const showWaitingWorker = (worker: ServiceWorker) => {
      if (worker.state === 'redundant') return

      waitingRef.current = worker
      setWaiting(worker)
      setPhase(
        worker.state === 'activated'
          ? 'reload-ready'
          : worker.state === 'installed'
            ? 'ready'
            : 'external-updating',
      )
    }

    const handleUpdateReady = (event: Event) => {
      readyEventVersion.current += 1
      const detail = (event as CustomEvent<PwaUpdateReadyDetail>).detail
      if (!detail?.waiting || localActivation.current) return

      showWaitingWorker(detail.waiting)
    }

    const handlePassiveControllerChange = () => {
      if (!waitingRef.current || localActivation.current) return
      setPhase('reload-ready')
    }

    window.addEventListener(PWA_UPDATE_READY_EVENT, handleUpdateReady)
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handlePassiveControllerChange,
    )

    const replayVersion = readyEventVersion.current
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (
        disposed ||
        localActivation.current ||
        readyEventVersion.current !== replayVersion ||
        !registration?.waiting
      ) {
        return
      }

      showWaitingWorker(registration.waiting)
    }).catch(() => undefined)

    return () => {
      disposed = true
      window.removeEventListener(PWA_UPDATE_READY_EVENT, handleUpdateReady)
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handlePassiveControllerChange,
      )
      if (controllerChangeListener.current) {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          controllerChangeListener.current,
        )
        controllerChangeListener.current = null
      }
      waitingRef.current = null
      localActivation.current = false
    }
  }, [])

  useEffect(() => {
    if (!waiting) return

    const handleWaitingStateChange = () => {
      if (localActivation.current) return

      if (waiting.state === 'activating') {
        setPhase('external-updating')
      } else if (waiting.state === 'activated') {
        setPhase('reload-ready')
      } else if (waiting.state === 'redundant') {
        waitingRef.current = null
        setWaiting(null)
      }
    }

    waiting.addEventListener('statechange', handleWaitingStateChange)
    handleWaitingStateChange()

    return () => {
      waiting.removeEventListener('statechange', handleWaitingStateChange)
    }
  }, [waiting])

  if (!waiting) return null

  const startUpdate = () => {
    if (phase === 'reload-ready') {
      reload()
      return
    }

    if (phase === 'updating' || phase === 'external-updating') return

    const handleControllerChange = () => {
      controllerChangeListener.current = null
      reload()
    }

    controllerChangeListener.current = handleControllerChange
    localActivation.current = true
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange, {
      once: true,
    })
    setPhase('updating')

    try {
      waiting.postMessage({ type: 'ACTIVATE' })
    } catch {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      controllerChangeListener.current = null
      localActivation.current = false
      setPhase('error')
    }
  }

  const message =
    phase === 'updating'
      ? 'Updating application…'
      : phase === 'external-updating'
        ? 'Application update is being applied in another tab…'
        : phase === 'reload-ready'
          ? 'Application update applied. Reload when ready.'
          : phase === 'error'
            ? 'Update could not start. Keep working and try again.'
            : 'Application update ready. Finish the current task, then update.'

  const isUpdating = phase === 'updating' || phase === 'external-updating'

  return (
    <section aria-label="Application update">
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button type="button" disabled={isUpdating} onClick={startUpdate}>
        {phase === 'reload-ready' ? 'Reload when ready' : 'Update when ready'}
      </button>
    </section>
  )
}
