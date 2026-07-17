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
