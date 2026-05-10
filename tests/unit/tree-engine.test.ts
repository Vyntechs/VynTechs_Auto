import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@/lib/ai/client', () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (text: string) => [
    { type: 'text', text, cache_control: { type: 'ephemeral' } },
  ],
}))

import { generateInitialTree, parseTreeJson, updateTree } from '@/lib/ai/tree-engine'

describe('generateInitialTree', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns a parsed tree from a valid JSON LLM response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [
              {
                id: 'scan-codes',
                label: 'Pull DTCs and freeze frame',
                status: 'active',
              },
            ],
            currentNodeId: 'scan-codes',
            message: 'Start by pulling codes and the freeze frame for the active code.',
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    const tree = await generateInitialTree({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '3.5L EcoBoost',
      customerComplaint: 'loss of power going up hills',
    })

    expect(tree.nodes).toHaveLength(1)
    expect(tree.nodes[0].id).toBe('scan-codes')
    expect(tree.currentNodeId).toBe('scan-codes')
    expect(tree.message).toContain('codes')
  })

  it('embeds the retrieval block in the user message when retrieval is provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'go', status: 'active' }],
            currentNodeId: 'a',
            message: 'starting',
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    await generateInitialTree(
      {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-250',
        vehicleEngine: '6.7L Powerstroke',
        customerComplaint: 'P0087, loss of power',
      },
      undefined,
      [
        {
          source: 'web-search',
          url: 'https://x.test',
          title: 'CP4 failure on 6.7 Powerstroke',
          snippet: 'Metal contamination from CP4 pump wear is the dominant pattern.',
        },
      ],
    )

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const call = mockCreate.mock.calls[0]![0]
    const userMessage = call.messages[0].content as string
    expect(userMessage).toContain('Internet retrieval')
    expect(userMessage).toContain('CP4 failure on 6.7 Powerstroke')
    expect(userMessage).toContain('Metal contamination')
  })

  it('omits the retrieval block when retrieval is empty or undefined', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'go', status: 'active' }],
            currentNodeId: 'a',
            message: 'starting',
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    await generateInitialTree({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      customerComplaint: 'x',
    })

    const userMessage = mockCreate.mock.calls[0]![0].messages[0].content as string
    expect(userMessage).not.toContain('Internet retrieval')
  })
})

describe('parseTreeJson', () => {
  const validJson = JSON.stringify({
    nodes: [{ id: 'a', label: 'Step', status: 'active' }],
    currentNodeId: 'a',
    message: 'go',
  })

  it('strips ```json … ``` markdown fences before parsing', () => {
    const wrapped = '```json\n' + validJson + '\n```'
    const tree = parseTreeJson(wrapped)
    expect(tree.currentNodeId).toBe('a')
  })

  it('strips bare ``` … ``` fences before parsing', () => {
    const wrapped = '```\n' + validJson + '\n```'
    const tree = parseTreeJson(wrapped)
    expect(tree.currentNodeId).toBe('a')
  })

  it('throws when the parsed payload is missing nodes', () => {
    const bad = JSON.stringify({ currentNodeId: 'a', message: 'go' })
    expect(() => parseTreeJson(bad)).toThrow(/invalid tree response/)
  })

  it('throws when the parsed payload is missing currentNodeId', () => {
    const bad = JSON.stringify({ nodes: [], message: 'go' })
    expect(() => parseTreeJson(bad)).toThrow(/invalid tree response/)
  })

  it('throws when the parsed payload is missing message', () => {
    const bad = JSON.stringify({ nodes: [], currentNodeId: 'a' })
    expect(() => parseTreeJson(bad)).toThrow(/invalid tree response/)
  })
})

describe('withRetry behavior in generateInitialTree', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('retries on transient error and returns the tree on subsequent success', async () => {
    const validResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'Step', status: 'active' }],
            currentNodeId: 'a',
            message: 'go',
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    }
    mockCreate
      .mockRejectedValueOnce(new Error('overloaded'))
      .mockResolvedValueOnce(validResponse)

    const tree = await generateInitialTree({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(tree.currentNodeId).toBe('a')
  })

  it('retries when the LLM returns prose that fails JSON parsing', async () => {
    const proseResponse = {
      content: [{ type: 'text', text: 'sorry I cannot comply' }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }
    const validResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'Step', status: 'active' }],
            currentNodeId: 'a',
            message: 'go',
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    }
    mockCreate
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(validResponse)

    const tree = await generateInitialTree({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(tree.currentNodeId).toBe('a')
  })

  it('throws after exhausting all retries on persistent failure', async () => {
    mockCreate.mockRejectedValue(new Error('overloaded'))
    await expect(
      generateInitialTree({
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      }),
    ).rejects.toThrow('overloaded')
    expect(mockCreate).toHaveBeenCalledTimes(3)
  })
})

