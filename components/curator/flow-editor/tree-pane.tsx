'use client'

import { Tree, type NodeApi } from 'react-arborist'
import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import type { Flow } from '@/lib/flows/types'

type Node = {
  id: string
  name: string
  kind: 'question' | 'procedure' | 'finding'
  children?: Node[]
}

function buildTree(body: Flow): Node[] {
  const seen = new Set<string>()
  const walk = (stepId: string): Node | null => {
    if (seen.has(stepId)) return null
    seen.add(stepId)
    const step = body.steps[stepId]
    if (!step) return null
    const children: Node[] = []
    if (step.kind === 'question') {
      for (const a of step.answers) {
        if ('next' in a && a.next) {
          const child = walk(a.next)
          if (child) children.push({ ...child, name: `[${a.label}] → ${child.name}` })
        } else if ('finding' in a && a.finding) {
          children.push({
            id: `${stepId}__${a.id}__finding`,
            name: `[${a.label}] → FINDING: ${a.finding.verdict}`,
            kind: 'finding',
          })
        }
      }
    } else if (step.kind === 'procedure') {
      const child = walk(step.next)
      if (child) children.push({ ...child, name: `→ ${child.name}` })
    }
    return { id: stepId, name: `${stepId}: ${step.title || '(untitled)'}`, kind: step.kind, children }
  }
  const root = walk(body.startStepId)
  return root ? [root] : []
}

export function TreePane() {
  const { body, selectedStepId, selectStep, applyMutation } = useFlowEditor()
  const data = buildTree(body)

  const onAddStep = () => {
    const newId = `step-${Object.keys(body.steps).length + 1}`
    applyMutation((b) => FlowEditorMutations.addStep(b, { id: newId, kind: 'question', title: '', question: '' }))
    selectStep(newId)
  }

  const onSelect = (nodes: NodeApi<Node>[]) => {
    const n = nodes[0]
    if (!n) return
    if (n.data.kind === 'finding') return // virtual node; edit its parent step instead
    selectStep(n.data.id)
  }

  return (
    <div className="vt-tree-pane">
      <div className="vt-tree-pane-header">
        <strong>Tree</strong>
        <button onClick={onAddStep} className="vt-btn vt-btn-secondary">+ Step</button>
      </div>
      <Tree
        data={data}
        idAccessor="id"
        childrenAccessor="children"
        openByDefault
        onSelect={onSelect}
        selection={selectedStepId ?? undefined}
        height={600}
        width={320}
        rowHeight={32}
      >
        {({ node, style, dragHandle }) => (
          <div ref={dragHandle} style={style} className={`vt-tree-row vt-tree-row--${node.data.kind}`}>
            <span>{node.data.name}</span>
          </div>
        )}
      </Tree>
    </div>
  )
}
