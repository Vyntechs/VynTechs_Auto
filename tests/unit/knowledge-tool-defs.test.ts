import { describe, it, expect } from 'vitest'
import {
  lookupKnowledgeTool,
  getConnectorPinoutTool,
  getTheoryOfOperationTool,
  getWiringPathTool,
  getComponentLocationTool,
  getSpecTool,
  KNOWLEDGE_TOOLS,
} from '@/lib/knowledge/tools'

describe('knowledge tool definitions', () => {
  it('all tools have name + description + input_schema', () => {
    for (const tool of KNOWLEDGE_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.input_schema.type).toBe('object')
      expect(tool.input_schema.properties).toBeDefined()
    }
  })

  it('lookup_knowledge requires vehicle', () => {
    expect(lookupKnowledgeTool.name).toBe('lookup_knowledge')
    expect(lookupKnowledgeTool.input_schema.required).toContain('vehicle')
  })

  it('get_connector_pinout requires connector_ref + vehicle', () => {
    expect(getConnectorPinoutTool.name).toBe('get_connector_pinout')
    expect(getConnectorPinoutTool.input_schema.required).toEqual(
      expect.arrayContaining(['connector_ref', 'vehicle']),
    )
  })

  it('get_theory_of_operation requires system_code + vehicle', () => {
    expect(getTheoryOfOperationTool.name).toBe('get_theory_of_operation')
    expect(getTheoryOfOperationTool.input_schema.required).toEqual(
      expect.arrayContaining(['system_code', 'vehicle']),
    )
  })

  it('get_wiring_path requires from_component, to_component, vehicle', () => {
    expect(getWiringPathTool.name).toBe('get_wiring_path')
    expect(getWiringPathTool.input_schema.required).toEqual(
      expect.arrayContaining(['from_component', 'to_component', 'vehicle']),
    )
  })

  it('get_component_location requires component_name + vehicle', () => {
    expect(getComponentLocationTool.name).toBe('get_component_location')
    expect(getComponentLocationTool.input_schema.required).toEqual(
      expect.arrayContaining(['component_name', 'vehicle']),
    )
  })

  it('get_spec requires spec_name + vehicle', () => {
    expect(getSpecTool.name).toBe('get_spec')
    expect(getSpecTool.input_schema.required).toEqual(
      expect.arrayContaining(['spec_name', 'vehicle']),
    )
  })

  it('exports exactly 6 tools', () => {
    expect(KNOWLEDGE_TOOLS).toHaveLength(6)
  })
})
