import { describe, expect, it } from 'vitest'
import { KnowledgeSaveSchema } from '@/lib/knowledge/save'

const baseVehicleScope = { yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' }

describe('KnowledgeSaveSchema — pinout', () => {
  it('accepts a well-formed pinout with 2 pins', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'Alternator 4-pin pinout',
      vehicleScopes: [baseVehicleScope],
      systemCodes: ['charging'],
      structuredData: {
        connector_ref: 'Alternator 4-pin',
        pins: [
          { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
          { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects duplicate pin_number values', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'Bad pinout',
      structuredData: {
        connector_ref: 'C1',
        pins: [
          { pin_number: '1', signal_name: 'A' },
          { pin_number: '1', signal_name: 'B' },
        ],
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty pins array', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'No pins',
      structuredData: { connector_ref: 'C1', pins: [] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing connector_ref', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'No connector ref',
      structuredData: { pins: [{ pin_number: '1', signal_name: 'X' }] },
    })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeSaveSchema — connector', () => {
  it('accepts a connector with image refs', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'connector',
      title: 'BCM C2280',
      vehicleScopes: [baseVehicleScope],
      systemCodes: ['body_electrical'],
      structuredData: {
        connector_id: 'C2280',
        component_name: 'Body Control Module',
        location_description: 'Behind driver kick panel',
        image_ref: 'knowledge/shop1/connector/abc.jpg',
        mating_end_image_ref: 'knowledge/shop1/connector/def.jpg',
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a connector without images', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'connector',
      title: 'Alternator 4-pin',
      structuredData: {
        connector_id: 'alt_4pin',
        component_name: 'Alternator',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing component_name', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'connector',
      title: 'X',
      structuredData: { connector_id: 'C1' },
    })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeSaveSchema — wiring_diagram', () => {
  it('accepts a wiring diagram with image and connections', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'wiring_diagram',
      title: 'BCM <-> Alternator',
      structuredData: {
        name: 'BCM to Alternator charging circuit',
        image_ref: 'knowledge/shop1/wiring_diagram/xyz.png',
        connections: [
          { from_component: 'BCM', from_pin: '3', to_component: 'Alternator', to_pin: '3', wire_color: 'GRN' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a wiring diagram with image but no connections', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'wiring_diagram',
      title: 'Image-only',
      structuredData: { name: 'X', image_ref: 'knowledge/shop1/wiring_diagram/x.png' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects wiring diagram without image_ref', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'wiring_diagram',
      title: 'No image',
      structuredData: { name: 'X' },
    })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeSaveSchema — theory_of_operation', () => {
  it('accepts theory with multiple sections', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'theory_of_operation',
      title: '6.7L charging system theory',
      structuredData: {
        title: '6.7L Powerstroke Charging System',
        sections: [
          { heading: 'Overview', body: 'The 6.7L uses a smart alternator...' },
          { heading: 'LIN bus control', body: 'BCM commands the field via LIN...' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty sections array', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'theory_of_operation',
      title: 'No content',
      structuredData: { title: 'X', sections: [] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects section with empty body', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'theory_of_operation',
      title: 'X',
      structuredData: { title: 'X', sections: [{ heading: 'h', body: '' }] },
    })
    expect(result.success).toBe(false)
  })
})
