import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaUpdateStatus } from '@/components/app-shell/pwa-update-status'
import {
  PWA_UPDATE_READY_EVENT,
  type PwaUpdateReadyDetail,
} from '@/components/app-shell/pwa-update-events'

let serviceWorkerContainer: ServiceWorkerContainer

function createWaitingWorker(postMessage = vi.fn()): ServiceWorker {
  const worker = new EventTarget() as ServiceWorker
  Object.defineProperty(worker, 'postMessage', {
    configurable: true,
    value: postMessage,
  })
  return worker
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
  serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer
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
    expect(addServiceWorkerListener).not.toHaveBeenCalled()
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
