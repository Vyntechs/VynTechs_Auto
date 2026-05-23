import { Fragment, type ReactNode } from 'react'
import type {
  TopologyComponent,
  TopologyConnection,
  TopologyPin,
  TopologyScenario,
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
  | {
      kind: 'pin'
      pin: TopologyPin
      component: TopologyComponent
      scenario: TopologyScenario | null
    }

type Props = {
  selection: TopologySelection
  /** Jump the panel to a component (used by connection-endpoint buttons). */
  onSelectComponent: (componentId: string) => void
  /** Jump the panel to a pin (used by the component pin list). */
  onSelectPin?: (pinId: string) => void
  /** Clear the selection — closes the panel (and the mobile bottom sheet). */
  onClose: () => void
  /** Mobile: present as an open bottom sheet. */
  open?: boolean
}

/** Missing display values soft-fail to an em dash — never crash the page. */
function field(value: string | null): string {
  return value && value.trim() !== '' ? value : '—'
}

/** Renders text with limited inline markup: only <b> is re-enabled. Anything
 *  else stays as plain text. Spec §7.8 — preserves the prototype's emphasis
 *  pattern without a full Markdown layer. */
function withBoldOnly(text: string): ReactNode {
  const parts: ReactNode[] = []
  const regex = /<b>(.*?)<\/b>/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<b key={key++}>{match[1]}</b>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length === 1 ? parts[0] : <Fragment>{parts}</Fragment>
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

function ComponentBody({
  component,
  onSelectPin,
}: {
  component: TopologyComponent
  onSelectPin?: (pinId: string) => void
}) {
  // Spec §8: symptom-implicated test actions surface first.
  const tests = [...component.testActions].sort(
    (a, b) =>
      Number(b.implicatedByCurrentSymptom) - Number(a.implicatedByCurrentSymptom),
  )

  const showPinList =
    component.pins.length > 0 &&
    component.slug !== 'pcm' &&
    component.kind !== 'mechanical' &&
    component.kind !== 'splice' &&
    onSelectPin

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

      {showPinList && (
        <>
          <div className="topo-panel__section-title">Pins on this component</div>
          <ul className="topo-panel__pin-list">
            {component.pins.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="topo-panel__pin-list-item"
                  onClick={() => onSelectPin(p.id)}
                >
                  <span>{p.name}</span>
                  <span className="topo-panel__pin-list-role">
                    {p.roleAbbreviation}
                  </span>
                </button>
              </li>
            ))}
          </ul>
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

function PinBody({
  pin,
  component,
  scenario,
}: {
  pin: TopologyPin
  component: TopologyComponent
  scenario: TopologyScenario | null
}) {
  const reading = scenario ? scenario.pinReadings[pin.id] : undefined
  const isFault = scenario?.kind === 'fault'

  return (
    <>
      <div className="topo-panel__kind">Pin · {pin.name}</div>
      <h2 className="topo-panel__title">
        {component.name} · {pin.name}
      </h2>
      <div className="topo-panel__subtitle">
        click another to compare · click the diagram background to clear
      </div>
      <div className="topo-panel__rule" />

      <div className="topo-panel__section-title">Where to probe</div>
      <div className="topo-panel__body">{field(pin.probeLocation)}</div>

      <div className="topo-panel__section-title">Right now</div>
      <div
        className={`topo-panel__right-now${isFault ? ' is-fault' : ''}`}
      >
        {scenario && (
          <div className="topo-panel__right-now-label">{scenario.label}</div>
        )}
        {reading ? (
          <div>{withBoldOnly(reading)}</div>
        ) : (
          <div className="topo-panel__right-now-missing">
            <em>no live reading captured for this scenario yet</em>
          </div>
        )}
      </div>

      <div className="topo-panel__section-title">Expected range (overall)</div>
      <div className="topo-panel__expect">
        {withBoldOnly(field(pin.expectedReading))}
      </div>

      <div className="topo-panel__section-title">If the reading is wrong</div>
      <div className="topo-panel__alarm">
        <b>Diagnostic:</b> {withBoldOnly(field(pin.missingLogic))}
      </div>

      {pin.labelGap && (
        <div className="topo-panel__label-gap">
          <em>{pin.labelGap}</em>
        </div>
      )}
    </>
  )
}

export function TopologyDetailPanel({
  selection,
  onSelectComponent,
  onSelectPin,
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
        <ComponentBody component={selection.component} onSelectPin={onSelectPin} />
      )}
      {selection.kind === 'connection' && (
        <ConnectionBody
          connection={selection.connection}
          fromComponent={selection.fromComponent}
          toComponent={selection.toComponent}
          onSelectComponent={onSelectComponent}
        />
      )}
      {selection.kind === 'pin' && (
        <PinBody
          pin={selection.pin}
          component={selection.component}
          scenario={selection.scenario}
        />
      )}
    </aside>
  )
}
