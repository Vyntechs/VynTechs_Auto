'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Answer, Citation, Conflict, Flow, Step } from '@/lib/flows/types'
import {
  addAnswer, addStep, removeAnswer, removeStep, setStartStep, updateAnswer, updateStep,
} from '@/lib/curator/flow-mutations'

type State = {
  flowId: string
  flowVersionId: string
  body: Flow
  selectedStepId: string | null
  changeNote: string
  dirty: boolean
}

type Actions = {
  selectStep: (id: string) => void
  applyMutation: (fn: (b: Flow) => Flow) => void
  setChangeNote: (s: string) => void
  markSaved: () => void
}

const Ctx = createContext<(State & Actions) | null>(null)

export function FlowEditorProvider({
  children, flowId, flowVersionId, initialBody, initialChangeNote,
}: {
  children: ReactNode
  flowId: string
  flowVersionId: string
  initialBody: Flow
  initialChangeNote: string
}) {
  const [body, setBody] = useState(initialBody)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(initialBody.startStepId)
  const [changeNote, setChangeNoteState] = useState(initialChangeNote)
  const [dirty, setDirty] = useState(false)

  const applyMutation = useCallback((fn: (b: Flow) => Flow) => {
    setBody((current) => fn(current))
    setDirty(true)
  }, [])
  const markSaved = useCallback(() => setDirty(false), [])
  const selectStep = useCallback((id: string) => setSelectedStepId(id), [])
  const setChangeNote = useCallback((s: string) => {
    setChangeNoteState(s)
    setDirty(true)
  }, [])

  return (
    <Ctx.Provider
      value={{ flowId, flowVersionId, body, selectedStepId, changeNote, dirty, selectStep, applyMutation, setChangeNote, markSaved }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useFlowEditor() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFlowEditor must be inside FlowEditorProvider')
  return c
}

export const FlowEditorMutations = {
  addStep, removeStep, updateStep, addAnswer, updateAnswer, removeAnswer, setStartStep,
}
export type { Answer, Citation, Conflict, Step }
