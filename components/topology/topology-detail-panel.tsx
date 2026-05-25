import type {
  TopologyComponent,
  TopologyConnection,
} from '@/lib/diagnostics/load-system-topology'
import { formatConnectionKind } from '@/components/topology/topology-format'

/** What the panel is currently showing. */
export type TopologySelection =
  | { kind: 'empty' }
  | { kind: 'component'; component: TopologyComponent }
  | {
      kind: 'connection'
      connection: TopologyConnection
      fromComponent: TopologyComponent | null
      toComponent: TopologyComponent | null
    }

type Props = {
  selection: TopologySelection
  /** Jump the panel to a component (used by connection-endpoint buttons). */
  onSelectComponent: (componentId: string) => void
  /** Clear the selection — closes the panel (and the mobile bottom sheet). */
  onClose: () => void
  /** Mobile: present as an open bottom sheet. */
  open?: boolean
}

/** Missing display values soft-fail to an em dash — never crash the page. */
function field(value: string | null): string {
  return value && value.trim() !== '' ? value : '—'
}

const PROVENANCE_LABEL: Record<string, string> = {
  'TRAINING-CONFIRMED': 'from theory',
  'TRAINING-INFERRED': 'inferred from theory',
  'FIELD-VERIFIED': 'field-verified',
  GAP: 'needs field verification',
}

function Provenance({ value }: { value: string }) {
  return (
    <span className="topo-panel__provenance" data-provenance={value}>
      {PROVENANCE_LABEL[value] ?? value.toLowerCase()}
    </span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="topo-panel__row">
      <span className="topo-panel__row-label">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function ComponentBody({ component }: { component: TopologyComponent }) {
  // Spec §8: symptom-implicated test actions surface first.
  const tests = [...component.testActions].sort(
    (a, b) =>
      Number(b.implicatedByCurrentSymptom) - Number(a.implicatedByCurrentSymptom),
  )
  return (
    <>
      <div className="topo-panel__kind">{component.kind}</div>
      <h2 className="topo-panel__title">{component.name}</h2>
      <Provenance value={component.sourceProvenance} />

      <Row label="Location" value={field(component.location)} />
      <Row label="Function" value={field(component.function)} />
      <Row label="Electrical" value={field(component.electricalContract)} />

      {component.observableProperties.length > 0 && (
        <>
          <div className="topo-panel__section-title">Probe points</div>
          {component.observableProperties.map((op) => (
            <div key={op.slug} className="topo-panel__probe">
              <div>{op.description}</div>
              <div className="topo-panel__row-label">{op.observationMethod}</div>
            </div>
          ))}
        </>
      )}

      {tests.length > 0 && (
        <>
          <div className="topo-panel__section-title">
            What to expect / what a wrong reading means
          </div>
          {tests.map((t) => (
            <div
              key={t.slug}
              data-testid="topo-test"
              className={`topo-panel__test${
                t.implicatedByCurrentSymptom ? ' is-implicated' : ''
              }`}
            >
              <div>{t.description}</div>
              {t.expectedObservation && (
                <div className="topo-panel__row-label">
                  expect: {t.expectedObservation}
                </div>
              )}
              {/* Branches sorted by condition — stable display order
                  (PR-A code-review follow-up: branch_logic has no DB order). */}
              {[...t.branches]
                .sort((a, b) => a.condition.localeCompare(b.condition))
                .map((b, i) => (
                  <div key={i}>
                    {b.condition} → {b.verdict}: {b.nextAction}
                  </div>
                ))}
            </div>
          ))}
        </>
      )}
    </>
  )
}

function ConnectionBody({
  connection,
  fromComponent,
  toComponent,
  onSelectComponent,
}: {
  connection: TopologyConnection
  fromComponent: TopologyComponent | null
  toComponent: TopologyComponent | null
  onSelectComponent: (id: string) => void
}) {
  return (
    <>
      <div className="topo-panel__kind">connection</div>
      <h2 className="topo-panel__title">
        {formatConnectionKind(connection.connectionKind)}
      </h2>
      <Provenance value={connection.sourceProvenance} />

      <Row label="Description" value={field(connection.description)} />
      <Row label="Direction" value={connection.direction} />

      <div className="topo-panel__section-title">Links</div>
      {[fromComponent, toComponent].map((c, i) =>
        c ? (
          <button
            key={`${i}-${c.id}`}
            type="button"
            className="topo-panel__link"
            onClick={() => onSelectComponent(c.id)}
          >
            {i === 0 ? 'From' : 'To'}: {c.name}
          </button>
        ) : null,
      )}
    </>
  )
}

export function TopologyDetailPanel({
  selection,
  onSelectComponent,
  onClose,
  open,
}: Props) {
  return (
    <aside
      className={`topo-panel${open ? ' is-open' : ''}`}
      aria-live="polite"
    >
      {selection.kind !== 'empty' && (
        <button
          type="button"
          className="topo-panel__close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      )}
      {selection.kind === 'empty' && (
        <div className="topo-panel__empty">
          Click any part or line to see what it is, where it is, and what to
          expect when you probe it.
        </div>
      )}
      {selection.kind === 'component' && (
        <ComponentBody component={selection.component} />
      )}
      {selection.kind === 'connection' && (
        <ConnectionBody
          connection={selection.connection}
          fromComponent={selection.fromComponent}
          toComponent={selection.toComponent}
          onSelectComponent={onSelectComponent}
        />
      )}
    </aside>
  )
}
