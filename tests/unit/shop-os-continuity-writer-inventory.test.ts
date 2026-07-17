import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1,
  CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1,
  CONTINUITY_LOCK_ONLY_INVENTORY_V1,
  CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1,
  CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1,
  CONTINUITY_WRITER_INVENTORY_V1,
} from '@/lib/shop-os/continuity/mutation-foundation/writer-inventory'

const root = process.cwd()
const trackedTables = new Set([
  'customers',
  'vehicles',
  'sessions',
  'sessionEvents',
  'tickets',
  'ticketJobs',
  'jobLines',
  'quoteVersions',
  'quoteEvents',
])
const trackedSqlTables = new Map([
  ['customers', 'customers'],
  ['vehicles', 'vehicles'],
  ['sessions', 'sessions'],
  ['session_events', 'sessionEvents'],
  ['tickets', 'tickets'],
  ['ticket_jobs', 'ticketJobs'],
  ['job_lines', 'jobLines'],
  ['quote_versions', 'quoteVersions'],
  ['quote_events', 'quoteEvents'],
])

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

function topLevelFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node
  while (current && !ts.isSourceFile(current.parent)) current = current.parent
  if (!current) return '<module>'
  if (ts.isFunctionDeclaration(current)) return current.name?.text ?? '<anonymous>'
  if (ts.isVariableStatement(current)) {
    const declaration = current.declarationList.declarations.find(
      (candidate) => candidate.initializer && node.pos >= candidate.pos && node.end <= candidate.end,
    )
    if (declaration && ts.isIdentifier(declaration.name)) return declaration.name.text
  }
  return '<module>'
}

type MutationSite = Readonly<{
  file: string
  functionName: string
  operation: string
  table: string
}>

