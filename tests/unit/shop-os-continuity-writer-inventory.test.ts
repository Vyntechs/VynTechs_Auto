import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createTypeScriptProgramGraphV1 } from '@/tests/helpers/typescript-program-graph'
import { isDiagnosticsGatedRoute } from '@/lib/auth-access'
import {
  CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1,
  CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1,
  CONTINUITY_LOCK_ONLY_INVENTORY_V1,
  CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1,
  CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1,
  CONTINUITY_WRITER_INVENTORY_V1,
} from '@/lib/shop-os/continuity/mutation-foundation/writer-inventory'

const root = process.cwd()
const programGraph = createTypeScriptProgramGraphV1()

async function source(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

async function applicationSources(directory: string): Promise<string[]> {
  const absolute = resolve(root, directory)
  const entries = await readdir(absolute, { withFileTypes: true })
  const children = await Promise.all(entries.map(async (entry) => {
    const path = resolve(absolute, entry.name)
    if (entry.isDirectory()) return applicationSources(relative(root, path))
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return []
    return [relative(root, path)]
  }))
  return children.flat().sort()
}

function exportedFunctionNames(text: string): Set<string> {
  const parsed = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  for (const statement of parsed.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
    if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      names.add(statement.name.text)
    }
  }
  return names
}

describe('ShopOS continuity writer manifest', () => {
  it('encodes the exact winning writer, creation-helper, and lock-only families', () => {
    expect(CONTINUITY_WRITER_INVENTORY_V1.map(({ file, mutations }) => ({ file, mutations }))).toEqual([
      { file: 'lib/tickets.ts', mutations: ['createTicket', 'addTicketJob', 'mutateTicketJobAssignment'] },
      { file: 'lib/intake/counter-ticket.ts', mutations: ['createCounterTicket'] },
      { file: 'lib/intake/quick-ticket.ts', mutations: ['createQuickTicket'] },
      { file: 'lib/shop-os/canned-jobs.ts', mutations: ['applyCannedJobToTicket'] },
      { file: 'lib/shop-os/customer-stories.ts', mutations: ['generateAndSaveCustomerStory', 'saveReviewedCustomerStory'] },
      { file: 'lib/shop-os/diagnostic-start.ts', mutations: ['acquireDiagnosticStart', 'finalizeDiagnosticStart', 'recordDiagnosticStartFailure'] },
      { file: 'lib/shop-os/parts-offers.ts', mutations: ['captureManualOffer', 'removeManualOffer'] },
      { file: 'lib/shop-os/quotes.ts', mutations: ['createQuoteVersion', 'recordQuoteDecision', 'createDraftLine', 'replaceDraftLine', 'deleteDraftLine'] },
      { file: 'lib/shop-os/simple-work.ts', mutations: ['mutateSimpleWork', 'createWorkEscalation'] },
      { file: 'lib/sessions.ts', mutations: ['createSessionForUser', 'closeSessionForUser'] },
    ])
    expect(CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1).toEqual([{
      file: 'lib/intake/ticket-identity.ts',
      mutations: ['materializeTicketIntakeIdentityInLockedScopeV1'],
      callers: ['createCounterTicket', 'createQuickTicket'],
      returnsOpaque: 'MaterializedTicketIntakeIdentityV1',
      soleConsumer: 'lib/tickets.ts#resolveTicketCreationInLockedScopeV1',
      createdRowsBridge: 'lib/tickets.ts#finalizeResolvedTicketCreationInTransactionV1',
    }])
    expect(CONTINUITY_LOCK_ONLY_INVENTORY_V1).toHaveLength(3)
    expect(CONTINUITY_LOCK_ONLY_INVENTORY_V1.map((entry) => entry.file)).toEqual([
      'lib/shop-os/repair-authorization.ts',
      'lib/sessions.ts',
      'lib/diagnostics/adaptive/state.ts',
    ])
  })

  it('encodes exact nested, dormant, and gated non-winning classifications', () => {
    expect(CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1.map(({ helper, allowedCallers }) => ({ helper, allowedCallers }))).toEqual([
      { helper: 'appendSessionEvent', allowedCallers: ['lib/sessions.ts#advanceSession', 'lib/sessions.ts#closeSessionForUser', 'lib/sessions.ts#recordAmbientConditions', 'lib/sessions.ts#releaseGateForUser', 'lib/sessions.ts#declineOrDeferSessionForUser', 'lib/sessions.ts#abandonSessionForUser', 'lib/sessions.ts#lockDiagnosisForUser', 'lib/sessions.ts#lockDiagnosisFromWizard', 'lib/sessions.ts#submitRepairObservationForUser'] },
      { helper: 'closeSession', allowedCallers: ['lib/sessions.ts#closeSessionForUser'] },
      { helper: 'updateSessionTreeState', allowedCallers: ['lib/sessions.ts#advanceSession', 'lib/sessions.ts#recordAmbientConditions', 'lib/sessions.ts#releaseGateForUser', 'lib/sessions.ts#lockDiagnosisForUser'] },
      { helper: 'updateSessionIntake', allowedCallers: ['lib/sessions.ts#recordAmbientConditions'] },
      { helper: 'updateSessionMaxCorpusSimilarity', allowedCallers: ['lib/retrieval/wire-into-tree.ts#buildUpdateTreeWithRetrieval'] },
      { helper: 'setSessionTerminalStatus', allowedCallers: ['lib/sessions.ts#declineOrDeferSessionForUser', 'lib/sessions.ts#abandonSessionForUser'] },
      { helper: 'createSession', allowedCallers: [] },
    ])
    expect(CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1).toEqual([{
      file: 'lib/intake/session.ts',
      mutations: ['createSessionFromIntake'],
      allowedEntrypoints: ['app/api/intake/submit/route.ts#POST'],
      nestedHelpers: ['lib/intake/customers.ts#upsertCustomer', 'lib/intake/vehicles.ts#upsertVehicle'],
      gate: 'diagnostics_release_and_entitlement_refused',
    }])
    expect(CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1.map((entry) => entry.file)).toEqual([
      'lib/sessions.ts',
      'lib/retrieval/wire-into-tree.ts',
      'lib/curator/deferred-actions.ts',
      'app/api/sessions/[id]/wizard-state/route.ts',
    ])
  })
})

