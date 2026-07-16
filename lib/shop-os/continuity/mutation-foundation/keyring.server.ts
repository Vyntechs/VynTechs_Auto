import 'server-only'

import type { MutationFingerprintKeyringV1 } from './contracts'
import { createMutationFingerprintKeyringV1 } from './keyring'

export function loadMutationFingerprintKeyringFromProcessV1(): MutationFingerprintKeyringV1 {
  return createMutationFingerprintKeyringV1({
    SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: process.env.SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION,
    SHOP_OS_MUTATION_HMAC_KEYS_B64: process.env.SHOP_OS_MUTATION_HMAC_KEYS_B64,
  })
}
