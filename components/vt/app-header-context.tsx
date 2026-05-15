'use client'

import { createContext, useContext, type ReactNode } from 'react'

type AppHeaderContextValue = {
  shopName: string | null
  isFounder: boolean
}

const AppHeaderContext = createContext<AppHeaderContextValue>({
  shopName: null,
  isFounder: false,
})

export function AppHeaderProvider({
  shopName,
  isFounder,
  children,
}: AppHeaderContextValue & { children: ReactNode }) {
  return (
    <AppHeaderContext.Provider value={{ shopName, isFounder }}>
      {children}
    </AppHeaderContext.Provider>
  )
}

export function useAppHeader(): AppHeaderContextValue {
  return useContext(AppHeaderContext)
}
