// Importing this module installs the browser-API shims React Flow needs
// to render under happy-dom. Import it at the top of any test that mounts
// a component containing <ReactFlow>.

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyMock {
  m22 = 1
  constructor(_transform?: string) {}
}

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverMock
} else {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverMock
}
;(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly =
  DOMMatrixReadOnlyMock

// React Flow measures nodes via getBoundingClientRect / offset*; happy-dom
// returns zeros. Give every element a non-zero box so layout code runs.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => 100 },
  offsetWidth: { configurable: true, get: () => 200 },
})
if (typeof SVGElement !== 'undefined') {
  ;(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox =
    () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
}
