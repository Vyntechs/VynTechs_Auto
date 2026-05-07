import { describe, it, expect } from 'vitest'
import { buildRepairGuidancePrompt } from '@/lib/ai/repair-guidance'
import type { TreeState, SessionEvent } from '@/lib/db/schema'

const baseLockedTree: TreeState = {
  nodes: [{ id: 'replace', label: 'Replace booster + master cyl', status: 'active' }],
  currentNodeId: 'replace',
  message: 'Brake fluid in booster.',
  done: true,
  phase: 'repairing',
  diagnosisLockedAt: '2026-05-07T10:21:12Z',
  rootCauseSummary: 'Brake booster crimp seam vacuum leak + master cyl backward leakage.',
  proposedAction: {
    confidence: 0.98,
    description: 'Replace booster + master cyl as a matched pair; full four-corner bleed.',
    expectedSignal: 'Firm pedal post-bleed; fuel trims within ±5% at idle.',
  },
}

function makeEvent(
  eventType: 'repair_observation' | 'repair_guidance',
  text: string,
  createdAt: Date,
  id = crypto.randomUUID(),
): SessionEvent {
  if (eventType === 'repair_observation') {
    return {
      id,
      sessionId: 'sess-1',
      nodeId: 'replace',
      eventType,
      observationText: text,
      aiResponse: null,
      createdAt,
    } as SessionEvent
  }
  return {
    id,
    sessionId: 'sess-1',
    nodeId: 'replace',
    eventType,
    observationText: null,
    aiResponse: { repairGuidance: { text } },
    createdAt,
  } as SessionEvent
}

describe('buildRepairGuidancePrompt', () => {
  it('includes locked diagnosis (rootCauseSummary, repair description, expected signal) in the user message', () => {
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: [],
      observation: 'Master cyl bolts are corroded — replace?',
    })

    expect(out.userMessage).toContain('Brake booster crimp seam vacuum leak')
    expect(out.userMessage).toContain('Replace booster + master cyl as a matched pair')
    expect(out.userMessage).toContain('Firm pedal post-bleed')
    expect(out.userMessage).toContain('Master cyl bolts are corroded')
  })

  it('includes the system prompt directive forbidding rootCauseSummary revision', () => {
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: [],
      observation: 'q',
    })
    expect(out.systemPrompt.toLowerCase()).toContain('locked')
    expect(out.systemPrompt.toLowerCase()).toMatch(/do not (modify|revise|alter)/i)
  })

  it('includes recent repair conversation in chronological order', () => {
    const events = [
      makeEvent('repair_observation', 'first tech message', new Date('2026-05-07T10:25:00Z')),
      makeEvent('repair_guidance', 'first AI reply', new Date('2026-05-07T10:25:30Z')),
      makeEvent('repair_observation', 'second tech message', new Date('2026-05-07T10:30:00Z')),
      makeEvent('repair_guidance', 'second AI reply', new Date('2026-05-07T10:30:30Z')),
    ]
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: events,
      observation: 'newest tech message',
    })

    const idxFirst = out.userMessage.indexOf('first tech message')
    const idxFirstAI = out.userMessage.indexOf('first AI reply')
    const idxSecond = out.userMessage.indexOf('second tech message')
    const idxSecondAI = out.userMessage.indexOf('second AI reply')
    const idxNewest = out.userMessage.indexOf('newest tech message')

    expect(idxFirst).toBeGreaterThan(-1)
    expect(idxFirst).toBeLessThan(idxFirstAI)
    expect(idxFirstAI).toBeLessThan(idxSecond)
    expect(idxSecond).toBeLessThan(idxSecondAI)
    expect(idxSecondAI).toBeLessThan(idxNewest)
  })

  it('truncates context to last 10 events when more than 10 exist', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent(
        i % 2 === 0 ? 'repair_observation' : 'repair_guidance',
        `event ${i}`,
        new Date(`2026-05-07T10:${String(25 + i).padStart(2, '0')}:00Z`),
      ),
    )
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: events,
      observation: 'newest',
    })

    expect(out.userMessage).not.toContain('event 0')
    expect(out.userMessage).not.toContain('event 4')
    expect(out.userMessage).toContain('event 5')
    expect(out.userMessage).toContain('event 14')
  })

  it('does not include diagnostic tree nodes in the prompt', () => {
    const out = buildRepairGuidancePrompt({
      tree: baseLockedTree,
      recentEvents: [],
      observation: 'q',
    })
    expect(out.userMessage).not.toContain('"nodes"')
    expect(out.userMessage).not.toContain('currentNodeId')
  })
})
