export function VehicleStrip({
  name,
  vin,
  timer,
}: {
  name: string
  vin: string
  timer: string
}) {
  return (
    <header className="vehicle-strip">
      <div>
        <div className="vehicle-name">{name}</div>
        <div className="vin">{vin}</div>
      </div>
      <div className="timer" aria-label={`Session elapsed: ${timer}`}>
        {timer}
      </div>
    </header>
  )
}
