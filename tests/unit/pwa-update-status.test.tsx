import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaUpdateStatus } from '@/components/app-shell/pwa-update-status'
import {
  PWA_UPDATE_READY_EVENT,
  type PwaUpdateReadyDetail,
} from '@/components/app-shell/pwa-update-events'

let serviceWorkerContainer: ServiceWorkerContainer
let getRegistration: ReturnType<typeof vi.fn>

type MutableServiceWorker = ServiceWorker & { state: ServiceWorkerState }

function createWaitingWorker(postMessage = vi.fn()): MutableServiceWorker {
  const worker = new EventTarget() as MutableServiceWorker
  Object.defineProperties(worker, {
    postMessage: {
      configurable: true,
      value: postMessage,
    },
    state: {
      configurable: true,
      writable: true,
      value: 'installed',
    },
  })
  return worker
}

function createRegistration(waiting: ServiceWorker | null): ServiceWorkerRegistration {
  const registration = new EventTarget() as ServiceWorkerRegistration
  Object.defineProperty(registration, 'waiting', {
    configurable: true,
    value: waiting,
  })
  return registration
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function setController(controller: ServiceWorker | null) {
  Object.defineProperty(serviceWorkerContainer, 'controller', {
    configurable: true,
    value: controller,
  })
}

function announceWaitingWorker(waiting: ServiceWorker) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent<PwaUpdateReadyDetail>(PWA_UPDATE_READY_EVENT, {
        detail: { waiting },
      }),
    )
  })
}

