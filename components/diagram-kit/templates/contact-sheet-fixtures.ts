import type {
  ResolvedScene, StepShape, SlotName, SlotFill, PartSlotFill, OverlaySpec, GaugeSpec, DetailSlotFill, RouteSlotFill,
} from '@/lib/diagnostics/diagram/slot-interface'

const part = (
  partId: string, kind: PartSlotFill['kind'], name: string,
  roleSpecial: PartSlotFill['roleSpecial'] = null, tier: PartSlotFill['tier'] = 'anchor',
): PartSlotFill => ({
  fillKind: 'part', partId, kind, name, roleSpecial, tier,
  provenance: 'drafted', terminals: [], active: tier === 'focus', selected: false,
})

const focusPart = (partId: string, kind: PartSlotFill['kind'], name: string): PartSlotFill =>
  part(partId, kind, name, null, 'focus')

const overlay = (kind: OverlaySpec['kind'], attachPartId: string, attachTerminalId: string | null): OverlaySpec =>
  ({ kind, attachPartId, attachTerminalId })

const gauge = (expect: string, now: string, unit: string | null): GaugeSpec =>
  ({ reading: { expect, now, unit, mode: null, verdict: 'neutral' }, verdict: 'neutral' })

const detail = (why: string): DetailSlotFill =>
  ({ fillKind: 'detail', probe: null, why, secondary: null, theori: null })

const route = (next: string): RouteSlotFill =>
  ({ fillKind: 'route', routesToTestActionId: 't-next', nextActionText: next })

function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null, 'device-under-test': null, ground: null, 'downstream-anchor': null,
    overlay: null, gauge: null, 'good-vs-bad': null, route: null, location: null,
    detail: null, 'quiet-field': null,
  }
}

function build(
  shape: StepShape,
  slots: Partial<Record<SlotName, SlotFill>>,
  over: Partial<Pick<ResolvedScene, 'overlay' | 'gaugeSpec' | 'forkRoute' | 'pinsAllowed'>> = {},
): ResolvedScene {
  return {
    shape,
    slots: { ...emptySlots(), ...slots } as ResolvedScene['slots'],
    activeWireIds: [], overlay: null, gaugeSpec: null, forkRoute: null,
    focus: { selectedPartId: '' }, pinsAllowed: false, verdict: 'neutral', elements: [],
    ...over,
  }
}

/** One representative scene per v1 shape — the contact-sheet harness renders each at desktop
 *  + 375px for the visual gate. Synthetic where real data isn't authored (allowed by the bar).
 *  Built against the FROZEN C3 shapes (flat PartSlotFill, OverlaySpec, GaugeSpec.reading,
 *  DetailSlotFill, RouteSlotFill; canonical OverlayKind spellings). v1 leaves good-vs-bad /
 *  location / quiet-field null (T3 does too) — they render the honest degrade. */
export const CONTACT_SHEET_SCENES: Record<StepShape, ResolvedScene> = {
  confirm: build('confirm', {
    'device-under-test': focusPart('c-frp', 'sensor', 'FRP Sensor'),
    detail: detail("why we're here: P0087 low rail pressure"),
  }),
  'electrical-probe': build(
    'electrical-probe',
    {
      source: part('c-pcm', 'module', 'PCM', 'power-source'),
      'device-under-test': focusPart('c-frp', 'sensor', 'FRP Sensor'),
      ground: part('c-gnd', 'splice', 'G104', 'ground'),
      overlay: { fillKind: 'overlay', overlay: overlay('probe-lead', 'c-frp', 'p-sig') },
      detail: detail('back-probe the signal pin'),
    },
    { overlay: overlay('probe-lead', 'c-frp', 'p-sig'), pinsAllowed: true },
  ),
  'continuity-ground': build(
    'continuity-ground',
    {
      'device-under-test': focusPart('c-conn', 'connector', 'C0123'),
      ground: part('c-gnd', 'splice', 'G104', 'ground'),
      overlay: { fillKind: 'overlay', overlay: overlay('probe-lead', 'c-conn', 'p-gnd') },
      detail: detail('check continuity to chassis ground'),
    },
    { overlay: overlay('probe-lead', 'c-conn', 'p-gnd'), pinsAllowed: true },
  ),
  'voltage-drop': build(
    'voltage-drop',
    {
      source: part('c-alt', 'module', 'Alternator', 'power-source'),
      'device-under-test': focusPart('c-bat', 'module', 'Battery'),
      ground: part('c-gnd', 'splice', 'G104', 'ground'),
      overlay: { fillKind: 'overlay', overlay: overlay('voltage-drop-bracket', 'c-bat', 'b+') },
      detail: detail('measure drop across the B+ feed'),
    },
    { overlay: overlay('voltage-drop-bracket', 'c-bat', 'b+'), pinsAllowed: true },
  ),
  'duty-pwm': build(
    'duty-pwm',
    {
      source: part('c-pcm', 'module', 'PCM', 'power-source'),
      'device-under-test': focusPart('c-mprop', 'actuator', 'MPROP'),
      ground: part('c-gnd', 'splice', 'G104', 'ground'),
      overlay: { fillKind: 'overlay', overlay: overlay('probe-lead', 'c-mprop', 'p-pwm') },
      detail: detail('scope the PWM duty cycle'),
    },
    { overlay: overlay('probe-lead', 'c-mprop', 'p-pwm'), pinsAllowed: true },
  ),
  'single-pid': build(
    'single-pid',
    {
      'device-under-test': focusPart('c-ect', 'sensor', 'ECT Sensor'),
      gauge: { fillKind: 'gauge', gauge: gauge('180°F', '120°F', '°F') },
      detail: detail('read the live ECT PID'),
    },
    { gaugeSpec: gauge('180°F', '120°F', '°F') },
  ),
  'pressure-flow': build(
    'pressure-flow',
    {
      source: part('c-pump', 'pump', 'HP Pump'),
      'device-under-test': focusPart('c-frp', 'valve', 'FRP'),
      'downstream-anchor': part('c-rail', 'mechanical', 'Rail', null, 'recede'),
      gauge: { fillKind: 'gauge', gauge: gauge('≥5000psi', '1200psi', 'psi') },
      detail: detail('tee a mechanical gauge at the rail'),
    },
    { gaugeSpec: gauge('≥5000psi', '1200psi', 'psi'), overlay: overlay('pressure-gauge-tee', 'c-frp', null) },
  ),
  'look-inspect': build('look-inspect', {
    'device-under-test': focusPart('c-conn', 'connector', 'C0123'),
    detail: detail('inspect the connector for corrosion'),
  }),
  locate: build('locate', {
    'device-under-test': focusPart('c-def', 'connector', 'DEF Connector'),
    detail: detail('behind the DEF tank, driver-side rail'),
  }),
  fork: build(
    'fork',
    {
      'device-under-test': focusPart('c-next', 'valve', 'Next Device'),
      route: route('next: inspect the harness toward the PCM'),
      detail: detail('the cleared run points to the next test'),
    },
    { forkRoute: route('next: inspect the harness toward the PCM') },
  ),
}
