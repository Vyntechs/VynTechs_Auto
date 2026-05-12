import { detectInputShape, type InputShape } from './input-shape'

export type CreateNewPrefill = {
  name?: string
  phone?: string
  email?: string
  vin?: string
  year?: number
  make?: string
  plate?: string
}

/**
 * Collapses an array of search tokens into a CreateNewPrefill.
 *
 * Adjacent tokens that together form a more specific shape (e.g. "(720)" and
 * "555-1234" joining into a 10-digit phone) are merged greedily, then each
 * surviving token is routed by detectInputShape.
 */
export function tokensToPrefill(tokens: string[]): CreateNewPrefill {
  const trimmed = tokens.map((t) => t.trim()).filter((t) => t !== '')
  if (trimmed.length === 0) return {}

  // Greedy merge: scan adjacent pairs and join if the joined string is a more
  // specific shape than either part alone. Only collapses phone-shaped chunks
  // (the routinely-split-by-whitespace shape in practice).
  const merged: string[] = []
  let i = 0
  while (i < trimmed.length) {
    const here = trimmed[i]
    const next = trimmed[i + 1]
    if (next !== undefined) {
      const joined = here + next
      const joinedShape = detectInputShape(joined)
      if (joinedShape.kind === 'phone') {
        merged.push(joined)
        i += 2
        continue
      }
    }
    merged.push(here)
    i += 1
  }

  const prefill: CreateNewPrefill = {}
  const nameParts: string[] = []

  for (const token of merged) {
    const shape: InputShape = detectInputShape(token)
    switch (shape.kind) {
      case 'phone':
        prefill.phone = shape.value
        break
      case 'vin':
        prefill.vin = shape.value
        break
      case 'year':
        prefill.year = shape.value
        break
      case 'make':
        prefill.make = shape.value
        break
      case 'email':
        prefill.email = shape.value
        break
      case 'plate':
        prefill.plate = shape.value
        break
      case 'name':
        nameParts.push(shape.value)
        break
    }
  }

  if (nameParts.length > 0) prefill.name = nameParts.join(' ')
  return prefill
}
