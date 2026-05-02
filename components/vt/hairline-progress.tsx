export function HairlineProgress({ width = '70%' }: { width?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className="hairline-progress"
      style={{ margin: '0 auto', width }}
    />
  )
}