describe('updateTree', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns the updated tree based on the tech observation', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [
              { id: 'scan-codes', label: 'Pull DTCs', status: 'resolved' },
              { id: 'inspect-cac', label: 'Inspect CAC pipe', status: 'active' },
            ],
            currentNodeId: 'inspect-cac',
            message: 'Codes confirmed. Now inspect the cold-side intercooler pipe.',
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    const result = await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      currentTree: {
        nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
        currentNodeId: 'scan-codes',
        message: 'Pull codes',
      },
      observation: 'Got P0299 with 3.6 psi underboost in the freeze frame',
    })

    expect(result.currentNodeId).toBe('inspect-cac')
    expect(result.nodes.find((n) => n.id === 'scan-codes')?.status).toBe('resolved')
  })

  it('includes artifact evidence in the user message when artifacts are provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'Step', status: 'active' }],
            currentNodeId: 'a',
            message: 'ok',
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    })

    await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      currentTree: {
        nodes: [{ id: 'a', label: 'Step', status: 'active' }],
        currentNodeId: 'a',
        message: 'go',
      },
      observation: 'codes pulled',
      artifacts: [
        { kind: 'scan_screen', summary: 'P0299 active', text: 'P0299 underboost' },
      ],
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const call = mockCreate.mock.calls[0][0]
    const userContent: string = call.messages[0].content
    expect(userContent).toContain('Artifacts captured for this step')
    expect(userContent).toContain('scan_screen')
    expect(userContent).toContain('P0299 active')
    expect(userContent).toContain('P0299 underboost')
  })

  it('does not include an artifact block when no artifacts are provided', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'Step', status: 'active' }],
            currentNodeId: 'a',
            message: 'ok',
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    })

    await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      currentTree: {
        nodes: [{ id: 'a', label: 'Step', status: 'active' }],
        currentNodeId: 'a',
        message: 'go',
      },
      observation: 'observed',
    })

    const call = mockCreate.mock.calls[0][0]
    const userContent: string = call.messages[0].content
    expect(userContent).not.toContain('Artifacts captured')
  })
})

describe('parseTreeJson with requestedArtifact', () => {
  it('accepts a response that includes requestedArtifact', () => {
    const json = JSON.stringify({
      nodes: [{ id: 'a', label: 'Step', status: 'active' }],
      currentNodeId: 'a',
      message: 'go',
      requestedArtifact: { kind: 'scan_screen', prompt: 'Capture the DTC screen' },
    })
    const tree = parseTreeJson(json)
    expect(tree.requestedArtifact).toEqual({ kind: 'scan_screen', prompt: 'Capture the DTC screen' })
  })

  it('accepts a response without requestedArtifact (not required)', () => {
    const json = JSON.stringify({
      nodes: [{ id: 'a', label: 'Step', status: 'active' }],
      currentNodeId: 'a',
      message: 'go',
    })
    const tree = parseTreeJson(json)
    expect(tree.requestedArtifact).toBeUndefined()
  })
})

describe('updateTree with retrieval', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('passes retrieval snippets into the prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'verify', label: 'Smoke test', status: 'active' }],
            currentNodeId: 'verify',
            message: 'NHTSA bulletin matches.',
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 60 },
    })
    await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'power loss',
      },
      currentTree: { nodes: [], currentNodeId: 'scan-codes', message: '' },
      observation: 'codes pulled',
      retrieval: [
        { source: 'nhtsa', title: '17V123 wastegate', snippet: 'recall: wastegate vacuum line' },
      ],
    })
    const lastCall = mockCreate.mock.calls.at(-1)![0]
    const userMsgs = lastCall.messages.filter((m: { role: string }) => m.role === 'user')
    const text = userMsgs[userMsgs.length - 1].content as string
    expect(text).toContain('Internet retrieval')
    expect(text).toContain('nhtsa')
  })
})

describe('generateInitialTree with corpus context', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'verify-corpus', label: 'Verify wastegate line', status: 'active' }],
            currentNodeId: 'verify-corpus',
            message: 'Prior cases point to wastegate vacuum line. Verify first.',
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 60 },
    })
  })

  it('includes a Corpus context block with rootCause, confidence, success, comebacks, similarity', async () => {
    const { generateInitialTree } = await import('@/lib/ai/tree-engine')
    await generateInitialTree(
      {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'power loss',
      },
      [
        {
          id: 'c1',
          rootCause: 'wastegate vacuum line crack',
          summary: '2018 F-150 EcoBoost: WG line',
          confidenceScore: 0.85,
          successConfirmCount: 5,
          comebackRecordedCount: 0,
          similarityScore: 0.91,
        },
      ],
    )
    const userMsg = mockCreate.mock.calls.at(-1)![0].messages[0].content as string
    expect(userMsg).toContain('Corpus context')
    expect(userMsg).toContain('wastegate vacuum line crack')
    expect(userMsg).toContain('confidence=0.85')
    expect(userMsg).toContain('success=5')
    expect(userMsg).toContain('comebacks=0')
    expect(userMsg).toContain('similarity=0.91')
  })

  it('emits a "no prior matches" line when corpus is empty', async () => {
    const { generateInitialTree } = await import('@/lib/ai/tree-engine')
    await generateInitialTree(
      {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'power loss',
      },
      [],
    )
    const userMsg = mockCreate.mock.calls.at(-1)![0].messages[0].content as string
    expect(userMsg).toMatch(/Corpus context: no prior matches/)
  })

  it('omits the corpus block entirely when corpus arg is not passed (back-compat)', async () => {
    const { generateInitialTree } = await import('@/lib/ai/tree-engine')
    await generateInitialTree({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'power loss',
    })
    const userMsg = mockCreate.mock.calls.at(-1)![0].messages[0].content as string
    expect(userMsg).not.toContain('Corpus context')
  })
})

