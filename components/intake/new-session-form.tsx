'use client'

export function NewSessionForm() {
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const payload = {
      vehicleYear: Number(formData.get('vehicleYear')),
      vehicleMake: String(formData.get('vehicleMake') ?? ''),
      vehicleModel: String(formData.get('vehicleModel') ?? ''),
      customerComplaint: String(formData.get('customerComplaint') ?? ''),
    }
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="year">Year</label>
      <input id="year" name="vehicleYear" type="number" />

      <label htmlFor="make">Make</label>
      <input id="make" name="vehicleMake" />

      <label htmlFor="model">Model</label>
      <input id="model" name="vehicleModel" />

      <label htmlFor="complaint">Customer complaint</label>
      <textarea id="complaint" name="customerComplaint" />

      <button type="submit">Start diagnosis</button>
    </form>
  )
}
