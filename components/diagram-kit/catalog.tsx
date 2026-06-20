import './diagram-kit.css'
import {
  PART_KINDS,
  PART_ROLE_SPECIALS,
  PART_PROVENANCES,
  type DiagramPartProps,
} from './part-api'
import { resolvePart } from './registry'
import { OVERLAY_KINDS } from './overlays/overlay-api'
import { TestOverlay } from './overlays/test-overlay'

const base: Pick<DiagramPartProps, 'tier' | 'active' | 'selected'> = {
  tier: 'focus', active: false, selected: false,
}

/**
 * Visual gate: every part/variant rendered once. The catalog page (captured at
 * desktop + 375px for the screenshot) wraps this. Pure render, no data.
 */
export function KitCatalog() {
  return (
    <div className="dk-catalog">
      <section className="dk-catalog__row" data-group="kinds">
        {PART_KINDS.map((kind) => {
          const Part = resolvePart(kind)
          return <Part key={kind} {...base} kind={kind} roleSpecial={null} name={kind} provenance="drafted" />
        })}
      </section>

      <section className="dk-catalog__row" data-group="role-specials">
        {PART_ROLE_SPECIALS.map((role) => {
          const Part = resolvePart(role)
          return <Part key={role} {...base} kind="module" roleSpecial={role} name={role} provenance="drafted" />
        })}
      </section>

      <section className="dk-catalog__row" data-group="provenance">
        {PART_PROVENANCES.map((prov) => {
          const Part = resolvePart('pump')
          return <Part key={prov} {...base} kind="pump" roleSpecial={null} name={prov} provenance={prov} />
        })}
      </section>

      <section className="dk-catalog__row" data-group="overlays">
        {OVERLAY_KINDS.map((kind) => (
          <svg key={kind} viewBox="0 0 40 24" className="dk-catalog__overlay-cell">
            <TestOverlay kind={kind} />
          </svg>
        ))}
      </section>
    </div>
  )
}
