import type Anthropic from '@anthropic-ai/sdk'

// Vehicle schema shared by every knowledge tool. Required: year + make +
// model. Engine is optional — many AI tool calls only have year/make/model
// in scope when the AI hasn't yet asked for engine detail.
const vehicleSchema = {
  type: 'object',
  properties: {
    year: { type: 'integer' },
    make: { type: 'string' },
    model: { type: 'string' },
    engine: { type: 'string' },
  },
  required: ['year', 'make', 'model'],
} as const

export const lookupKnowledgeTool: Anthropic.Tool = {
  name: 'lookup_knowledge',
  description:
    "Look up vetted shop knowledge for the current vehicle. Use when you need vehicle-specific information " +
    "(failure patterns, references, bulletins, notes). Returns up to N matching items above the relevance threshold. " +
    "Empty result means the shop has not curated knowledge matching this context — continue your normal diagnostic guidance.",
  input_schema: {
    type: 'object',
    properties: {
      vehicle: vehicleSchema,
      dtcs: { type: 'array', items: { type: 'string' } },
      symptoms: { type: 'array', items: { type: 'string' } },
      system_codes: { type: 'array', items: { type: 'string' } },
      type_filter: {
        type: 'string',
        enum: [
          'cause_fix',
          'reference_doc',
          'bulletin',
          'note',
          'pinout',
          'connector',
          'wiring_diagram',
          'theory_of_operation',
        ],
      },
      limit: { type: 'integer', default: 3 },
    },
    required: ['vehicle'],
  },
}

export const getConnectorPinoutTool: Anthropic.Tool = {
  name: 'get_connector_pinout',
  description:
    "Get the pin table for a specific connector on this vehicle. Use when you need pin numbers, signal names, " +
    "wire colors, or expected voltages for a connector. Empty result means the shop has not curated this connector " +
    "— continue with general guidance and ask the tech to look up the OEM pinout.",
  input_schema: {
    type: 'object',
    properties: {
      connector_ref: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['connector_ref', 'vehicle'],
  },
}

export const getTheoryOfOperationTool: Anthropic.Tool = {
  name: 'get_theory_of_operation',
  description:
    "Get the theory of operation for a specific vehicle system. Use when the tech needs to understand HOW the " +
    "system works on this exact vehicle (control strategy, communication bus, sensor logic). Empty result means " +
    "no vetted theory document — fall back to general system principles.",
  input_schema: {
    type: 'object',
    properties: {
      system_code: {
        type: 'string',
        description: 'System code (e.g. "charging", "fuel_delivery", "can_bus")',
      },
      vehicle: vehicleSchema,
    },
    required: ['system_code', 'vehicle'],
  },
}

export const getWiringPathTool: Anthropic.Tool = {
  name: 'get_wiring_path',
  description:
    "Get the wiring path between two components on this vehicle. Use when you need to follow a signal or power " +
    "path between named components. Empty result means the shop has not curated this wiring path.",
  input_schema: {
    type: 'object',
    properties: {
      from_component: { type: 'string' },
      to_component: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['from_component', 'to_component', 'vehicle'],
  },
}

export const getComponentLocationTool: Anthropic.Tool = {
  name: 'get_component_location',
  description:
    "Get the physical location of a named component on this vehicle. Use when the tech needs to find a component " +
    "(connector, sensor, module) physically. Empty result means the shop has not curated this component location.",
  input_schema: {
    type: 'object',
    properties: {
      component_name: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['component_name', 'vehicle'],
  },
}

export const getSpecTool: Anthropic.Tool = {
  name: 'get_spec',
  description:
    "Get a vehicle-specific spec value (torque, voltage, fluid capacity, ride height, etc.). Use when you need a " +
    "numeric spec for this exact vehicle. Empty result means no vetted spec — defer to the tech's OEM lookup.",
  input_schema: {
    type: 'object',
    properties: {
      spec_name: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['spec_name', 'vehicle'],
  },
}

export const KNOWLEDGE_TOOLS: Anthropic.Tool[] = [
  lookupKnowledgeTool,
  getConnectorPinoutTool,
  getTheoryOfOperationTool,
  getWiringPathTool,
  getComponentLocationTool,
  getSpecTool,
]

export type KnowledgeToolName =
  | 'lookup_knowledge'
  | 'get_connector_pinout'
  | 'get_theory_of_operation'
  | 'get_wiring_path'
  | 'get_component_location'
  | 'get_spec'
