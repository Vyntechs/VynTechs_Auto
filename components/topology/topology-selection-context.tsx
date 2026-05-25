'use client'

import { createContext, useContext } from 'react'

type SelectionHandlers = {
  onSelectPin: (pinId: string) => void
  onSelectComponent: (componentId: string) => void
  onClear: () => void
}

const TopologySelectionContext = createContext<SelectionHandlers | null>(null)

export const TopologySelectionProvider = TopologySelectionContext.Provider

/**
 * Custom React Flow nodes can't receive arbitrary props from the parent —
 * only `data`. This context lets the custom node fire pin/component clicks
 * back up without prop-drilling through React Flow's edge `data`.
 */
export function useTopologySelection(): SelectionHandlers {
  const ctx = useContext(TopologySelectionContext)
  if (!ctx) {
    throw new Error(
      'useTopologySelection must be inside TopologySelectionProvider',
    )
  }
  return ctx
}
