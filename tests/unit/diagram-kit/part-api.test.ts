import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  DiagramPartProps,
  PartKind,
  PartRoleSpecial,
  WireRole,
  PartTier,
  PartProvenance,
  Terminal,
  PartReading,
  PartComponent,
  RegistryKey,
} from '@/components/diagram-kit/part-api'
import {
  PART_KINDS,
  PART_ROLE_SPECIALS,
  WIRE_ROLES,
  PART_TIERS,
  PART_PROVENANCES,
} from '@/components/diagram-kit/part-api'
import type {
  TopologyComponent,
  TopologyConnection,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'
import type { VerdictSignal } from '@/lib/diagnostics/diagram/slot-interface'

describe('C2 part-api unions', () => {
  it('PartKind covers exactly the 8 components.kind values', () => {
    expect([...PART_KINDS].sort()).toEqual(
      ['pump', 'sensor', 'actuator', 'valve',
       'module', 'mechanical', 'splice', 'connector'].sort(),
    )
  })

  it('PartRoleSpecial covers the 4 role-special symbols', () => {
    expect([...PART_ROLE_SPECIALS].sort()).toEqual(
      ['ground', 'relay', 'fuse', 'power-source'].sort(),
    )
  })

  it('WireRole covers exactly the 6 electricalRole values', () => {
    expect([...WIRE_ROLES].sort()).toEqual(
      ['signal', '5v-ref', 'low-ref', 'pwm', '12v', 'ground'].sort(),
    )
  })

  it('PartTier is focus/anchor/recede', () => {
    expect([...PART_TIERS].sort()).toEqual(['focus', 'anchor', 'recede'].sort())
  })

  it('PartProvenance is the 3-value draw register', () => {
    expect([...PART_PROVENANCES].sort()).toEqual(
      ['drafted', 'field-verified', 'needs-field-check'].sort(),
    )
  })
})

describe('C2 props type-compat with C1', () => {
  it('TopologyComponent.kind is assignable to PartKind|string (open fallback)', () => {
    expectTypeOf<TopologyComponent['kind']>().toMatchTypeOf<PartKind | string>()
  })

  it('WireRole equals the non-null TopologyConnection.electricalRole', () => {
    expectTypeOf<NonNullable<TopologyConnection['electricalRole']>>()
      .toEqualTypeOf<WireRole>()
  })

  it('Terminal.edge equals TopologyPin.edge', () => {
    expectTypeOf<Terminal['edge']>().toEqualTypeOf<TopologyPin['edge']>()
  })

  it('DiagramPartProps shape: kind/tier/provenance required, roleSpecial nullable', () => {
    expectTypeOf<DiagramPartProps>().toHaveProperty('kind')
    expectTypeOf<DiagramPartProps>().toHaveProperty('tier')
    expectTypeOf<DiagramPartProps>().toHaveProperty('provenance')
    expectTypeOf<DiagramPartProps['roleSpecial']>()
      .toEqualTypeOf<PartRoleSpecial | null>()
  })

  it('Terminal.visible is required (engine-controlled leak-lock)', () => {
    expectTypeOf<Terminal['visible']>().toEqualTypeOf<boolean>()
  })

  it('PartReading is a thin handoff carrying unit/mode + the shared verdict (R5/R6)', () => {
    expectTypeOf<PartReading>().toHaveProperty('expect')
    expectTypeOf<PartReading>().toHaveProperty('now')
    expectTypeOf<PartReading>().toHaveProperty('unit')
    expectTypeOf<PartReading>().toHaveProperty('mode')
    expectTypeOf<PartReading>().toHaveProperty('verdict')
    expectTypeOf<PartReading['verdict']>().toEqualTypeOf<VerdictSignal>()
  })

  it('PartComponent is a component of DiagramPartProps', () => {
    expectTypeOf<PartComponent>().toMatchTypeOf<
      (props: DiagramPartProps) => unknown
    >()
  })

  it('RegistryKey is PartKind | PartRoleSpecial', () => {
    expectTypeOf<RegistryKey>().toEqualTypeOf<PartKind | PartRoleSpecial>()
  })
})
