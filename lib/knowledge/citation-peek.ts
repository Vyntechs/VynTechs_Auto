import type { KnowledgeListRow } from './list'

/**
 * One-line preview shown under the title of a cited knowledge card in
 * the diagnose-step Docket. Type-aware: pinout and wiring return a list
 * of mono-rendered data segments; other types return italic-serif prose.
 *
 * Segments can be `dim` (rendered in a faded color — separators, labels)
 * or plain (the actual values). The renderer maps segments to spans.
 */
export type CitationPeekSegment = { text: string; dim?: boolean }

export type CitationPeek =
  | { kind: 'prose'; text: string }
  | { kind: 'data'; segments: CitationPeekSegment[] }

const DIM = (text: string): CitationPeekSegment => ({ text, dim: true })
const SOLID = (text: string): CitationPeekSegment => ({ text })

const FALLBACK_LABEL: Record<KnowledgeListRow['type'], string> = {
  pinout: 'Pin reference.',
  connector: 'Connector reference.',
  wiring_diagram: 'Wiring reference.',
  theory_of_operation: 'Theory of operation.',
  cause_fix: 'Cause / fix.',
  bulletin: 'Bulletin.',
  note: 'Shop note.',
  reference_doc: 'Reference.',
}

type PinRow = {
  pin_number?: string
  signal_name?: string
  wire_color?: string
  expected_voltage_or_waveform?: string
}

type WiringConnection = {
  from_component?: string
  from_pin?: string
  to_component?: string
  to_pin?: string
  wire_color?: string
}

type TheorySection = { heading?: string; body?: string }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function prose(text: string | undefined, type: KnowledgeListRow['type']): CitationPeek {
  return { kind: 'prose', text: text && text.length > 0 ? text : FALLBACK_LABEL[type] }
}

export function getCitationPeek(item: KnowledgeListRow): CitationPeek {
  const sd = asRecord(item.structuredData)

  switch (item.type) {
    case 'pinout': {
      const pins = asArray<PinRow>(sd.pins)
      const p = pins[0]
      if (!p?.pin_number || !p?.signal_name) {
        return prose(asString(sd.connector_ref), 'pinout')
      }
      const segments: CitationPeekSegment[] = [
        DIM('pin '),
        SOLID(p.pin_number),
        DIM(' · '),
        SOLID(p.signal_name),
      ]
      const wire = asString(p.wire_color)
      if (wire) segments.push(DIM(' · '), SOLID(wire))
      const expected = asString(p.expected_voltage_or_waveform)
      if (expected) segments.push(DIM(' · '), SOLID(expected))
      return { kind: 'data', segments }
    }

    case 'connector':
      return prose(
        asString(sd.location_description) ?? asString(sd.component_name),
        'connector',
      )

    case 'wiring_diagram': {
      const conns = asArray<WiringConnection>(sd.connections)
      const c = conns[0]
      if (!c?.from_component || !c?.to_component) {
        return prose(asString(sd.name), 'wiring_diagram')
      }
      const fromPin = asString(c.from_pin)
      const toPin = asString(c.to_pin)
      const wire = asString(c.wire_color)
      const segments: CitationPeekSegment[] = [
        SOLID(c.from_component),
        ...(fromPin ? [SOLID(` ${fromPin}`)] : []),
        DIM(' → '),
        SOLID(c.to_component),
        ...(toPin ? [SOLID(` ${toPin}`)] : []),
      ]
      if (wire) segments.push(DIM(' · '), SOLID(wire))
      return { kind: 'data', segments }
    }

    case 'theory_of_operation': {
      const sections = asArray<TheorySection>(sd.sections)
      const s = sections[0]
      return prose(asString(s?.body) ?? asString(s?.heading), 'theory_of_operation')
    }

    case 'cause_fix':
      return prose(
        asString(sd.correction) ?? asString(sd.cause) ?? asString(sd.complaint),
        'cause_fix',
      )

    case 'bulletin': {
      const source = asString(sd.source)
      const bulletinId = asString(sd.bulletin_id)
      const summary = asString(sd.summary)
      const segments: CitationPeekSegment[] = []
      if (source && bulletinId) {
        segments.push(SOLID(`${source} ${bulletinId}`))
      } else if (source) {
        segments.push(SOLID(source))
      } else if (bulletinId) {
        segments.push(SOLID(bulletinId))
      }
      if (summary) {
        if (segments.length > 0) segments.push(DIM(' · '))
        segments.push(SOLID(summary))
      }
      if (segments.length === 0) return prose(undefined, 'bulletin')
      return { kind: 'data', segments }
    }

    case 'note':
    case 'reference_doc':
      return prose(asString(item.body), item.type)
  }
}