describe('updateTree with corpus context', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'Step', status: 'active' }],
            currentNodeId: 'a',
            message: 'ok',
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    })
  })

  it('renders real CorpusMatch fields in the corpus block', async () => {
    const { updateTree } = await import('@/lib/ai/tree-engine')
    await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'power loss',
      },
      currentTree: { nodes: [], currentNodeId: 'a', message: '' },
      observation: 'codes pulled',
      corpus: [
        {
          id: 'c1',
          rootCause: 'wastegate vacuum line crack',
          summary: 'WG line',
          confidenceScore: 0.85,
          successConfirmCount: 5,
          comebackRecordedCount: 0,
          similarityScore: 0.91,
        },
      ],
    })
    const userMsg = mockCreate.mock.calls.at(-1)![0].messages[0].content as string
    expect(userMsg).toContain('Corpus matches')
    expect(userMsg).toContain('wastegate vacuum line crack')
    expect(userMsg).toContain('confidence=0.85')
  })
})

describe('parseTreeJson — structured whatWouldClose', () => {
  function makeTree(proposedAction: unknown): string {
    return JSON.stringify({
      nodes: [{ id: 'n1', label: 'Step', status: 'active' }],
      currentNodeId: 'n1',
      message: 'm',
      proposedAction,
    })
  }

  it('accepts whatWouldClose as a confirm object', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'back-probe pin 4',
        confidence: 0.7,
        confidenceGap: 'unsure pin layout',
        whatWouldClose: { kind: 'confirm', prompt: 'reseat clean? yes / no?' },
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toEqual({
      kind: 'confirm',
      prompt: 'reseat clean? yes / no?',
    })
  })

  it('accepts whatWouldClose as a photo object', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'back-probe pin 4',
        confidence: 0.7,
        confidenceGap: 'unsure pin layout',
        whatWouldClose: {
          kind: 'photo',
          prompt: 'snap the C171 pinout',
          extractFor: 'full pinout for C171',
        },
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toEqual({
      kind: 'photo',
      prompt: 'snap the C171 pinout',
      extractFor: 'full pinout for C171',
    })
  })

  it('accepts whatWouldClose as a legacy string (back-compat)', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'back-probe pin 4',
        confidence: 0.7,
        confidenceGap: 'unsure pin layout',
        whatWouldClose: 'Quote the IPC supply spec from the FSM.',
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toBe(
      'Quote the IPC supply spec from the FSM.',
    )
  })

  it('rejects photo whatWouldClose missing extractFor', () => {
    expect(() =>
      parseTreeJson(
        makeTree({
          description: 'd',
          confidence: 0.7,
          whatWouldClose: { kind: 'photo', prompt: 'snap something' },
        }),
      ),
    ).toThrow(/extractFor/)
  })

  it('rejects whatWouldClose with unknown kind', () => {
    expect(() =>
      parseTreeJson(
        makeTree({
          description: 'd',
          confidence: 0.7,
          whatWouldClose: { kind: 'somethingElse', prompt: 'p' },
        }),
      ),
    ).toThrow(/kind/)
  })

  it('accepts yesLabel and noLabel on a confirm whatWouldClose', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'verify 12V at coil',
        confidence: 0.85,
        confidenceGap: 'no electrical confirmation yet',
        whatWouldClose: {
          kind: 'confirm',
          prompt: 'Do you have 12V at the clutch coil?',
          yesLabel: 'Yes — I have 12V',
          noLabel: 'No — no voltage',
        },
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toEqual({
      kind: 'confirm',
      prompt: 'Do you have 12V at the clutch coil?',
      yesLabel: 'Yes — I have 12V',
      noLabel: 'No — no voltage',
    })
  })

  it('accepts a confirm whatWouldClose without yesLabel/noLabel (back-compat)', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'check coolant',
        confidence: 0.85,
        confidenceGap: 'visual not yet attested',
        whatWouldClose: { kind: 'confirm', prompt: 'Coolant milky?' },
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toEqual({
      kind: 'confirm',
      prompt: 'Coolant milky?',
    })
  })

  it('rejects non-string yesLabel on a confirm whatWouldClose', () => {
    expect(() =>
      parseTreeJson(
        makeTree({
          description: 'd',
          confidence: 0.5,
          whatWouldClose: { kind: 'confirm', prompt: 'q', yesLabel: 42 },
        }),
      ),
    ).toThrow(/yesLabel/)
  })

  it('rejects non-string noLabel on a confirm whatWouldClose', () => {
    expect(() =>
      parseTreeJson(
        makeTree({
          description: 'd',
          confidence: 0.5,
          whatWouldClose: { kind: 'confirm', prompt: 'q', noLabel: false },
        }),
      ),
    ).toThrow(/noLabel/)
  })
})
