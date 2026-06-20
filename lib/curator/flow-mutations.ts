import type { Answer, Flow, QuestionStep, Step } from '@/lib/flows/types'

export function addStep(
  body: Flow,
  args: { id: string; kind: 'question' | 'procedure'; title: string; question?: string; instructions?: string },
): Flow {
  if (body.steps[args.id]) throw new Error(`Step "${args.id}" already exists`)
  const newStep: Step =
    args.kind === 'question'
      ? { kind: 'question', n: 1, of: 1, title: args.title, question: args.question ?? '', answers: [] }
      : { kind: 'procedure', n: 1, of: 1, title: args.title, instructions: args.instructions ?? '', next: '' }
  return { ...body, steps: { ...body.steps, [args.id]: newStep } }
}

export function removeStep(body: Flow, stepId: string): Flow {
  if (stepId === body.startStepId) {
    throw new Error('Cannot remove the start step. Reassign startStepId first.')
  }
  const { [stepId]: _removed, ...rest } = body.steps
  return { ...body, steps: rest }
}

export function updateStep(body: Flow, stepId: string, patch: Partial<Step>): Flow {
  const existing = body.steps[stepId]
  if (!existing) throw new Error(`Step "${stepId}" not found`)
  const merged = { ...existing, ...patch } as Step
  return { ...body, steps: { ...body.steps, [stepId]: merged } }
}

export function addAnswer(body: Flow, stepId: string, answer: Answer): Flow {
  const step = body.steps[stepId]
  if (!step || step.kind !== 'question') throw new Error(`Step "${stepId}" is not a question step`)
  const updated: QuestionStep = { ...step, answers: [...step.answers, answer] }
  return { ...body, steps: { ...body.steps, [stepId]: updated } }
}

export function updateAnswer(body: Flow, stepId: string, answerId: string, patch: Partial<Answer>): Flow {
  const step = body.steps[stepId]
  if (!step || step.kind !== 'question') throw new Error(`Step "${stepId}" is not a question step`)
  const updated: QuestionStep = {
    ...step,
    answers: step.answers.map((a) => (a.id === answerId ? ({ ...a, ...patch } as Answer) : a)),
  }
  return { ...body, steps: { ...body.steps, [stepId]: updated } }
}

export function removeAnswer(body: Flow, stepId: string, answerId: string): Flow {
  const step = body.steps[stepId]
  if (!step || step.kind !== 'question') throw new Error(`Step "${stepId}" is not a question step`)
  const updated: QuestionStep = { ...step, answers: step.answers.filter((a) => a.id !== answerId) }
  return { ...body, steps: { ...body.steps, [stepId]: updated } }
}

export function setStartStep(body: Flow, stepId: string): Flow {
  if (!body.steps[stepId]) throw new Error(`Step "${stepId}" not found`)
  return { ...body, startStepId: stepId }
}
