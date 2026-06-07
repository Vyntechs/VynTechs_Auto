/** Deferred scope hookup — v1 ships no waveform. Labeled so it reads honestly. */
export function ScopeClipStub() {
  return (
    <g className="dk-overlay" data-kind="scope-clip" data-deferred="true" aria-label="scope (deferred)">
      <rect x="0" y="0" width="40" height="20" rx="3" className="dk-overlay__stroke" />
      <text x="20" y="14" textAnchor="middle" className="dk-overlay__label">scope</text>
    </g>
  )
}
