import { classifyAction, type RiskJudgment } from './risk-classifier'
import { getThreshold } from '@/lib/db/queries'
import type { AppDb } from '@/lib/db/queries'
import type { ProposedAction, WhatWouldClose } from '@/lib/ai/tree-engine'

export type GateOption = 'gather_more_low_risk' | 'decline' | 'defer'

export type GateDecision = {
  allow: boolean
  riskClass: RiskJudgment['riskClass']
  threshold: number
  confidence: number
  rationale: string
  gap?: string
  options?: GateOption[]
  confidenceGap?: string
  whatWouldClose?: string | WhatWouldClose
}

export async function gateProposedAction(input: {
  db: AppDb
  action: ProposedAction
  vehicleFamily?: string
  symptomClass?: string
}): Promise<GateDecision> {
  const judgment = await classifyAction(input.action.description)
  const threshold = await getThreshold(input.db, {
    riskClass: judgment.riskClass,
    vehicleFamily: input.vehicleFamily,
    symptomClass: input.symptomClass,
  })
  const allow = input.action.confidence >= threshold

  const base = {
    riskClass: judgment.riskClass,
    threshold,
    confidence: input.action.confidence,
    rationale: judgment.rationale,
  } as const

  if (allow) return { allow: true, ...base }

  return {
    allow: false,
    ...base,
    gap: `Required confidence ${(threshold * 100).toFixed(0)}% for risk class "${judgment.riskClass}"; current confidence ${(input.action.confidence * 100).toFixed(0)}%.`,
    options: ['gather_more_low_risk', 'decline', 'defer'],
    confidenceGap: input.action.confidenceGap,
    whatWouldClose: input.action.whatWouldClose,
  }
}
