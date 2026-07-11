import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  cannedJobs,
  jobAttachments,
  jobLines,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
} from '@/lib/db/schema'

function names(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  return {
    checks: config.checks.map((entry) => entry.name),
    foreignKeys: config.foreignKeys.map((entry) => entry.getName()),
    foreignKeyDeletes: Object.fromEntries(
      config.foreignKeys.map((entry) => [entry.getName(), entry.onDelete]),
    ),
    foreignKeyColumns: Object.fromEntries(
      config.foreignKeys.map((entry) => {
        const reference = entry.reference()
        return [
          entry.getName(),
          {
            columns: reference.columns.map((column) => column.name),
            foreignColumns: reference.foreignColumns.map((column) => column.name),
          },
        ]
      }),
    ),
    indexes: config.indexes.map((entry) => entry.config.name),
    indexColumns: Object.fromEntries(
      config.indexes.map((entry) => [
        entry.config.name,
        entry.config.columns.map((column) => (column as { name?: string }).name),
      ]),
    ),
  }
}

describe('Shop OS quote foundation source schema', () => {
  it('loads the real schema module with all five quote foundation tables', () => {
    expect([
      getTableConfig(jobAttachments).name,
      getTableConfig(jobLines).name,
      getTableConfig(cannedJobs).name,
      getTableConfig(quoteVersions).name,
      getTableConfig(quoteEvents).name,
    ]).toEqual([
      'job_attachments',
      'job_lines',
      'canned_jobs',
      'quote_versions',
      'quote_events',
    ])
  })

  it('declares unconfigured shop pricing and exact approved-version job fields', () => {
    const shopColumns = getTableColumns(shops)
    const jobColumns = getTableColumns(ticketJobs)

    expect(shopColumns).toMatchObject({
      laborRateCents: expect.anything(),
      taxRateBps: expect.anything(),
    })
    expect(shopColumns.laborRateCents.getSQLType()).toBe('bigint')
    expect(shopColumns.laborRateCents.notNull).toBe(false)
    expect(shopColumns.laborRateCents.hasDefault).toBe(false)
    expect(shopColumns.taxRateBps.getSQLType()).toBe('integer')
    expect(shopColumns.taxRateBps.notNull).toBe(false)
    expect(shopColumns.taxRateBps.hasDefault).toBe(false)
    expect(names(shops).checks).toEqual(expect.arrayContaining([
      'shops_labor_rate_cents_range',
      'shops_tax_rate_bps_range',
    ]))

    expect(jobColumns).toMatchObject({
      customerStory: expect.anything(),
      storyMeta: expect.anything(),
      approvedQuoteVersionId: expect.anything(),
    })
    expect(jobColumns.customerStory.getSQLType()).toBe('jsonb')
    expect(jobColumns.storyMeta.getSQLType()).toBe('jsonb')
    expect(jobColumns.approvedQuoteVersionId.getSQLType()).toBe('uuid')
  })

  it('declares approved money and precision column types', () => {
    const lineColumns = getTableColumns(jobLines)

    expect(lineColumns.quantity.getSQLType()).toBe('numeric(12, 3)')
    expect(lineColumns.laborHours.getSQLType()).toBe('numeric(8, 2)')
    for (const column of [
      lineColumns.priceCents,
      lineColumns.unitCostCents,
      lineColumns.coreChargeCents,
      lineColumns.laborRateCents,
    ]) {
      expect(column.getSQLType()).toBe('bigint')
    }
  })

  it('declares every approved table field without future transport or vendor foreign keys', () => {
    expect(getTableColumns(jobAttachments)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      jobId: expect.anything(),
      storageKey: expect.anything(),
      kind: expect.anything(),
      mimeType: expect.anything(),
      byteSize: expect.anything(),
      uploadedByProfileId: expect.anything(),
      createdAt: expect.anything(),
    })
    expect(getTableColumns(jobLines)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      jobId: expect.anything(),
      kind: expect.anything(),
      description: expect.anything(),
      sort: expect.anything(),
      quantity: expect.anything(),
      priceCents: expect.anything(),
      taxable: expect.anything(),
      partNumber: expect.anything(),
      brand: expect.anything(),
      unitCostCents: expect.anything(),
      coreChargeCents: expect.anything(),
      fitment: expect.anything(),
      vendorAccountId: expect.anything(),
      externalOfferId: expect.anything(),
      vendorSnapshot: expect.anything(),
      partStatus: expect.anything(),
      orderedAt: expect.anything(),
      orderedByProfileId: expect.anything(),
      receivedAt: expect.anything(),
      receivedByProfileId: expect.anything(),
      laborHours: expect.anything(),
      laborRateCents: expect.anything(),
      source: expect.anything(),
      createdAt: expect.anything(),
      updatedAt: expect.anything(),
    })
    expect(getTableColumns(cannedJobs)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      title: expect.anything(),
      kind: expect.anything(),
      defaultRequiredSkillTier: expect.anything(),
      defaultLines: expect.anything(),
      sort: expect.anything(),
      retiredAt: expect.anything(),
      createdAt: expect.anything(),
      updatedAt: expect.anything(),
    })
    expect(getTableColumns(quoteVersions)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      ticketId: expect.anything(),
      versionNumber: expect.anything(),
      snapshot: expect.anything(),
      createdByProfileId: expect.anything(),
      createdAt: expect.anything(),
      supersededAt: expect.anything(),
    })
    expect(getTableColumns(quoteEvents)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      ticketId: expect.anything(),
      jobId: expect.anything(),
      quoteVersionId: expect.anything(),
      quoteSendId: expect.anything(),
      kind: expect.anything(),
      actorProfileId: expect.anything(),
      approvedVia: expect.anything(),
      requestKey: expect.anything(),
      providerEventId: expect.anything(),
      body: expect.anything(),
      userAgent: expect.anything(),
      createdAt: expect.anything(),
    })

    expect(names(jobLines).foreignKeys).not.toContain('job_lines_vendor_account_fk')
    expect(names(quoteEvents).foreignKeys).not.toContain('quote_events_send_fk')
  })

  it('declares composite ownership, exact-version, checks, and access indexes', () => {
    expect(names(ticketJobs).indexes).toEqual(expect.arrayContaining([
      'ticket_jobs_shop_id_uq',
      'ticket_jobs_shop_ticket_id_uq',
      'ticket_jobs_approved_quote_version_idx',
    ]))
    expect(names(ticketJobs).foreignKeys).toContain('ticket_jobs_approved_quote_version_fk')
    expect(names(ticketJobs).foreignKeyColumns.ticket_jobs_approved_quote_version_fk).toEqual({
      columns: ['shop_id', 'ticket_id', 'approved_quote_version_id'],
      foreignColumns: ['shop_id', 'ticket_id', 'id'],
    })
    expect(names(ticketJobs).foreignKeyDeletes.ticket_jobs_approved_quote_version_fk).toBe('restrict')
    expect(names(ticketJobs).indexColumns.ticket_jobs_approved_quote_version_idx).toEqual([
      'shop_id',
      'ticket_id',
      'approved_quote_version_id',
    ])

    expect(names(jobAttachments)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'job_attachments_shop_job_fk',
        'job_attachments_shop_uploader_fk',
      ]),
      indexes: expect.arrayContaining([
        'job_attachments_shop_storage_key_uq',
        'job_attachments_job_created_idx',
        'job_attachments_uploader_created_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        job_attachments_shop_job_fk: 'restrict',
        job_attachments_shop_uploader_fk: 'restrict',
      }),
      checks: expect.arrayContaining([
        'job_attachments_kind_valid',
        'job_attachments_byte_size_range',
      ]),
    })
    expect(names(jobAttachments).foreignKeyColumns).toMatchObject({
      job_attachments_shop_job_fk: {
        columns: ['shop_id', 'job_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      job_attachments_shop_uploader_fk: {
        columns: ['shop_id', 'uploaded_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(jobAttachments).indexColumns).toMatchObject({
      job_attachments_job_created_idx: ['shop_id', 'job_id', 'created_at'],
      job_attachments_uploader_created_idx: [
        'shop_id',
        'uploaded_by_profile_id',
        'created_at',
      ],
    })
    expect(names(jobLines)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'job_lines_shop_job_fk',
        'job_lines_shop_ordered_by_fk',
        'job_lines_shop_received_by_fk',
      ]),
      checks: expect.arrayContaining([
        'job_lines_kind_valid',
        'job_lines_quantity_positive',
        'job_lines_money_nonnegative',
        'job_lines_money_safe_integer',
        'job_lines_labor_hours_nonnegative',
        'job_lines_json_objects',
      ]),
      indexes: expect.arrayContaining([
        'job_lines_job_sort_idx',
        'job_lines_shop_vendor_account_idx',
        'job_lines_ordered_by_idx',
        'job_lines_received_by_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        job_lines_shop_job_fk: 'restrict',
        job_lines_shop_ordered_by_fk: 'restrict',
        job_lines_shop_received_by_fk: 'restrict',
      }),
    })
    expect(names(jobLines).foreignKeyColumns).toMatchObject({
      job_lines_shop_job_fk: {
        columns: ['shop_id', 'job_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      job_lines_shop_ordered_by_fk: {
        columns: ['shop_id', 'ordered_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      job_lines_shop_received_by_fk: {
        columns: ['shop_id', 'received_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(jobLines).indexColumns).toMatchObject({
      job_lines_job_sort_idx: ['shop_id', 'job_id', 'sort'],
      job_lines_ordered_by_idx: ['shop_id', 'ordered_by_profile_id'],
      job_lines_received_by_idx: ['shop_id', 'received_by_profile_id'],
    })
    expect(names(cannedJobs)).toMatchObject({
      checks: expect.arrayContaining([
        'canned_jobs_kind_valid',
        'canned_jobs_skill_tier_range',
        'canned_jobs_sort_nonnegative',
        'canned_jobs_default_lines_array',
      ]),
      indexes: expect.arrayContaining(['canned_jobs_shop_sort_idx']),
    })
    expect(names(quoteVersions)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'quote_versions_shop_ticket_fk',
        'quote_versions_shop_creator_fk',
      ]),
      checks: expect.arrayContaining([
        'quote_versions_number_positive',
        'quote_versions_snapshot_object',
      ]),
      indexes: expect.arrayContaining([
        'quote_versions_shop_ticket_version_uq',
        'quote_versions_shop_ticket_id_uq',
        'quote_versions_shop_creator_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        quote_versions_shop_ticket_fk: 'restrict',
        quote_versions_shop_creator_fk: 'restrict',
      }),
    })
    expect(names(quoteVersions).foreignKeyColumns).toMatchObject({
      quote_versions_shop_ticket_fk: {
        columns: ['shop_id', 'ticket_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      quote_versions_shop_creator_fk: {
        columns: ['shop_id', 'created_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(quoteVersions).indexColumns).toMatchObject({
      quote_versions_shop_ticket_version_uq: ['shop_id', 'ticket_id', 'version_number'],
      quote_versions_shop_creator_idx: ['shop_id', 'created_by_profile_id'],
    })
    expect(names(quoteEvents)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'quote_events_shop_ticket_fk',
        'quote_events_shop_ticket_job_fk',
        'quote_events_shop_ticket_version_fk',
        'quote_events_shop_actor_fk',
      ]),
      checks: expect.arrayContaining([
        'quote_events_kind_valid',
        'quote_events_approved_via_valid',
        'quote_events_approval_channel_consistent',
        'quote_events_decision_job_consistent',
        'quote_events_offline_approval_actor_consistent',
      ]),
      indexes: expect.arrayContaining([
        'quote_events_shop_request_key_uq',
        'quote_events_shop_provider_event_uq',
        'quote_events_ticket_created_idx',
        'quote_events_quote_send_idx',
        'quote_events_job_idx',
        'quote_events_version_idx',
        'quote_events_actor_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        quote_events_shop_ticket_fk: 'restrict',
        quote_events_shop_ticket_job_fk: 'restrict',
        quote_events_shop_ticket_version_fk: 'restrict',
        quote_events_shop_actor_fk: 'restrict',
      }),
    })
    expect(names(quoteEvents).foreignKeyColumns).toMatchObject({
      quote_events_shop_ticket_fk: {
        columns: ['shop_id', 'ticket_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      quote_events_shop_ticket_job_fk: {
        columns: ['shop_id', 'ticket_id', 'job_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'id'],
      },
      quote_events_shop_ticket_version_fk: {
        columns: ['shop_id', 'ticket_id', 'quote_version_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'id'],
      },
      quote_events_shop_actor_fk: {
        columns: ['shop_id', 'actor_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(quoteEvents).indexColumns).toMatchObject({
      quote_events_ticket_created_idx: ['shop_id', 'ticket_id', 'created_at'],
      quote_events_job_idx: ['shop_id', 'ticket_id', 'job_id'],
      quote_events_version_idx: ['shop_id', 'ticket_id', 'quote_version_id'],
      quote_events_actor_idx: ['shop_id', 'actor_profile_id'],
    })
  })
})
