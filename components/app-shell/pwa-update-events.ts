export const PWA_UPDATE_READY_EVENT = 'vyntechs:pwa-update-ready'

export type PwaUpdateReadyDetail = {
  waiting: ServiceWorker
}

export function announcePwaUpdateReady(waiting: ServiceWorker): void {
  window.dispatchEvent(
    new CustomEvent<PwaUpdateReadyDetail>(PWA_UPDATE_READY_EVENT, {
      detail: { waiting },
    }),
  )
}
