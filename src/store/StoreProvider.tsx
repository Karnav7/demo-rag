import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { store as singleton, type AppStore, type StoreState } from './store'

/** Defaults to the app singleton; tests wrap components in <StoreProvider store={createStore(...)}>. */
const StoreContext = createContext<AppStore>(singleton)

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

/** Components read state through this hook (not the singleton `useStore`) so they are testable. */
export function useAppStore(): StoreState {
  const s = useContext(StoreContext)
  return useSyncExternalStore(s.subscribe, s.getState, s.getState)
}
