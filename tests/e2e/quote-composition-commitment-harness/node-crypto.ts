function refuseServerCrypto(): never {
  throw new Error('server-only node:crypto reached the quote commitment browser harness')
}

export const createHash = refuseServerCrypto
export const createHmac = refuseServerCrypto
export const randomUUID = refuseServerCrypto
export const timingSafeEqual = refuseServerCrypto
