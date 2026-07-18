import { describe, expect, it } from 'vitest'
import { createVirtualTypeScriptProgramGraphV1 } from '@/tests/helpers/typescript-program-graph'

const files = {
  '/virtual/drizzle-orm/pg-core/db.ts': `
    export interface PgDatabase {
      insert(table: unknown): void
      update(table: unknown): void
      delete(table: unknown): void
      execute(statement: unknown): void
    }
  `,
  '/virtual/schema.ts': `
    export const tickets = { name: 'tickets' }
    export const ticketJobs = { name: 'ticket_jobs' }
  `,
  '/virtual/db.ts': `
    import type { PgDatabase } from './drizzle-orm/pg-core/db'
    export declare const db: PgDatabase
    export const sql: any = (parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })
  `,
  '/virtual/foundation.ts': `
    export function finalizeMutationRevisionsV1() {}
    export function insertMutationReceiptPrimitiveV1() {}
  `,
  '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts': `
    export function runBoundedShopOsMutationV1(
      callback: () => void,
      config: { discover(): unknown; executeLocked(): unknown },
    ) { callback(); config.discover(); config.executeLocked() }
  `,
  '/virtual/foundation-barrel.ts': `
    export { insertMutationReceiptPrimitiveV1 as leakedReceipt } from './foundation'
  `,
  '/virtual/writer.ts': `
    import * as schema from './schema'
    import { db, sql } from './db'
    import {
      finalizeMutationRevisionsV1 as finalize,
    } from './foundation'
    import { runBoundedShopOsMutationV1 as coordinate } from './lib/shop-os/continuity/mutation-foundation/transaction-runner'

    const ticketTable = schema.tickets
    const rawUpdate = sql\`update public.tickets set concern = 'safe'\`
    function leafWriter() {
      db.update(ticketTable)
      db.execute(rawUpdate)
    }
    export function winningWriter() {
      coordinate(() => undefined, { discover: () => undefined, executeLocked: () => leafWriter() })
      finalize()
    }
    export function bypassSibling() {
      db['insert'](schema.ticketJobs)
    }
    export function unknownSql(statement: unknown) {
      db.execute(statement)
    }
  `,
  '/virtual/writer-barrel.ts': `
    export { winningWriter as routedWriter } from './writer'
  `,
  '/virtual/gate.ts': `export function entitlementReject(): { denied: true } | null { return null }`,
  '/virtual/route.ts': `
    import { routedWriter as writer } from './writer-barrel'
    import { entitlementReject as gate } from './gate'
    export async function POST() {
      const denied = await gate()
      if (denied) return denied
      await writer()
    }
  `,
  '/virtual/nested-route.ts': `
    import { routedWriter as writer } from './writer-barrel'
    import { entitlementReject as gate } from './gate'
    export async function POST() {
      function neverCalled() { gate() }
      await writer()
    }
  `,
  '/virtual/reachable-route.ts': `
    import { routedWriter as writer } from './writer-barrel'
    import { entitlementReject as gate } from './gate'
    export async function POST() {
      function check() { gate() }
      check()
      await writer()
    }
  `,
}

