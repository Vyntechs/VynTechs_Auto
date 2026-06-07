/**
 * Non-electrical connection (connectionKind). fuel-line and mechanical-link get
 * distinct styles; any unseen kind degrades to a neutral link — never blank.
 */
export function ConnectionLink({ kind, d }: { kind: string; d: string }) {
  return <path className="dk-link" d={d} data-kind={kind} />
}
