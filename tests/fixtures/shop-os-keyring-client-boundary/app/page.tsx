'use client'

import { createMutationFingerprintKeyringV1 } from '../../../../lib/shop-os/continuity/mutation-foundation/keyring'

const keyringFactory = createMutationFingerprintKeyringV1

export default function BoundaryProbePage() {
  return <main>{keyringFactory.name}</main>
}
