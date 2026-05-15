'use client'

import { useAppHeader } from './app-header-context'

export function AppHeaderShopName() {
  const { shopName } = useAppHeader()
  if (!shopName) return null
  return (
    <div className="app-header__shop-name" title={shopName}>
      {shopName}
    </div>
  )
}
