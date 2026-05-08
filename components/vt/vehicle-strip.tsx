import Link from 'next/link'

export function VehicleStrip({
  name,
  vin,
  timer,
  back,
}: {
  name: string
  vin: string
  timer: string
  back?: { href: string; label: string }
}) {
  return (
    <header className="vehicle-strip">
      <div>
        {back && (
          <Link
            href={back.href}
            className="vehicle-strip__back"
            aria-label={`Back to ${back.label}`}
          >
            ← {back.label}
          </Link>
        )}
        <div className="vehicle-name">{name}</div>
        <div className="vin">{vin}</div>
      </div>
      <div className="timer" aria-label={`Session elapsed: ${timer}`}>
        {timer}
      </div>
    </header>
  )
}