beforeEach(() => {
  getRegistration = vi.fn().mockResolvedValue(undefined)
  serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer
  Object.defineProperties(serviceWorkerContainer, {
    controller: {
      configurable: true,
      value: null,
    },
    getRegistration: {
      configurable: true,
      value: getRegistration,
    },
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorkerContainer,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PwaUpdateStatus', () => {
  it('renders nothing until an update-ready event arrives', () => {
    const { container } = render(<PwaUpdateStatus reload={vi.fn()} />)

    expect(container.innerHTML).toBe('')
  })

  it('replays waiting readiness that predates the component mount', async () => {
    const postMessage = vi.fn()
    const reload = vi.fn()
    const waiting = createWaitingWorker(postMessage)
    getRegistration.mockResolvedValue(createRegistration(waiting))

    render(<PwaUpdateStatus reload={reload} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update when ready' })).toBeEnabled()
    })
    expect(getRegistration).toHaveBeenCalledOnce()
    expect(postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not let a late registration replay replace a newer ready event', async () => {
    const user = userEvent.setup()
    const replay = createDeferred<ServiceWorkerRegistration | undefined>()
    const stalePostMessage = vi.fn()
    const currentPostMessage = vi.fn()
    const staleWaiting = createWaitingWorker(stalePostMessage)
    const currentWaiting = createWaitingWorker(currentPostMessage)
    getRegistration.mockReturnValue(replay.promise)
    render(<PwaUpdateStatus reload={vi.fn()} />)
    await waitFor(() => expect(getRegistration).toHaveBeenCalledOnce())

    announceWaitingWorker(currentWaiting)
    await act(async () => {
      replay.resolve(createRegistration(staleWaiting))
      await replay.promise
    })
    await user.click(screen.getByRole('button', { name: 'Update when ready' }))

    expect(currentPostMessage).toHaveBeenCalledOnce()
    expect(currentPostMessage).toHaveBeenCalledWith({ type: 'ACTIVATE' })
    expect(stalePostMessage).not.toHaveBeenCalled()
  })

  it('retains an external controller change while empty registration reconciliation is pending', async () => {
    const user = userEvent.setup()
    const replay = createDeferred<ServiceWorkerRegistration | undefined>()
    const reload = vi.fn()
    getRegistration.mockReturnValue(replay.promise)
    render(<PwaUpdateStatus reload={reload} />)
    await waitFor(() => expect(getRegistration).toHaveBeenCalledOnce())

    act(() => {
      serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    })
    await act(async () => {
      replay.resolve(createRegistration(null))
      await replay.promise
    })

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Application update applied. Reload when ready.',
    )
    expect(reload).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Reload when ready' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('announces readiness without messaging, activating, or reloading automatically', () => {
    const postMessage = vi.fn()
    const reload = vi.fn()
    const addServiceWorkerListener = vi.spyOn(serviceWorkerContainer, 'addEventListener')
    render(<PwaUpdateStatus reload={reload} />)

    announceWaitingWorker(createWaitingWorker(postMessage))

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Application update ready. Finish the current task, then update.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update when ready' })).toBeEnabled()
    expect(postMessage).not.toHaveBeenCalled()
    expect(addServiceWorkerListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    )
    expect(reload).not.toHaveBeenCalled()
  })

  it('posts exactly one activation message only after the explicit button action', async () => {
    const user = userEvent.setup()
    const postMessage = vi.fn()
    const reload = vi.fn()
    render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(createWaitingWorker(postMessage))

    await user.click(screen.getByRole('button', { name: 'Update when ready' }))

    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE' })
    expect(screen.getByRole('button', { name: 'Update when ready' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Updating application…')
    expect(reload).not.toHaveBeenCalled()
  })

  it('supports keyboard activation and reloads once after controllerchange', async () => {
    const user = userEvent.setup()
    const postMessage = vi.fn()
    const reload = vi.fn()
    render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(createWaitingWorker(postMessage))
    const button = screen.getByRole('button', { name: 'Update when ready' })

    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE' })
    expect(reload).not.toHaveBeenCalled()

    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))

    expect(reload).toHaveBeenCalledOnce()
  })

  it('observes external activation without reloading until the explicit reload action', async () => {
    const user = userEvent.setup()
    const postMessage = vi.fn()
    const reload = vi.fn()
    const waiting = createWaitingWorker(postMessage)
    setController(createWaitingWorker())
    render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(waiting)

    act(() => {
      waiting.state = 'activating'
      waiting.dispatchEvent(new Event('statechange'))
    })

    expect(screen.getByRole('button', { name: 'Update when ready' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Application update is being applied in another tab…',
    )
    expect(postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()

    setController(createWaitingWorker())
    act(() => {
      serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Application update applied. Reload when ready.',
    )
    expect(reload).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Reload when ready' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('ignores new ready workers during local activation and reloads only once', async () => {
    const user = userEvent.setup()
    const firstPostMessage = vi.fn()
    const secondPostMessage = vi.fn()
    const reload = vi.fn()
    render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(createWaitingWorker(firstPostMessage))

    await user.click(screen.getByRole('button', { name: 'Update when ready' }))
    announceWaitingWorker(createWaitingWorker(secondPostMessage))
    const updateButton = screen.getByRole('button', { name: 'Update when ready' })

    expect(updateButton).toBeDisabled()
    await user.click(updateButton)
    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))

    expect(firstPostMessage).toHaveBeenCalledOnce()
    expect(secondPostMessage).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('recovers a successor when the locally activated worker becomes redundant', async () => {
    const user = userEvent.setup()
    const firstPostMessage = vi.fn()
    const successorPostMessage = vi.fn()
    const firstWaiting = createWaitingWorker(firstPostMessage)
    const successor = createWaitingWorker(successorPostMessage)
    const reload = vi.fn()
    const addContainerListener = vi.spyOn(serviceWorkerContainer, 'addEventListener')
    const removeContainerListener = vi.spyOn(serviceWorkerContainer, 'removeEventListener')
    const { unmount } = render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(firstWaiting)

    await user.click(screen.getByRole('button', { name: 'Update when ready' }))
    expect(firstPostMessage).toHaveBeenCalledWith({ type: 'ACTIVATE' })

    act(() => {
      firstWaiting.state = 'redundant'
      firstWaiting.dispatchEvent(new Event('statechange'))
    })
    act(() => {
      serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    })
    announceWaitingWorker(successor)

    expect(screen.getByRole('button', { name: 'Update when ready' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Application update ready. Finish the current task, then update.',
    )
    expect(successorPostMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(addContainerListener).toHaveBeenCalledTimes(2)

    unmount()

    expect(removeContainerListener).toHaveBeenCalledTimes(2)
    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
  })

  it('removes the reload listener and restores the control when activation throws', async () => {
    const user = userEvent.setup()
    const postMessage = vi.fn(() => {
      throw new Error('private worker detail')
    })
    const reload = vi.fn()
    render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(createWaitingWorker(postMessage))

    await user.click(screen.getByRole('button', { name: 'Update when ready' }))

    expect(screen.getByRole('status')).toHaveTextContent(
      'Update could not start. Keep working and try again.',
    )
    expect(screen.getByRole('button', { name: 'Update when ready' })).toBeEnabled()
    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('private worker detail')
  })

  it('removes a pending reload listener when unmounted', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    const { unmount } = render(<PwaUpdateStatus reload={reload} />)
    announceWaitingWorker(createWaitingWorker())
    await user.click(screen.getByRole('button', { name: 'Update when ready' }))

    unmount()
    serviceWorkerContainer.dispatchEvent(new Event('controllerchange'))

    expect(reload).not.toHaveBeenCalled()
  })
})
