function refuseServerCrypto(): never {
  throw new Error('server-only node:crypto reached the ticket correction browser harness')
}

// Client surfaces in this harness import server-domain modules for TypeScript
// projection types. Vite still scans those modules and would externalize the
// Node builtin before React can mount. Every export throws so an accidental
// runtime dependency fails visibly instead of receiving synthetic crypto.
export const createHash = refuseServerCrypto
export const createHmac = refuseServerCrypto
export const randomUUID = refuseServerCrypto
export const timingSafeEqual = refuseServerCrypto
