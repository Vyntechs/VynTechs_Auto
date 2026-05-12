export type RiskLevel = 'zero' | 'low' | 'medium' | 'high' | 'destructive'

export type PillKind = 'active' | 'queued' | 'deferred' | 'new'

export type TreeStepStatus = 'done' | 'active' | 'pending'

export type TreeStep = {
  id?: string
  label: string
  status: TreeStepStatus
}
