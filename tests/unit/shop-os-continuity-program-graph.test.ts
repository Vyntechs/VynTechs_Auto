import { describe, expect, it } from 'vitest'
import { createVirtualTypeScriptProgramGraphV1 } from '@/tests/helpers/typescript-program-graph'

const files = {
  '/virtual/schema.ts': `
    export const tickets = { name: 'tickets' }
    export const ticketJobs = { name: 'ticket_jobs' }
  `,
  '/virtual/db.ts': `
    export const db: any = {}
    export const sql: any = (parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })
  `,
  '/virtual/foundation.ts': `
    export function runBoundedShopOsMutationV1(callback: () => void) { callback() }
    export function finalizeMutationRevisionsV1() {}
    export function insertMutationReceiptPrimitiveV1() {}
  `,
  '/virtual/foundation-barrel.ts': `
    export { insertMutationReceiptPrimitiveV1 as leakedReceipt } from './foundation'
  `,
  '/virtual/writer.ts': `
    import * as schema from './schema'
    import { db, sql } from './db'
    import {
      runBoundedShopOsMutationV1 as coordinate,
      finalizeMutationRevisionsV1 as finalize,
    } from './foundation'

    const ticketTable = schema.tickets
    const rawUpdate = sql\`update public.tickets set concern = 'safe'\`
    function leafWriter() {
      db.update(ticketTable)
      db.execute(rawUpdate)
    }
    const leafAlias = leafWriter
    const registry = { run: leafAlias }
    export function winningWriter() {
      coordinate(() => leafAlias())
      finalize()
    }
    export function objectHeldWriter() {
      registry.run()
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
  '/virtual/gate.ts': `export function entitlementReject() {}`,
  '/virtual/route.ts': `
    import { routedWriter as writer } from './writer-barrel'
    import { entitlementReject as gate } from './gate'
    export async function POST() {
      gate()
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

  it('follows function aliases, imported wrappers, and re-exports transitively without blessing a sibling', () => {
    const graph = createVirtualTypeScriptProgramGraphV1(files)
    const winning = '/virtual/writer.ts#winningWriter'

    expect(graph.transitiveCallees(winning)).toEqual(expect.arrayContaining([
      '/virtual/foundation.ts#runBoundedShopOsMutationV1',
      '/virtual/foundation.ts#finalizeMutationRevisionsV1',
      '/virtual/writer.ts#leafWriter',
    ]))
    expect(graph.transitiveCallees('/virtual/writer.ts#bypassSibling'))
      .not.toContain('/virtual/foundation.ts#finalizeMutationRevisionsV1')
    expect(graph.directCallers('/virtual/writer.ts#winningWriter'))
      .toContain('/virtual/route.ts#POST')
    expect(graph.transitiveCallees('/virtual/writer.ts#objectHeldWriter'))
      .toContain('/virtual/writer.ts#leafWriter')
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

  it('keeps a called nested gate reachable and fails closed on dynamic object wrappers', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      ...files,
      '/virtual/dynamic-wrapper.ts': `
        import { winningWriter, bypassSibling } from './writer'
        declare const choose: () => boolean
        const unresolved = { run: choose() ? winningWriter : bypassSibling }
        export function unsafe() { unresolved.run() }
      `,
    })

    expect(graph.callOrder('/virtual/reachable-route.ts#POST', [
      '/virtual/gate.ts#entitlementReject',
      '/virtual/writer.ts#winningWriter',
    ])).toEqual([0, 1])
    expect(() => graph.assertNoUnresolvedDynamicCalls())
      .toThrow('/virtual/dynamic-wrapper.ts#unsafe')
  })

  it('classifies dynamic SQL hidden behind an object-held execute alias', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/app/rogue.ts': `
        declare const db: { execute(statement: unknown): void }
        const held = { run: db.execute }
        export function bypass(statement: unknown) { held.run(statement) }
      `,
    })

    expect(graph.mutations()).toContainEqual(expect.objectContaining({
      owner: '/virtual/app/rogue.ts#bypass',
      operation: 'unknown-sql',
    }))
  })

  it('resolves destructured and aliased object bindings to an object-held execute target', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/app/destructured.ts': `
        declare const db: { execute(statement: unknown): void }
        const held = { run: db.execute, execute: db.execute }
        const heldAlias = held
        const { run } = held
        const { execute: aliased } = heldAlias
        export function direct(statement: unknown) { run(statement) }
        export function renamed(statement: unknown) { aliased(statement) }
      `,
    })

    expect(graph.mutations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: '/virtual/app/destructured.ts#direct', operation: 'unknown-sql' }),
      expect.objectContaining({ owner: '/virtual/app/destructured.ts#renamed', operation: 'unknown-sql' }),
    ]))
  })

  it('resolves bind aliases and fails closed on arbitrary callable factories', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      ...files,
      '/virtual/app/bound.ts': `
        import { winningWriter } from '../writer'
        declare const db: { execute(statement: unknown): void }
        declare function wrap<T extends (...args: any[]) => any>(value: T): T
        const run = db.execute.bind(db)
        const held = winningWriter.bind(null)
        const unsafe = wrap(winningWriter)
        export function boundSql(statement: unknown) { run(statement) }
        export function boundWriter() { held() }
        export function factoryWriter() { unsafe() }
      `,
    })

    expect(graph.mutations()).toContainEqual(expect.objectContaining({
      owner: '/virtual/app/bound.ts#boundSql', operation: 'unknown-sql',
    }))
    expect(graph.transitiveCallees('/virtual/app/bound.ts#boundWriter'))
      .toContain('/virtual/writer.ts#winningWriter')
    expect(() => graph.assertNoUnresolvedDynamicCalls())
      .toThrow('/virtual/app/bound.ts#factoryWriter')
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
    ]) {
      expect(graph.gateDominatesWriter(`/virtual/${route}.ts#POST`, gate, writer), route)
        .toBe(false)
    }
  })

  it('fails closed for dynamic SQL in an unregistered application file', () => {
    const graph = createVirtualTypeScriptProgramGraphV1({
      '/virtual/app/unregistered.ts': `
        declare const db: { execute(statement: unknown): void }
        export function bypass(statement: unknown) { db.execute(statement) }
      `,
    })

    expect(() => graph.assertNoUnknownSql())
      .toThrow('/virtual/app/unregistered.ts#bypass')
  })
})