function collectMutationSites(file: string, text: string): MutationSite[] {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const schemaAliases = new Map<string, string>()
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const modulePath = statement.moduleSpecifier.text
    if (!(modulePath.endsWith('/db/schema') || (file === 'lib/db/queries.ts' && modulePath === './schema'))) continue
    for (const specifier of statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements
      : []) {
      const imported = specifier.propertyName?.text ?? specifier.name.text
      if (trackedTables.has(imported)) schemaAliases.set(specifier.name.text, imported)
    }
  }

  const sites: MutationSite[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operation = node.expression.name.text
      if (['insert', 'update', 'delete'].includes(operation)) {
        const target = node.arguments[0]
        const table = target && ts.isIdentifier(target)
          ? schemaAliases.get(target.text)
          : undefined
        if (table) {
          sites.push({ file, functionName: topLevelFunctionName(node), operation, table })
        }
      }
      if (operation === 'execute') {
        const argument = node.arguments[0]
        const raw = argument?.getText(parsed) ?? ''
        for (const [sqlName, table] of trackedSqlTables) {
          const mutation = new RegExp(
            `\\b(insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?"?${sqlName}"?\\b`,
            'i',
          ).exec(raw)
          if (mutation) {
            sites.push({
              file,
              functionName: topLevelFunctionName(node),
              operation: mutation[1]!.toLowerCase().replace(/\s+/g, '-'),
              table,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return sites
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

function topLevelFunctionSource(text: string, name: string): string {
  const parsed = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true)
  for (const statement of parsed.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(parsed)
    }
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    )
    if (declaration) return declaration.getText(parsed)
  }
  return ''
}

const expectedMutationSites = [
  'app/api/sessions/[id]/wizard-state/route.ts#POST:update:sessions',
  'lib/curator/deferred-actions.ts#mutateDeferredSession:update:sessions',
  'lib/db/queries.ts#appendSessionEvent:insert:sessionEvents',
  'lib/db/queries.ts#closeSession:update:sessions',
  'lib/db/queries.ts#createSession:insert:sessions',
  'lib/db/queries.ts#setSessionTerminalStatus:update:sessions',
  'lib/db/queries.ts#updateSessionIntake:update:sessions',
  'lib/db/queries.ts#updateSessionMaxCorpusSimilarity:update:sessions',
  'lib/db/queries.ts#updateSessionTreeState:update:sessions',
  'lib/diagnostics/adaptive/state.ts#updateAdaptiveModeForUser:insert:sessionEvents',
  'lib/diagnostics/adaptive/state.ts#updateAdaptiveModeForUser:update:sessions',
  'lib/intake/customers.ts#upsertCustomer:insert:customers',
  'lib/intake/session.ts#createSessionFromIntake:insert:sessions',
  'lib/intake/session.ts#createSessionFromIntake:update:vehicles',
  'lib/intake/ticket-identity.ts#materializeTicketIntakeIdentityInLockedScopeV1:insert:customers',
  'lib/intake/ticket-identity.ts#materializeTicketIntakeIdentityInLockedScopeV1:insert:vehicles',
  'lib/intake/ticket-identity.ts#materializeTicketIntakeIdentityInLockedScopeV1:update:vehicles',
  'lib/intake/vehicles.ts#upsertVehicle:insert:vehicles',
  'lib/sessions.ts#closeSessionForUser:update:ticketJobs',
  'lib/sessions.ts#lockDiagnosisFromWizard:update:sessions',
  'lib/sessions.ts#runTechQuickMutation:insert:sessions',
  'lib/sessions.ts#closeSessionForUser:update:ticketJobs',
  'lib/shop-os/canned-jobs.ts#applyCannedJobToTicket:insert:jobLines',
  'lib/shop-os/canned-jobs.ts#applyCannedJobToTicket:insert:ticketJobs',
  'lib/shop-os/continuity/mutation-foundation/revisions.ts#finalizeMutationRevisionsV1:update:ticketJobs',
  'lib/shop-os/continuity/mutation-foundation/revisions.ts#finalizeMutationRevisionsV1:update:tickets',
  'lib/shop-os/customer-stories.ts#generateAndSaveCustomerStory:update:ticketJobs',
  'lib/shop-os/customer-stories.ts#saveReviewedCustomerStory:update:ticketJobs',
  'lib/shop-os/diagnostic-start.ts#acquireDiagnosticStart:update:ticketJobs',
  'lib/shop-os/diagnostic-start.ts#finalizeDiagnosticStart:insert:sessions',
  'lib/shop-os/diagnostic-start.ts#finalizeDiagnosticStart:update:ticketJobs',
  'lib/shop-os/diagnostic-start.ts#settleDiagnosticStart:update:ticketJobs',
  'lib/shop-os/diagnostic-start.ts#updateExpiredLease:update:ticketJobs',
  'lib/shop-os/parts-offers.ts#captureManualOffer:insert:jobLines',
  'lib/shop-os/parts-offers.ts#removeManualOffer:delete:jobLines',
  'lib/shop-os/quotes.ts#createDraftLine:insert:jobLines',
  'lib/shop-os/quotes.ts#createQuoteVersion:insert:quoteVersions',
  'lib/shop-os/quotes.ts#createQuoteVersion:update:quoteVersions',
  'lib/shop-os/quotes.ts#createQuoteVersion:update:ticketJobs',
  'lib/shop-os/quotes.ts#createQuoteVersion:update:ticketJobs',
  'lib/shop-os/quotes.ts#deleteDraftLine:delete:jobLines',
  'lib/shop-os/quotes.ts#invalidateActiveQuoteVersionDeltaV1:update:quoteVersions',
  'lib/shop-os/quotes.ts#invalidateActiveQuoteVersionDeltaV1:update:ticketJobs',
  'lib/shop-os/quotes.ts#recordQuoteDecision:insert:quoteEvents',
  'lib/shop-os/quotes.ts#recordQuoteDecision:update:ticketJobs',
  'lib/shop-os/quotes.ts#replaceDraftLine:update:jobLines',
  'lib/shop-os/simple-work.ts#createWorkEscalation:insert:ticketJobs',
  'lib/shop-os/simple-work.ts#mutateSimpleWork:update:ticketJobs',
  'lib/shop-os/simple-work.ts#mutateSimpleWork:update:ticketJobs',
  'lib/shop-os/simple-work.ts#mutateSimpleWork:update:ticketJobs',
  'lib/tickets.ts#addTicketJob:insert:ticketJobs',
  'lib/tickets.ts#insertResolvedTicketBatchInTransactionV1:insert:jobLines',
  'lib/tickets.ts#insertResolvedTicketBatchInTransactionV1:insert:ticketJobs',
  'lib/tickets.ts#insertResolvedTicketBatchInTransactionV1:insert:tickets',
  'lib/tickets.ts#mutateTicketJobAssignment:update:ticketJobs',
] as const

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
  it('classifies every tracked Drizzle or raw-SQL application mutation by exact file and function', async () => {
    const files = [
      ...(await applicationSources('lib')),
      ...(await applicationSources('app/api')),
    ]
    const sites = (await Promise.all(files.map(async (file) =>
      collectMutationSites(file, await source(file)),
    ))).flat()
    const keys = sites.map((site) =>
      `${site.file}#${site.functionName}:${site.operation}:${site.table}`,
    ).sort()

    expect(keys).toEqual([...expectedMutationSites].sort())
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

  it('requires winning files to own one bounded scope and the correct finalization contract', async () => {
    const runnerSource = await source(
      'lib/shop-os/continuity/mutation-foundation/transaction-runner.ts',
    )
    expect(runnerSource).toContain('lockMutationScopeV1')
    for (const family of CONTINUITY_WRITER_INVENTORY_V1) {
      const text = await source(family.file)
      expect(text, `${family.file} bounded coordinator`).toContain('runBoundedShopOsMutationV1')
      expect(
        text.includes('finalizeMutationRevisionsV1') ||
          text.includes('finalizeResolvedTicketCreationInTransactionV1'),
        `${family.file} sole revision finalizer`,
      ).toBe(true)
    }

    for (const family of CONTINUITY_LOCK_ONLY_INVENTORY_V1) {
      const text = await source(family.file)
      expect(text, `${family.file} bounded coordinator`).toContain('runBoundedShopOsMutationV1')
      const transactions = 'transactions' in family ? family.transactions : []
      for (const transaction of transactions) {
        const body = topLevelFunctionSource(text, transaction)
        expect(body, `${family.file}#${transaction} exists`).not.toBe('')
        expect(body, `${family.file}#${transaction} is lock-only`).not.toContain('finalizeMutationRevisionsV1')
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

    const allFiles = [...(await applicationSources('lib')), ...(await applicationSources('app'))]
    const all = await Promise.all(allFiles.map(async (file) => ({ file, text: await source(file) })))
    const importers = (name: string) => all
      .filter(({ text }) => new RegExp(`\\b${name}\\b`).test(text))
      .map(({ file }) => file)
      .sort()
    expect(importers('createMutationAttemptCapabilityV1')).toEqual([
      'lib/shop-os/continuity/mutation-foundation/attempt-capability.ts',
      'lib/shop-os/continuity/mutation-foundation/transaction-runner.ts',
    ])
    expect(importers('bindLockedMutationScopeToAttemptV1')).toEqual([
      'lib/shop-os/continuity/mutation-foundation/attempt-capability.ts',
      'lib/shop-os/continuity/mutation-foundation/lock-order.ts',
    ])
    expect(importers('peekMutationReceiptV1')).toEqual([
      'lib/shop-os/continuity/mutation-foundation/lock-order.ts',
      'lib/shop-os/continuity/mutation-foundation/receipts.ts',
    ])
  })
})

describe('ShopOS gated writer entrance inventory', () => {
  it('matches every registered diagnostics library writer to its complete app caller set', async () => {
    const expected = new Map<string, string[]>([
      ['createSessionForUser', ['app/api/sessions/route.ts#POST']],
      ['closeSessionForUser', ['app/api/sessions/[id]/close/route.ts#POST']],
      ['replayCompletedTechQuickSessionForUser', ['app/api/sessions/route.ts#POST']],
      ['submitRepairObservationForUser', ['app/api/sessions/[id]/repair-observation/route.ts#POST']],
      ['updateAdaptiveModeForUser', ['app/api/sessions/[id]/adaptive/mode/route.ts#POST']],
      ['createSessionFromIntake', ['app/api/intake/submit/route.ts#POST']],
      ['advanceSession', ['app/api/sessions/[id]/advance/route.ts#POST', 'app/api/sessions/[id]/advance/stream/route.ts#POST']],
      ['captureArtifact', []],
      ['recordAmbientConditions', ['app/api/sessions/[id]/ambient/route.ts#POST']],
      ['releaseGateForUser', ['app/api/sessions/[id]/release-gate/route.ts#POST']],
      ['declineOrDeferSessionForUser', ['app/api/sessions/[id]/decline-or-defer/route.ts#POST']],
      ['abandonSessionForUser', ['app/api/sessions/[id]/abandon/route.ts#POST']],
      ['lockDiagnosisForUser', ['app/api/sessions/[id]/lock-diagnosis/route.ts#POST']],
      ['lockDiagnosisFromWizard', ['app/api/sessions/[id]/lock-in-diagnosis/route.ts#POST']],
      ['buildUpdateTreeWithRetrieval', ['app/api/sessions/[id]/advance/route.ts#POST', 'app/api/sessions/[id]/advance/stream/route.ts#POST', 'app/api/sessions/[id]/ambient/route.ts#POST']],
    ])
    const appFiles = await applicationSources('app')
    for (const [writer, callers] of expected) {
      const actual: string[] = []
      for (const file of appFiles) {
        const text = await source(file)
        if (!new RegExp(`\\b${writer}\\b`).test(text)) continue
        if (!new RegExp(`\\b${writer}\\s*\\(`).test(text)) continue
        actual.push(`${file}#POST`)
      }
      expect(actual.sort(), writer).toEqual([...callers].sort())
    }
  })

  it('keeps every diagnostics entrypoint release-gated and entitlement-refused before its writer call', async () => {
    const authSource = await source('lib/auth-access.ts')
    expect(authSource).toContain("'/api/sessions'")
    expect(authSource).not.toContain('DIAGNOSTICS_ENABLED = true')
    const registeredRoutes = new Set<string>()
    for (const family of CONTINUITY_WRITER_INVENTORY_V1) {
      if (!('allowedEntrypointsByMutation' in family)) continue
      for (const routes of Object.values(family.allowedEntrypointsByMutation)) routes.forEach((route) => registeredRoutes.add(route.split('#')[0]!))
    }
    for (const family of CONTINUITY_LOCK_ONLY_INVENTORY_V1) {
      if ('allowedEntrypointsByTransaction' in family) for (const routes of Object.values(family.allowedEntrypointsByTransaction)) routes.forEach((route) => registeredRoutes.add(route.split('#')[0]!))
      if ('allowedEntrypoints' in family) family.allowedEntrypoints.forEach((route) => registeredRoutes.add(route.split('#')[0]!))
    }
    CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1[0].allowedEntrypoints.forEach((route) => registeredRoutes.add(route.split('#')[0]!))
    const gatedSessions = CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1[0]
    if ('allowedEntrypointsByMutation' in gatedSessions) for (const routes of Object.values(gatedSessions.allowedEntrypointsByMutation)) routes.forEach((route) => registeredRoutes.add(route.split('#')[0]!))
    const retrieval = CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1[1]
    if ('allowedCallers' in retrieval) retrieval.allowedCallers.forEach((route) => registeredRoutes.add(route.split('#')[0]!))
    registeredRoutes.add('app/api/sessions/[id]/wizard-state/route.ts')

    for (const route of registeredRoutes) {
      const text = await source(route)
      const gate = text.indexOf('entitlementReject(')
      expect(gate, `${route} entitlement gate`).toBeGreaterThan(-1)
      const registeredWriters = [...new Set([...CONTINUITY_WRITER_INVENTORY_V1.flatMap((entry) => [...entry.mutations]), ...CONTINUITY_LOCK_ONLY_INVENTORY_V1.flatMap((entry) => 'transactions' in entry ? [...entry.transactions] : []), ...CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1.flatMap((entry) => [...entry.mutations]), ...CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1.flatMap((entry) => 'mutations' in entry ? [...entry.mutations].filter((mutation) => mutation !== 'POST') : [])])]
      const firstWriter = registeredWriters
        .map((writer) => text.indexOf(`${writer}(`))
        .filter((position) => position > -1)
        .sort((left, right) => left - right)[0]
      if (firstWriter !== undefined) expect(gate, `${route} gate order`).toBeLessThan(firstWriter)
    }
  })
})
