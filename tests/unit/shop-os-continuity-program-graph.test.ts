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
    export function winningWriter() {
      coordinate(() => leafAlias())
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
  '/virtual/gate.ts': `export function entitlementReject() {}`,
  '/virtual/route.ts': `
    import { routedWriter as writer } from './writer-barrel'
    import { entitlementReject as gate } from './gate'
    export async function POST() {
      gate()
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
})
