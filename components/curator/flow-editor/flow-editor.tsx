'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Flow } from '@/lib/flows/types'
import { MainHeader } from '@/components/vt/desktop'
import { FlowStatusPill } from '@/components/curator/flow-status-pill'
import { FlowEditorProvider } from './flow-editor-provider'
import { StepListPane } from './tree-pane'
import { NodeDetailPane } from './node-detail-pane'
import { PublishBar } from './publish-bar'

type Props = {
  flowId: string
  displayTitle: string
  platformDisplay: string
  symptomDisplay: string
  flowVersionId: string
  versionNumber: number
  initialBody: Flow
  initialChangeNote: string
}

export function FlowEditor(props: Props) {
  // On phones the two panes become a drill-down: list -> tap a step -> detail.
  // On desktop both panes are always visible (CSS ignores this attribute).
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  return (
    <FlowEditorProvider
      flowId={props.flowId}
      flowVersionId={props.flowVersionId}
      initialBody={props.initialBody}
      initialChangeNote={props.initialChangeNote}
    >
      <MainHeader
        eyebrowSlot={
          <Link href={`/curator/flows/${props.flowId}`} className="vt-curator-backlink">
            ← {props.displayTitle}
          </Link>
        }
        title="Edit draft"
        sub={`${props.platformDisplay} · ${props.symptomDisplay}`}
        actions={<FlowStatusPill status="draft" />}
      />
      <div className="vt-floweditor" data-mobile-view={mobileView}>
        <div className="vt-floweditor__panes">
          <aside className="vt-floweditor__list">
            <StepListPane onPick={() => setMobileView('detail')} />
          </aside>
          <section className="vt-floweditor__detail">
            <NodeDetailPane onBack={() => setMobileView('list')} />
          </section>
        </div>
        <PublishBar />
      </div>
    </FlowEditorProvider>
  )
}