describe('ShopOS continuity writer source inventory', () => {
  it('assigns every semantic tracked-table mutation to a registered transitive writer root', () => {
    const roots = [
      ...CONTINUITY_WRITER_INVENTORY_V1.flatMap(({ file, mutations }) =>
        mutations.map((name) => `${file}#${name}`)),
      ...CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1.flatMap(({ file, mutations }) =>
        mutations.map((name) => `${file}#${name}`)),
      ...CONTINUITY_LOCK_ONLY_INVENTORY_V1.flatMap((entry) =>
        ('transactions' in entry ? entry.transactions : []).map((name) => `${entry.file}#${name}`)),
      ...CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1.flatMap(({ file, mutations }) =>
        mutations.map((name) => `${file}#${name}`)),
      ...CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1.flatMap(({ file, mutations }) =>
        mutations.map((name) => `${file}#${name}`)),
      ...CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1.map(({ file, helper }) => `${file}#${helper}`),
      'lib/shop-os/continuity/mutation-foundation/revisions.ts#finalizeMutationRevisionsV1',
    ]
    const registeredFiles = new Set(roots.map((rootId) => rootId.split('#')[0]))
    const unknownInRegisteredFiles = programGraph.mutations().filter((site) =>
      site.operation === 'unknown-sql' && registeredFiles.has(site.file))
    expect(unknownInRegisteredFiles, 'dynamic SQL in a registered writer must be classified or refused')
      .toEqual([])

    for (const site of programGraph.mutations().filter(({ operation }) => operation !== 'unknown-sql')) {
      const owners = roots.filter((rootId) =>
        rootId === site.owner || programGraph.transitiveCallees(rootId).includes(site.owner))
      expect(owners.length, `${site.file}:${site.position} ${site.operation}:${site.table}`).toBeGreaterThan(0)
    }
  })

  it('keeps every named top-level writer exported from its registered file', async () => {
    const families = [
      ...CONTINUITY_WRITER_INVENTORY_V1.map((entry) => ({ file: entry.file, names: entry.mutations })),
      ...CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1.map((entry) => ({ file: entry.file, names: entry.mutations })),
      ...CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1.map((entry) => ({ file: entry.file, names: entry.mutations })),
    ]
    for (const family of families) {
      const exports = exportedFunctionNames(await source(family.file))
      for (const name of family.names) expect(exports, `${family.file}#${name}`).toContain(name)
    }
  })

  it('requires each named winning writer to reach the coordinator and finalizer transitively', async () => {
    const coordinator = 'lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#runBoundedShopOsMutationV1'
    const revisionFinalizer = 'lib/shop-os/continuity/mutation-foundation/revisions.ts#finalizeMutationRevisionsV1'
    const creationFinalizer = 'lib/tickets.ts#finalizeResolvedTicketCreationInTransactionV1'
    for (const family of CONTINUITY_WRITER_INVENTORY_V1) {
      for (const mutation of family.mutations) {
        const rootId = `${family.file}#${mutation}`
        const closure = programGraph.transitiveCallees(rootId)
        expect(closure, `${rootId} bounded coordinator`).toContain(coordinator)
        expect(
          closure.includes(revisionFinalizer) || closure.includes(creationFinalizer),
          `${rootId} revision finalizer`,
        ).toBe(true)
      }
    }

    for (const family of CONTINUITY_LOCK_ONLY_INVENTORY_V1) {
      const transactions = 'transactions' in family ? family.transactions : []
      for (const transaction of transactions) {
        const rootId = `${family.file}#${transaction}`
        const closure = programGraph.transitiveCallees(rootId)
        expect(closure, `${rootId} bounded coordinator`).toContain(coordinator)
        if (rootId === 'lib/sessions.ts#replayCompletedTechQuickSessionForUser') {
          expect(await source('lib/sessions.ts')).toMatch(
            /replayCompletedTechQuickSessionForUser[\s\S]*?runTechQuickMutation\(db, actor, owned\.value, false\)/,
          )
          continue
        }
        expect(closure, `${rootId} is lock-only`).not.toContain(revisionFinalizer)
        expect(closure, `${rootId} is lock-only`).not.toContain(creationFinalizer)
      }
    }
  })

  it('keeps ticket creation and intake identity behind the registered opaque bridges', async () => {
    const [ticketsSource, identitySource, counterSource, quickSource] = await Promise.all([
      source('lib/tickets.ts'),
      source('lib/intake/ticket-identity.ts'),
      source('lib/intake/counter-ticket.ts'),
      source('lib/intake/quick-ticket.ts'),
    ])
    expect(ticketsSource.match(/\.insert\(tickets\)/g)).toHaveLength(1)
    expect(ticketsSource.match(/\.insert\(ticketJobs\)/g)).toHaveLength(2)
    expect(ticketsSource).toContain('reserveJobSequencesForInsertionV1')
    expect(ticketsSource).toContain('finalizeResolvedTicketCreationInTransactionV1')
    expect(ticketsSource).toContain('state.createdRows,')
    expect(identitySource).toContain('MaterializedTicketIntakeIdentityV1')
    expect(identitySource).not.toContain('lockMutationScopeV1')
    expect(identitySource).not.toContain('finalizeMutationRevisionsV1')
    for (const adapter of [counterSource, quickSource]) {
      expect(adapter).toContain('materializeTicketIntakeIdentityInLockedScopeV1')
      expect(adapter).not.toContain('upsertCustomer')
      expect(adapter).not.toContain('upsertVehicle')
    }
    expect(counterSource).toContain("mode: 'intake_insert'")
    expect(quickSource).toContain("mode: 'quick_insert'")

    const reservation = 'lib/shop-os/continuity/mutation-foundation/revisions.ts#reserveJobSequencesForInsertionV1'
    for (const rootId of [
      'lib/tickets.ts#addTicketJob',
      'lib/shop-os/canned-jobs.ts#applyCannedJobToTicket',
      'lib/shop-os/simple-work.ts#createWorkEscalation',
    ]) expect(programGraph.transitiveCallees(rootId), `${rootId} sequence reservation`).toContain(reservation)

    const quickClosure = programGraph.transitiveCallees('lib/intake/quick-ticket.ts#createQuickTicket')
    for (const bridge of [
      'lib/shop-os/continuity/mutation-foundation/ticket-origin.server.ts#createQuickTicketOriginV1',
      'lib/intake/ticket-identity.ts#preflightTicketIntakeIdentityV1',
      'lib/intake/ticket-identity.ts#materializeTicketIntakeIdentityInLockedScopeV1',
      'lib/shop-os/canned-jobs.ts#preflightStrictCannedJobV1',
      'lib/shop-os/canned-jobs.ts#resolveStrictCannedJobInLockedScopeV1',
      'lib/tickets.ts#finalizeResolvedTicketCreationInTransactionV1',
    ]) expect(quickClosure, `Quick bridge ${bridge}`).toContain(bridge)
  })

  it('guards capability, receipt, keyring, and ticket-origin private seams by exact source ownership', async () => {
    const foundationFiles = await applicationSources('lib/shop-os/continuity/mutation-foundation')
    const foundation = await Promise.all(foundationFiles.map(async (file) => ({ file, text: await source(file) })))
    const envReaders = foundation.filter(({ text }) => text.includes('process.env')).map(({ file }) => file)
    expect(envReaders).toEqual(['lib/shop-os/continuity/mutation-foundation/keyring.server.ts'])
    for (const file of ['keyring.ts', 'keyring.server.ts']) {
      expect(await source(`lib/shop-os/continuity/mutation-foundation/${file}`)).toMatch(/^import 'server-only'/)
    }
    const barrel = await source('lib/shop-os/continuity/mutation-foundation/index.ts')
    expect(barrel).not.toMatch(/from ['"]\.\/keyring(?:\.server)?['"]/)
    expect(barrel).not.toMatch(/from ['"]\.\/ticket-origin\.server['"]/)
    expect(barrel).not.toMatch(/createMutationAttemptCapabilityV1|bindLockedMutationScopeToAttemptV1|insertMutationReceiptPrimitiveV1/)
    expect(barrel).not.toContain('FinalizedTicketCreationV1')

    const privateSeams = [
      'lib/shop-os/continuity/mutation-foundation/attempt-capability.ts#createMutationAttemptCapabilityV1',
      'lib/shop-os/continuity/mutation-foundation/attempt-capability.ts#bindLockedMutationScopeToAttemptV1',
      'lib/shop-os/continuity/mutation-foundation/receipts.ts#peekMutationReceiptV1',
      'lib/shop-os/continuity/mutation-foundation/receipts.ts#insertMutationReceiptPrimitiveV1',
    ]
    for (const seam of privateSeams) {
      expect(programGraph.exportersOf(seam), `${seam} exporter`).toEqual([seam.split('#')[0]])
    }
    const capabilityCallers = programGraph.directCallers(privateSeams[0]!)
    expect(capabilityCallers).toHaveLength(2)
    expect(capabilityCallers.every((caller) =>
      caller.startsWith('lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#'))).toBe(true)
    expect(programGraph.directCallers(privateSeams[1]!)).toEqual([
      'lib/shop-os/continuity/mutation-foundation/lock-order.ts#lockMutationScopeV1',
    ])
    expect(programGraph.directCallers(privateSeams[2]!)).toEqual([
      'lib/shop-os/continuity/mutation-foundation/lock-order.ts#lockMutationScopeV1',
    ])
    expect(programGraph.directCallers(privateSeams[3]!)).toEqual([
      'lib/tickets.ts#insertResolvedTicketCreationReceiptInTransactionV1',
    ])
  })

  it('enforces exact nested-helper callers through aliases and local wrappers', () => {
    for (const entry of CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1) {
      const helperId = `${entry.file}#${entry.helper}`
      for (const allowed of entry.allowedCallers) {
        expect(programGraph.transitiveCallees(allowed), `${allowed} reaches ${helperId}`).toContain(helperId)
      }
      for (const directCaller of programGraph.directCallers(helperId)) {
        const registeredOwner = entry.allowedCallers.some((allowed) =>
          allowed === directCaller || programGraph.transitiveCallees(allowed).includes(directCaller))
        expect(registeredOwner, `${helperId} unregistered caller ${directCaller}`).toBe(true)
      }
    }
  })

  it('keeps curator session-only mutations behind the shared transaction shape', () => {
    const curator = CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1[2]
    const shared = 'lib/curator/deferred-actions.ts#mutateDeferredSession'
    for (const mutation of curator.mutations) {
      const rootId = `${curator.file}#${mutation}`
      const closure = programGraph.transitiveCallees(rootId)
      expect(closure, `${rootId} shared curator transaction`).toContain(shared)
      const reachableMutations = programGraph.mutations().filter((site) =>
        site.owner === rootId || closure.includes(site.owner))
      expect([...new Set(reachableMutations.map(({ table }) => table))]).toEqual(['sessions'])
    }
  })
})

describe('ShopOS gated writer entrance inventory', () => {
  it('matches every registered diagnostics library writer to its complete semantic app caller set', () => {
    const expected = new Map<string, string[]>([
      ['lib/sessions.ts#createSessionForUser', ['app/api/sessions/route.ts#POST']],
      ['lib/sessions.ts#closeSessionForUser', ['app/api/sessions/[id]/close/route.ts#POST']],
      ['lib/sessions.ts#replayCompletedTechQuickSessionForUser', ['app/api/sessions/route.ts#POST']],
      ['lib/sessions.ts#submitRepairObservationForUser', ['app/api/sessions/[id]/repair-observation/route.ts#POST']],
      ['lib/diagnostics/adaptive/state.ts#updateAdaptiveModeForUser', ['app/api/sessions/[id]/adaptive/mode/route.ts#POST']],
      ['lib/intake/session.ts#createSessionFromIntake', ['app/api/intake/submit/route.ts#POST']],
      ['lib/sessions.ts#advanceSession', ['app/api/sessions/[id]/advance/route.ts#POST', 'app/api/sessions/[id]/advance/stream/route.ts#POST']],
      ['lib/sessions.ts#captureArtifact', []],
      ['lib/sessions.ts#recordAmbientConditions', ['app/api/sessions/[id]/ambient/route.ts#POST']],
      ['lib/sessions.ts#releaseGateForUser', ['app/api/sessions/[id]/release-gate/route.ts#POST']],
      ['lib/sessions.ts#declineOrDeferSessionForUser', ['app/api/sessions/[id]/decline-or-defer/route.ts#POST']],
      ['lib/sessions.ts#abandonSessionForUser', ['app/api/sessions/[id]/abandon/route.ts#POST']],
      ['lib/sessions.ts#lockDiagnosisForUser', ['app/api/sessions/[id]/lock-diagnosis/route.ts#POST']],
      ['lib/sessions.ts#lockDiagnosisFromWizard', ['app/api/sessions/[id]/lock-in-diagnosis/route.ts#POST']],
      ['lib/retrieval/wire-into-tree.ts#buildUpdateTreeWithRetrieval', ['app/api/sessions/[id]/advance/route.ts#POST', 'app/api/sessions/[id]/advance/stream/route.ts#POST', 'app/api/sessions/[id]/ambient/route.ts#POST']],
    ])
    for (const [writerId, callers] of expected) {
      const actual = programGraph.transitiveCallers(writerId)
        .filter((caller) => caller.startsWith('app/') && caller.endsWith('#POST'))
      expect(actual, writerId).toEqual([...callers].sort())
    }
  })

  it('keeps every diagnostics entrypoint in the actual route gate and calls entitlement before its writer', async () => {
    const authSource = await source('lib/auth-access.ts')
    expect(authSource).toContain("'/api/sessions'")
    expect(authSource).not.toContain('DIAGNOSTICS_ENABLED = true')
    const entrances: Array<{ routeId: string; writerId: string }> = []
    for (const family of CONTINUITY_WRITER_INVENTORY_V1) {
      if (!('allowedEntrypointsByMutation' in family)) continue
      for (const [mutation, routes] of Object.entries(family.allowedEntrypointsByMutation)) {
        routes.forEach((routeId) => entrances.push({ routeId, writerId: `${family.file}#${mutation}` }))
      }
    }
    for (const family of CONTINUITY_LOCK_ONLY_INVENTORY_V1) {
      if ('allowedEntrypointsByTransaction' in family) {
        for (const [transaction, routes] of Object.entries(family.allowedEntrypointsByTransaction)) {
          routes.forEach((routeId) => entrances.push({ routeId, writerId: `${family.file}#${transaction}` }))
        }
      }
      if ('allowedEntrypoints' in family) family.allowedEntrypoints.forEach((routeId) =>
        entrances.push({ routeId, writerId: `${family.file}#${family.transactions[0]}` }))
    }
    const dormant = CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1[0]
    dormant.allowedEntrypoints.forEach((routeId) =>
      entrances.push({ routeId, writerId: `${dormant.file}#${dormant.mutations[0]}` }))
    const gatedSessions = CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1[0]
    if ('allowedEntrypointsByMutation' in gatedSessions) {
      for (const [mutation, routes] of Object.entries(gatedSessions.allowedEntrypointsByMutation)) {
        routes.forEach((routeId) => entrances.push({ routeId, writerId: `${gatedSessions.file}#${mutation}` }))
      }
    }
    const retrieval = CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1[1]
    if ('allowedCallers' in retrieval) retrieval.allowedCallers.forEach((routeId) =>
      entrances.push({ routeId, writerId: `${retrieval.file}#${retrieval.mutations[0]}` }))

    const gateId = 'lib/auth-access.ts#entitlementReject'
    for (const { routeId, writerId } of entrances) {
      const routeFile = routeId.split('#')[0]!
      const pathname = `/${routeFile.replace(/^app\//, '').replace(/\/route\.ts$/, '')}`
        .replace(/\[[^/]+\]/g, 'test')
      expect(isDiagnosticsGatedRoute(pathname), `${routeId} actual diagnostics gate`).toBe(true)
      expect(programGraph.callOrder(routeId, [gateId, writerId]), `${routeId} gate order`).toEqual([0, 1])
    }
    const wizardRoute = 'app/api/sessions/[id]/wizard-state/route.ts#POST'
    expect(isDiagnosticsGatedRoute('/api/sessions/test/wizard-state')).toBe(true)
    expect(programGraph.callOrder(wizardRoute, [gateId])).toEqual([0])
  })
})