describe('ShopOS continuity TypeScript Program graph', () => {
  it('resolves namespace tables, local aliases, computed calls, wrappers, and raw SQL variables', () => {
    const graph = createVirtualTypeScriptProgramGraphV1(files)

    expect(graph.mutations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: '/virtual/writer.ts#leafWriter', operation: 'update', table: 'tickets' }),
      expect.objectContaining({ owner: '/virtual/writer.ts#leafWriter', operation: 'raw-update', table: 'tickets' }),
      expect.objectContaining({ owner: '/virtual/writer.ts#bypassSibling', operation: 'insert', table: 'ticketJobs' }),
      expect.objectContaining({ owner: '/virtual/writer.ts#unknownSql', operation: 'unknown-sql', table: '<unknown>' }),
    ]))
  })

  it('follows direct nested calls and re-exports transitively without blessing a sibling', () => {
    const graph = createVirtualTypeScriptProgramGraphV1(files)
    const winning = '/virtual/writer.ts#winningWriter'

    expect(graph.transitiveCallees(winning)).toEqual(expect.arrayContaining([
      '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#runBoundedShopOsMutationV1',
      '/virtual/foundation.ts#finalizeMutationRevisionsV1',
      '/virtual/writer.ts#leafWriter',
    ]))
    expect(graph.transitiveCallees('/virtual/writer.ts#bypassSibling'))
      .not.toContain('/virtual/foundation.ts#finalizeMutationRevisionsV1')
    expect(graph.directCallers('/virtual/writer.ts#winningWriter'))
      .toContain('/virtual/route.ts#POST')
  })

  it('finds private-seam re-exports and proves the real gate call precedes the routed writer alias', () => {
    const graph = createVirtualTypeScriptProgramGraphV1(files)

    expect(graph.exportersOf('/virtual/foundation.ts#insertMutationReceiptPrimitiveV1'))
      .toContain('/virtual/foundation-barrel.ts')
    expect(graph.callOrder('/virtual/route.ts#POST', [
      '/virtual/gate.ts#entitlementReject',
      '/virtual/writer.ts#winningWriter',
    ])).toEqual([0, 1])
  })

  it('does not treat an uncalled nested function as a reachable gate', () => {
    const graph = createVirtualTypeScriptProgramGraphV1(files)

    expect(graph.transitiveCallees('/virtual/nested-route.ts#POST'))
      .not.toContain('/virtual/gate.ts#entitlementReject')
    expect(graph.callOrder('/virtual/nested-route.ts#POST', [
      '/virtual/gate.ts#entitlementReject',
      '/virtual/writer.ts#winningWriter',
    ])).toEqual([-1, 0])
  })

  it('keeps a called nested gate reachable in the direct graph', () => {
    const graph = createVirtualTypeScriptProgramGraphV1(files)

    expect(graph.callOrder('/virtual/reachable-route.ts#POST', [
      '/virtual/gate.ts#entitlementReject',
      '/virtual/writer.ts#winningWriter',
    ])).toEqual([0, 1])
  })

  it('keeps an exported POST distinct from a nested guarded POST with the same name', () => {
    const writer = '/virtual/writer.ts#writer'
    const gate = '/virtual/gate.ts#gate'
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/writer.ts': `export function writer() {}`,
      '/virtual/gate.ts': `export function gate(): { denied: true } | null { return null }`,
      '/virtual/route.ts': `
        import { writer } from './writer'
        import { gate } from './gate'
        export async function POST() { writer() }
        export async function wrapper() {
          async function POST() {
            const denied = await gate()
            if (denied) return denied
            writer()
          }
          return POST()
        }
      `,
    })

    const callers = graph.directCallers(writer)
    const nested = callers.find((owner) => owner !== '/virtual/route.ts#POST')
    expect(callers).toHaveLength(2)
    expect(nested).toMatch(/^\/virtual\/route\.ts#wrapper\/POST@\d+$/)
    expect(graph.gateDominatesWriter('/virtual/route.ts#POST', gate, writer)).toBe(false)
    expect(graph.symbolReferenceViolations(new Map([
      [writer, new Set([nested!])],
    ])).map(({ owner }) => owner)).toEqual(['/virtual/route.ts#POST'])
  })

  it('fails closed instead of overwriting a duplicate stable top-level identity', () => {
    expect(() => createVirtualTypeScriptProgramGraphV1({
      '/virtual/duplicate.ts': `
        export function POST() { return 1 }
        export function POST() { return 2 }
      `,
    })).toThrow('Duplicate function identity: /virtual/duplicate.ts#POST')
  })

  it('forbids every first-class writer reference and permits only an approved direct lexical call', () => {
    const writer = '/virtual/writer.ts#writer'
    const policy = new Map([[writer, new Set(['/virtual/case.ts#approved'])]])
    const cases = [
      ['identity factory', `function identity<T>(value: T): T { return value }
        export function rejected() { const held = identity(writer); held() }`],
      ['returned writer', `export function rejected() { return writer }`],
      ['assigned alias', `export function rejected() { const held = writer; held() }`],
      ['parenthesized alias', `export function rejected() { const held = (writer); held() }`],
      ['array storage', `export function rejected() { return [writer] }`],
      ['cast alias', `export function rejected() { const held = writer as () => void; held() }`],
      ['returned closure', `export function rejected() { return () => writer() }`],
      ['invoke callback', `declare function invoke(value: () => void): void
        export function rejected() { invoke(writer) }`],
      ['object arrow', `export function rejected() { const held = { run: () => writer() }; held.run() }`],
      ['opaque destructuring', `export function rejected() { const registry = { run: writer }; const { run } = registry; run() }`],
      ['native bind', `export function rejected() { writer.bind(null)() }`],
      ['custom bind', `declare function bind(value: () => void): () => void
        export function rejected() { bind(writer)() }`],
      ['overridden bind', `export function rejected() { const value = { bind: writer }; value.bind() }`],
      ['call', `export function rejected() { writer.call(null) }`],
      ['apply', `export function rejected() { writer.apply(null, []) }`],
      ['dead nested arrow', `export function rejected() { const dead = () => writer(); return dead }`],
      ['React useCallback', `import { useCallback } from 'react'
        export function rejected() { return useCallback(writer, []) }`],
      ['returned invocation', `export function rejected() { writer()() }`],
    ] as const

    for (const [label, body] of cases) {
      const graph = createVirtualTypeScriptProgramGraphV1({
        '/virtual/writer.ts': `export function writer() {}`,
        '/virtual/case.ts': `import { writer } from './writer'
          ${body}
          export function approved() { writer() }`,
      })
      expect(graph.symbolReferenceViolations(policy), label).not.toEqual([])
      expect(graph.symbolReferenceViolations(policy).map(({ owner }) => owner), label)
        .not.toContain('/virtual/case.ts#approved')
    }

    const approved = createVirtualTypeScriptProgramGraphV1({
      '/virtual/writer.ts': `export function writer() {}`,
      '/virtual/case.ts': `import { writer } from './writer'
        export function approved() { writer() }`,
    })
    expect(approved.symbolReferenceViolations(policy)).toEqual([])

    const returnedInvocation = createVirtualTypeScriptProgramGraphV1({
      '/virtual/writer.ts': `export function writer() { return () => undefined }`,
      '/virtual/case.ts': `import { writer } from './writer'
        export function approved() { writer()() }`,
    })
    expect(returnedInvocation.symbolReferenceViolations(policy).map(({ owner }) => owner))
      .toEqual(['/virtual/case.ts#approved'])

    const destructured = createVirtualTypeScriptProgramGraphV1({
      '/virtual/writer.ts': `export function writer() {}`,
      '/virtual/case.ts': `import * as writers from './writer'
        export function rejected() { const { writer: held } = writers; held() }
        export function approved() { writers.writer() }`,
    })
    expect(destructured.symbolReferenceViolations(policy).map(({ owner }) => owner))
      .toEqual(['/virtual/case.ts#rejected'])

    const constructed = createVirtualTypeScriptProgramGraphV1({
      '/virtual/writer.ts': `export class Writer {}`,
      '/virtual/case.ts': `import { Writer } from './writer'
        export function approved() { return new Writer() }`,
    })
    expect(constructed.symbolReferenceViolations(new Map([
      ['/virtual/writer.ts#Writer', new Set(['/virtual/case.ts#approved'])],
    ]))).toEqual([])
  }, 20_000)

  it('forbids first-class tracked mutation methods while preserving direct sink enumeration', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase {
          execute(statement: string): void
          update(table: unknown): void
        }
      `,
      '/virtual/app/sinks.ts': `
        import { tickets } from '../schema'
        import type { PgDatabase } from '../drizzle-orm/pg-core/db'
        declare const db: PgDatabase
        export function direct() {
          db.execute('update tickets set concern = concern')
          db.update(tickets)
        }
        export function stored() { const run = db.execute; return run }
        export function destructured() { const { execute } = db; return execute }
        export function bound() { return db.execute.bind(db) }
        export function returned() { return db.update }
        export function passed() { return [db.execute] }
      `,
    })

    expect(graph.mutations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: '/virtual/app/sinks.ts#direct', operation: 'raw-update', table: 'tickets' }),
      expect.objectContaining({ owner: '/virtual/app/sinks.ts#direct', operation: 'update', table: 'tickets' }),
    ]))
    expect(graph.mutationSinkReferenceViolations().map(({ owner }) => owner))
      .toEqual(expect.arrayContaining([
        '/virtual/app/sinks.ts#stored',
        '/virtual/app/sinks.ts#destructured',
        '/virtual/app/sinks.ts#bound',
        '/virtual/app/sinks.ts#returned',
        '/virtual/app/sinks.ts#passed',
      ]))
  })

  it('forbids alias-only mutation-shaped methods without requiring a seeded direct sink call', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/app/aliases.ts': `
        import { tickets } from '../schema'
        declare const db: {
          execute(statement: string): void
          update(table: unknown): void
        }
        declare const cache: { update(value: unknown): void }
        export function updateAlias() { const update = db.update; update(tickets) }
        export function executeAlias() { const execute = db.execute; execute('update tickets set concern = concern') }
        export function unrelated() { const update = cache.update; return update }
      `,
    })

    expect(graph.mutations()).toEqual([])
    expect(graph.mutationSinkReferenceViolations().map(({ owner }) => owner)).toEqual([
      '/virtual/app/aliases.ts#updateAlias',
      '/virtual/app/aliases.ts#executeAlias',
      '/virtual/app/aliases.ts#unrelated',
    ])
  })

  it('fails closed when a recognized direct mutation receives an unresolved table', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase {
          insert(table: unknown): void
          update(table: unknown): void
          delete(table: unknown): void
        }
      `,
      '/virtual/app/unresolved-table.ts': `
        import type { PgDatabase } from '../drizzle-orm/pg-core/db'
        export function bypass(db: PgDatabase, table: unknown) {
          db.insert(table)
          db.update(table)
          db.delete(table)
        }
      `,
    })

    expect(graph.mutations()).toEqual([
      expect.objectContaining({
        owner: '/virtual/app/unresolved-table.ts#bypass',
        operation: 'unknown-sql',
        table: '<unknown>',
      }),
      expect.objectContaining({
        owner: '/virtual/app/unresolved-table.ts#bypass',
        operation: 'unknown-sql',
        table: '<unknown>',
      }),
      expect.objectContaining({
        owner: '/virtual/app/unresolved-table.ts#bypass',
        operation: 'unknown-sql',
        table: '<unknown>',
      }),
    ])
    expect(() => graph.assertNoUnknownSql()).toThrow('Unclassified dynamic SQL')
  })

  it('forbids mutation-shaped first-class references syntactically and permits a direct cache update', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/app/syntactic-sinks.ts': `
        import { tickets } from '../schema'
        declare const destructuredApi: { execute(statement: unknown): void }
        declare const computedApi: { delete(value: unknown): void }
        declare const sqlApi: { execute(statement: unknown): void }
        declare const trackedApi: { update(table: unknown): void }
        declare const unknownApi: { update(table: unknown): void }
        declare const cache: { update(value: unknown): void }
        export function destructured() { const { execute } = destructuredApi; return execute }
        export function computedDestructured() { const { ['delete']: remove } = computedApi; return remove }
        export function knownSql() {
          const execute = sqlApi.execute
          execute('update tickets set concern = concern')
        }
        export function knownTable() { const update = trackedApi.update; update(tickets) }
        export function unknownTable(table: unknown) { const update = unknownApi.update; update(table) }
        export function directCache() { cache.update(tickets) }
      `,
    })

    expect(graph.mutationSinkReferenceViolations().map(({ owner }) => owner)).toEqual([
      '/virtual/app/syntactic-sinks.ts#destructured',
      '/virtual/app/syntactic-sinks.ts#computedDestructured',
      '/virtual/app/syntactic-sinks.ts#knownSql',
      '/virtual/app/syntactic-sinks.ts#knownTable',
      '/virtual/app/syntactic-sinks.ts#unknownTable',
    ])
  })

  it('permits an exact direct non-Drizzle cache update with a tracked-table-shaped value', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/app/cache.ts': `
        import { tickets } from '../schema'
        declare const cache: { update(value: unknown): void }
        export function directCache() { cache.update(tickets) }
      `,
    })

    expect(graph.mutationSinkReferenceViolations()).toEqual([])
    expect(graph.mutations().filter(({ owner }) =>
      owner === '/virtual/app/cache.ts#directCache')).toEqual([])
  })

  it('rejects a destructured tracked mutation method call syntactically', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/app/destructured.ts': `
        import { tickets } from '../schema'
        declare const db: {
          insert(table: unknown): void
          update(table: unknown): void
          delete(table: unknown): void
        }
        export function bypass() { const { update } = db; update(tickets) }
      `,
    })

    expect(graph.mutationSinkReferenceViolations().map(({ owner }) => owner))
      .toEqual(['/virtual/app/destructured.ts#bypass'])
  })

  it('rejects a tracked-table method alias without treating unrelated direct update APIs as writes', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/app/wrapper.ts': `
        import { tickets } from '../schema'
        declare const wrapper: { update(table: unknown): void }
        declare const cache: { update(value: unknown): void }
        export function bypass() { const update = wrapper.update; update(tickets) }
        export function unrelated() { const update = cache.update; update('display') }
      `,
    })

    expect(graph.mutations()).toEqual([])
    expect(graph.mutationSinkReferenceViolations().map(({ owner }) => owner))
      .toEqual(['/virtual/app/wrapper.ts#bypass', '/virtual/app/wrapper.ts#unrelated'])
  })

  it('trusts only an exact registered direct Drizzle transaction receiver', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase {
          transaction<T>(callback: () => T): T
        }
      `,
      '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts': `
        import type { PgDatabase } from '../../../../drizzle-orm/pg-core/db'
        declare function directWriter(): void
        declare function proxyWriter(): void
        declare function aliasWriter(): void
        declare function wrapperWriter(): void
        declare function overrideWriter(): void

        export function runPrimaryAttempt(db: PgDatabase) {
          db.transaction(() => directWriter())
          const proxied = new Proxy(db, {})
          proxied.transaction(() => proxyWriter())
          const alias = db
          alias.transaction(() => aliasWriter())
          const wrapper: PgDatabase = { transaction: (callback) => callback() }
          wrapper.transaction(() => wrapperWriter())
          const overridden = { ...db, transaction: (callback: () => void) => callback() }
          overridden.transaction(() => overrideWriter())
        }
      `,
    })
    const owner = '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#runPrimaryAttempt'
    const closure = graph.transitiveCallees(owner)

    expect(closure).toContain('/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#directWriter')
    for (const writer of ['proxyWriter', 'aliasWriter', 'wrapperWriter', 'overrideWriter']) {
      expect(closure, writer)
        .not.toContain(`/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#${writer}`)
    }
  })

  it('rejects a registered Drizzle transaction receiver mutated anywhere in its owner', () => {
    const mutationCases = [
      ['parameter assignment', 'db = replacement'],
      ['compound assignment', 'db ||= replacement'],
      ['increment', 'db++'],
      ['destructuring assignment', '[db] = [replacement]'],
      ['Proxy replacement', 'db = new Proxy(db, {})'],
      ['transaction override', 'db.transaction = (callback) => callback()'],
      ['Object.assign override', 'Object.assign(db, { transaction: (callback: () => void) => callback() })'],
      ['Object.defineProperty override', "Object.defineProperty(db, 'transaction', { value: (callback: () => void) => callback() })"],
    ] as const

    for (const [label, mutation] of mutationCases) {
      const graph = createVirtualTypeScriptProgramGraphV1({
        '/virtual/drizzle-orm/pg-core/db.ts': `
          export interface PgDatabase { transaction<T>(callback: () => T): T }
        `,
        '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts': `
          import type { PgDatabase } from '../../../../drizzle-orm/pg-core/db'
          declare const replacement: PgDatabase
          declare function writer(): void
          export function runPrimaryAttempt(db: PgDatabase) {
            ${mutation}
            db.transaction(() => writer())
          }
        `,
      })
      const owner = '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#runPrimaryAttempt'
      expect(graph.transitiveCallees(owner), label)
        .not.toContain('/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts#writer')
    }

    const propertyGraph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase { transaction<T>(callback: () => T): T }
      `,
      '/virtual/lib/sessions.ts': `
        import type { PgDatabase } from '../drizzle-orm/pg-core/db'
        declare const replacement: PgDatabase
        declare function writer(): void
        export function submitRepairObservationForUser(opts: { db: PgDatabase }) {
          opts.db = replacement
          opts.db.transaction(() => writer())
        }
      `,
    })
    expect(propertyGraph.transitiveCallees('/virtual/lib/sessions.ts#submitRepairObservationForUser'))
      .not.toContain('/virtual/lib/sessions.ts#writer')
  })

  it('does not attach dead, returned, array, promise, or provider callbacks to their lexical owner', () => {
    const writer = '/virtual/writer.ts#writer'
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/writer.ts': `export function writer() {}`,
      '/virtual/case.ts': `
        import { writer } from './writer'
        declare function provider(callback: () => void): void
        export function approved() {
          const dead = [() => writer()]
          dead.map((callback) => callback())
          Promise.resolve().then(() => writer())
          provider(() => writer())
          return () => writer()
        }
      `,
    })

    expect(graph.transitiveCallees('/virtual/case.ts#approved')).not.toContain(writer)
    expect(graph.symbolReferenceViolations(new Map([
      [writer, new Set(['/virtual/case.ts#approved'])],
    ])).map(({ owner }) => owner)).toHaveLength(4)
  })

  it('attaches only the exact synchronous mutation executor callback contract', () => {
    const writer = '/virtual/writer.ts#writer'
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/lib/shop-os/continuity/mutation-foundation/transaction-runner.ts': `
        export function runBoundedShopOsMutationV1(
          _db: unknown,
          config: { discover(): unknown; executeLocked(): unknown },
        ) { config.discover(); return config.executeLocked() }
      `,
      '/virtual/writer.ts': `
        import { runBoundedShopOsMutationV1 } from './lib/shop-os/continuity/mutation-foundation/transaction-runner'
        export function writer() {}
        export function approved() {
          return runBoundedShopOsMutationV1({}, {
            discover: () => null,
            executeLocked: () => writer(),
          })
        }
      `,
    })

    const callbackOwner = graph.directCallers(writer)[0]!
    expect(callbackOwner).toMatch(/^\/virtual\/writer\.ts#approved\/<callback>@\d+$/)
    expect(graph.transitiveCallees('/virtual/writer.ts#approved')).toContain(writer)
    expect(graph.symbolReferenceViolations(new Map([
      [writer, new Set([callbackOwner])],
    ]))).toEqual([])
  })

  it('rejects a returned mutation callback even after coordinator and finalizer calls', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const tickets = { name: 'tickets' }`,
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase { update(table: unknown): void; execute(statement: string): void }
      `,
      '/virtual/app/returned.ts': `
        import { tickets } from '../schema'
        import type { PgDatabase } from '../drizzle-orm/pg-core/db'
        declare const db: PgDatabase
        declare function coordinator(): void
        declare function finalizer(): void
        export function writer() {
          coordinator()
          finalizer()
          return () => db.update(tickets)
        }
      `,
    })

    const mutation = graph.mutations()[0]!
    expect(graph.transitiveCallees('/virtual/app/returned.ts#writer')).not.toContain(mutation.owner)
    expect(graph.mutationOwnershipViolations(new Set(['/virtual/app/returned.ts#writer'])))
      .toEqual([mutation])
  })

  it('requires the route gate to dominate its reachable writer', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      ...files,
      '/virtual/conditional-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        declare const allowed: boolean
        export async function POST() {
          if (allowed) gate()
          await writer()
        }
      `,
      '/virtual/logical-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        declare const allowed: boolean
        export async function POST() {
          const denied = allowed && gate()
          await writer()
        }
      `,
      '/virtual/callback-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          Promise.resolve().then(() => gate())
          await writer()
        }
      `,
      '/virtual/try-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          try { gate() } finally {}
          await writer()
        }
      `,
      '/virtual/loop-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        declare const allowed: boolean
        export async function POST() {
          while (allowed) { gate(); break }
          await writer()
        }
      `,
      '/virtual/ternary-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        declare const allowed: boolean
        export async function POST() {
          allowed ? gate() : undefined
          await writer()
        }
      `,
      '/virtual/catch-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          try { throw new Error('deny') } catch { gate() }
          await writer()
        }
      `,
      '/virtual/finally-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          try {} finally { gate() }
          await writer()
        }
      `,
      '/virtual/helper-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          function maybeGate() { gate() }
          await writer()
        }
      `,
      '/virtual/ignored-route.ts': `
        import { routedWriter as writer } from './writer-barrel'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          await gate()
          await writer()
        }
      `,
    })
    const gate = '/virtual/gate.ts#entitlementReject'
    const writer = '/virtual/writer.ts#winningWriter'

    expect(graph.gateDominatesWriter('/virtual/route.ts#POST', gate, writer)).toBe(true)
    for (const route of [
      'conditional-route',
      'logical-route',
      'callback-route',
      'try-route',
      'loop-route',
      'ternary-route',
      'catch-route',
      'finally-route',
      'helper-route',
      'ignored-route',
    ]) {
      expect(graph.gateDominatesWriter(`/virtual/${route}.ts#POST`, gate, writer), route)
        .toBe(false)
    }
  })

  it('requires the refusal guard to control direct mutations as well as writer calls', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/schema.ts': `export const sessions = { name: 'sessions' }`,
      '/virtual/gate.ts': `export function entitlementReject(): { denied: true } | null { return null }`,
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase { update(table: unknown): void }
      `,
      '/virtual/db.ts': `
        import type { PgDatabase } from './drizzle-orm/pg-core/db'
        export declare const db: PgDatabase
      `,
      '/virtual/guarded.ts': `
        import { sessions } from './schema'
        import { db } from './db'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          const denied = await gate()
          if (denied) return denied
          await db.update(sessions)
        }
      `,
      '/virtual/ignored.ts': `
        import { sessions } from './schema'
        import { db } from './db'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          await gate()
          await db.update(sessions)
        }
      `,
      '/virtual/moved.ts': `
        import { sessions } from './schema'
        import { db } from './db'
        import { entitlementReject as gate } from './gate'
        export async function POST() {
          await db.update(sessions)
          const denied = await gate()
          if (denied) return denied
        }
      `,
      '/virtual/conditional.ts': `
        import { sessions } from './schema'
        import { db } from './db'
        import { entitlementReject as gate } from './gate'
        declare const allowed: boolean
        export async function POST() {
          if (allowed) {
            const denied = await gate()
            if (denied) return denied
          }
          await db.update(sessions)
        }
      `,
    })
    const gate = '/virtual/gate.ts#entitlementReject'

    expect(graph.gateControlsMutations('/virtual/guarded.ts#POST', gate)).toBe(true)
    for (const route of ['ignored', 'moved', 'conditional']) {
      expect(graph.gateControlsMutations(`/virtual/${route}.ts#POST`, gate), route).toBe(false)
    }
  })

  it('fails closed for dynamic SQL in an unregistered application file', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/drizzle-orm/pg-core/db.ts': `
        export interface PgDatabase { execute(statement: unknown): void }
      `,
      '/virtual/app/unregistered.ts': `
        import type { PgDatabase } from '../drizzle-orm/pg-core/db'
        declare const db: PgDatabase
        export function bypass(statement: unknown) { db.execute(statement) }
      `,
    })

    expect(() => graph.assertNoUnknownSql())
      .toThrow('/virtual/app/unregistered.ts#bypass')
  })
})
