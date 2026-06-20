// Lifecycle status of a flow, shown the same way everywhere (list, detail,
// editor): a colored dot for the glance + a plain-English word for certainty.
//   published       — a live version techs can run
//   draft           — authored, never published yet
//   changed         — a live version PLUS a newer draft being worked on
//   empty           — created but no content yet (honest fallback)
export type FlowStatus = 'published' | 'draft' | 'changed' | 'empty'

const LABEL: Record<FlowStatus, string> = {
  published: 'Published',
  draft: 'Draft',
  changed: 'Changes pending',
  empty: 'Not started',
}

export function FlowStatusPill({ status }: { status: FlowStatus }) {
  return (
    <span className={`vt-pill vt-pill--flow-${status}`}>
      <span className="vt-pill__dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  )
}
