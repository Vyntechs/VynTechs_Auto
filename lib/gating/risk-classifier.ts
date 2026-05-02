import { anthropic, cachedSystem } from '@/lib/ai/client'
import { RISK_CLASSIFIER_SYSTEM } from '@/lib/ai/prompts'
import type { RiskClass } from '@/lib/db/schema'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export type RiskJudgment = {
  riskClass: RiskClass
  rationale: string
  reversible: boolean
  source: 'rule' | 'llm'
}

type Rule = {
  match: RegExp
  riskClass: RiskClass
  reversible: boolean
  rationale: string
}

const RULES: Rule[] = [
  // destructive — match first so cuts/reflashes never get downgraded by softer rules
  {
    match: /\b(cut|splice)\b.*\b(wire|harness|loom)\b/i,
    riskClass: 'destructive',
    reversible: false,
    rationale: 'wire cut is irreversible',
  },
  {
    match: /\b(module replace|module replacement|reflash|reprogram|flash)\b/i,
    riskClass: 'destructive',
    reversible: false,
    rationale: 'module replacement / reflash is irreversible',
  },
  {
    match: /\b(remove|delete) (a )?dtc by (clearing|reflash)/i,
    riskClass: 'destructive',
    reversible: false,
    rationale: 'reflash to clear codes is invasive',
  },
  // high — power/CAN circuits, voltage application, jumpers
  {
    match: /\bback-?probe\b.*(?:\b(?:power|battery|can|canbus|j1939)\b|b\+|\bcan\s+bus\b)/i,
    riskClass: 'high',
    reversible: true,
    rationale: 'back-probe of power or CAN bus',
  },
  {
    match: /\bvoltage application\b|\bapply (12|battery) v/i,
    riskClass: 'high',
    reversible: true,
    rationale: 'applied voltage can damage modules',
  },
  {
    match: /\bjumper\b.*\bconnector\b/i,
    riskClass: 'high',
    reversible: true,
    rationale: 'jumpering connectors can short or energize',
  },
  // medium — back-probe of non-power signals, sensor swaps
  {
    match: /\bback-?probe\b.*\b(signal|sensor|low-side)\b/i,
    riskClass: 'medium',
    reversible: true,
    rationale: 'back-probe on a non-power signal wire',
  },
  {
    match: /\b(swap|replace)\b.*\b(sensor|relay)\b/i,
    riskClass: 'medium',
    reversible: true,
    rationale: 'sensor swap is reversible but invasive',
  },
  // low — non-destructive checks
  {
    match: /\bsmoke test\b/i,
    riskClass: 'low',
    reversible: true,
    rationale: 'smoke test is non-destructive',
  },
  {
    match: /\bfuse\b.*\b(pull|swap|replace)\b/i,
    riskClass: 'low',
    reversible: true,
    rationale: 'fuse swap is reversible',
  },
  {
    match: /\b(visual inspection|inspect)\b.*\b(connector|harness|line|hose)\b/i,
    riskClass: 'low',
    reversible: true,
    rationale: 'visual inspection only',
  },
  // zero — read-only observation
  {
    match: /\bread\b.*\b(pid|live data|dtc|freeze frame|module)\b/i,
    riskClass: 'zero',
    reversible: true,
    rationale: 'read-only data acquisition',
  },
  {
    match: /\b(listen|observe|look at|inspect visually)\b/i,
    riskClass: 'zero',
    reversible: true,
    rationale: 'sensory observation only',
  },
  {
    match: /\b(scan)\b.*(codes|vehicle|module)/i,
    riskClass: 'zero',
    reversible: true,
    rationale: 'code scan is read-only',
  },
]

export async function classifyAction(actionText: string): Promise<RiskJudgment> {
  for (const rule of RULES) {
    if (rule.match.test(actionText)) {
      return {
        riskClass: rule.riskClass,
        rationale: rule.rationale,
        reversible: rule.reversible,
        source: 'rule',
      }
    }
  }

  const res = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 200,
    system: cachedSystem(RISK_CLASSIFIER_SYSTEM),
    messages: [{ role: 'user', content: `Action: ${actionText}\n\nReturn JSON only.` }],
  })
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') {
    return {
      riskClass: 'high',
      rationale: 'classifier failed; default to high (safety bias)',
      reversible: false,
      source: 'llm',
    }
  }
  try {
    const cleaned = block.text
      .trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
    const parsed = JSON.parse(cleaned) as Omit<RiskJudgment, 'source'>
    return { ...parsed, source: 'llm' }
  } catch {
    return {
      riskClass: 'high',
      rationale: 'classifier returned malformed JSON; default to high',
      reversible: false,
      source: 'llm',
    }
  }
}
