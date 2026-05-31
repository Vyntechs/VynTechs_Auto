'use client'

import type { Flow } from '@/lib/flows/types'
import { FlowEditorProvider } from './flow-editor-provider'
import { TreePane } from './tree-pane'
import { NodeDetailPane } from './node-detail-pane'
import { SourcesPane } from './sources-pane'
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
  return (
    <FlowEditorProvider
      flowId={props.flowId}
      flowVersionId={props.flowVersionId}
      initialBody={props.initialBody}
      initialChangeNote={props.initialChangeNote}
    >
      <div className="vt-flow-editor">
        <header className="vt-flow-editor-header">
          <div>
            <h1>{props.displayTitle}</h1>
            <p className="vt-flow-editor-subtitle">
              {props.platformDisplay} · {props.symptomDisplay} · draft v{props.versionNumber}
            </p>
          </div>
        </header>

        <div className="vt-flow-editor-grid">
          <aside className="vt-flow-editor-tree"><TreePane /></aside>
          <main className="vt-flow-editor-detail"><NodeDetailPane /></main>
          <aside className="vt-flow-editor-sources"><SourcesPane /></aside>
        </div>

        <PublishBar />
      </div>
    </FlowEditorProvider>
  )
}
