import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Visibilidade compartilhada dos "valores sensíveis" da Visão Geral,
 * comissão calculada, breakdowns e qualquer outra cifra que o usuário queira
 * esconder enquanto compartilha tela. Persistido em localStorage pra
 * sobreviver a reloads.
 *
 * Um único toggle controla a tela inteira (igual app de banco).
 */
interface BalanceVisibilityContextValue {
  hidden: boolean
  toggle: () => void
  setHidden: (next: boolean) => void
}

const Ctx = createContext<BalanceVisibilityContextValue | null>(null)

const STORAGE_KEY = 'balance:hidden'

export function BalanceVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0')
    } catch {
      // ignore: storage indisponível
    }
  }, [hidden])

  // Sincroniza entre múltiplas abas: se o usuário toggla numa, reflete na outra
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHiddenState(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => setHiddenState((h) => !h), [])
  const setHidden = useCallback((next: boolean) => setHiddenState(next), [])

  return (
    <Ctx.Provider value={{ hidden, toggle, setHidden }}>{children}</Ctx.Provider>
  )
}

/** Hook pra consumir/togglar a visibilidade. Lança se usado fora do provider. */
export function useBalanceVisibility(): BalanceVisibilityContextValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error(
      'useBalanceVisibility() precisa estar dentro de <BalanceVisibilityProvider>',
    )
  }
  return v
}
