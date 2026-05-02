'use client'

import { useEffect } from 'react'

export function SwRegister() {
  useEffect(() => {
    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production'
    ) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('sw register failed', err)
      })
    }
  }, [])
  return null
}
