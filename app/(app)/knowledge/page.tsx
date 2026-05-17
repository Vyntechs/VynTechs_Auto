import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { listKnowledgeItems, type KnowledgeListFilter } from '@/lib/knowledge/list'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { SAVE_ALL_TYPES } from '@/lib/knowledge/save'
import { FilterBar } from '@/components/knowledge/filter-bar'
import { KnowledgeRow } from '@/components/knowledge/row'
import { KnowledgeEmptyState } from '@/components/knowledge/empty-state'
import { KnowledgeDrawer } from '@/components/knowledge/drawer'
import { KnowledgePasteForm } from './paste-form'
import { RichKnowledgeForm } from './rich-form'

export const metadata = { title: 'Knowledge' }

const TYPE_SET = new Set<string>(SAVE_ALL_TYPES)

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge')

  const [profile] = await db
    .select({ role: profiles.role, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.role) || !profile?.shopId) redirect('/')

  const sp = await searchParams
  const filter = parseFilters(sp)
  const items = await listKnowledgeItems(db, { shopId: profile.shopId, filter })

  const detailId = singleParam(sp.detail)
  const detail = detailId
    ? await getKnowledgeItem(db, { id: detailId, shopId: profile.shopId })
    : null

  const queryString = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'detail') continue
    if (typeof v === 'string') queryString.set(k, v)
  }
  const currentQuery = queryString.toString()
  const hasActiveFilters = Object.keys(filter).length > 0

  return (
    <main className="vk-root">
      <header className="vk-header">
        <div className="vk-header__l">
          <div className="vk-eyebrow">
            <span>KNOWLEDGE</span>
            <span style={{ color: 'var(--vt-fg-3)' }}>·</span>
            <span className="vk-eyebrow__count">{items.length} item{items.length === 1 ? '' : 's'}</span>
          </div>
          <h1 className="vk-title">Vetted shop knowledge</h1>
        </div>
        <div className="vk-header__r">
          <button
            type="button"
            className="vk-btn vk-btn--primary"
            disabled
            title="Contribution UI ships in PR 5b. For now, use the paste/rich form below."
          >
            <span className="vk-btn__plus">+</span> Add knowledge
          </button>
        </div>
      </header>

      <FilterBar />

      <div className="vk-list">
        {items.length === 0 ? (
          <KnowledgeEmptyState hasFilters={hasActiveFilters} />
        ) : (
          <div className="vk-list__inner">
            {items.map(item => (
              <KnowledgeRow key={item.id} item={item} currentQuery={currentQuery} />
            ))}
          </div>
        )}
      </div>

      <KnowledgeDrawer item={detail} />

      <section
        className="vk-interim"
        style={{
          marginTop: 48,
          padding: '24px 32px',
          background: 'var(--vt-bone-100)',
          borderTop: '0.5px solid var(--vt-rule-strong)',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            color: 'var(--vt-fg-3)',
            textTransform: 'uppercase',
            margin: '0 0 16px',
          }}
        >
          PR 5b contribution UI · interim
        </p>
        <KnowledgePasteForm />
        <RichKnowledgeForm />
      </section>
    </main>
  )
}

function singleParam(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v[0] ?? null
  return null
}

function parseFilters(sp: Record<string, string | string[] | undefined>): KnowledgeListFilter {
  const filter: KnowledgeListFilter = {}
  const type = singleParam(sp.type)
  if (type && TYPE_SET.has(type)) filter.type = type as KnowledgeListFilter['type']
  const dtc = singleParam(sp.dtc); if (dtc) filter.dtc = dtc.toUpperCase()
  const sc = singleParam(sp.systemCode); if (sc) filter.systemCode = sc
  const sy = singleParam(sp.symptom); if (sy) filter.symptom = sy
  const make = singleParam(sp.vehicleMake); if (make) filter.vehicleMake = make
  const model = singleParam(sp.vehicleModel); if (model) filter.vehicleModel = model
  const year = singleParam(sp.vehicleYear); if (year && /^\d{4}$/.test(year)) filter.vehicleYear = Number(year)
  const status = singleParam(sp.status)
  if (status === 'active' || status === 'retired' || status === 'all') filter.status = status
  return filter
}
