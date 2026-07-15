import { AppHeader, Module } from '@/components/vt'

export type VehicleHistoryVehicle = {
  id: string
  year: number
  make: string
  model: string
  vin: string | null
  plate: string | null
}

export type VehicleHistoryCustomer = {
  id: string
  name: string
}

export function VehicleHistory({
  vehicle,
  customer,
}: {
  vehicle: VehicleHistoryVehicle
  customer: VehicleHistoryCustomer
}) {
  return (
    <div className="app">
      <AppHeader
        title="Vehicle history"
        back={{ href: '/intake', label: 'Intake' }}
        meta={
          <span>
            {vehicle.year} {vehicle.make} {vehicle.model} · {customer.name}
          </span>
        }
      />
      <div
        style={{
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module num="—" label="Vehicle">
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '6px 16px',
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 12,
              color: 'var(--vt-fg-2)',
            }}
          >
            <dt>Owner</dt>
            <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>{customer.name}</dd>
            <dt>Year / Make / Model</dt>
            <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </dd>
            {vehicle.vin && (
              <>
                <dt>VIN</dt>
                <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>{vehicle.vin}</dd>
              </>
            )}
            {vehicle.plate && (
              <>
                <dt>Plate</dt>
                <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>{vehicle.plate}</dd>
              </>
            )}
          </dl>
        </Module>

      </div>
    </div>
  )
}
