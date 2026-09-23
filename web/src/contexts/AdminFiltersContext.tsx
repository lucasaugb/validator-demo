import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Agente, Transaction, Setor } from '../types'
import { setoresInScope } from '../types'

interface AdminFiltersValue {
  /** Lista RAW de transações visíveis pro user (já filtrada por setor do supervisor pelo subscribe). */
  allTransactions: Transaction[]
  /** Agente logado: pra decidir se mostra o segmento premium/starter. */
  agente: Agente | null | undefined
  /** Gestor selecionado (agenteId) ou null pra "todos". */
  agenteFilter: string | null
  setAgenteFilter: (next: string | null) => void
  /** Setor selecionado pelo supervisor premium_starter, ou null pra "ambos". */
  setorScopeFilter: Setor | null
  setSetorScopeFilter: (next: Setor | null) => void
}

const Ctx = createContext<AdminFiltersValue | null>(null)

interface ProviderProps extends AdminFiltersValue {
  children: ReactNode
}

export function AdminFiltersProvider({ children, ...value }: ProviderProps) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminFilters(): AdminFiltersValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error('useAdminFilters fora do AdminFiltersProvider')
  }
  return v
}

/**
 * Pra usar inline nos toolbars das telas. Devolve a lista de gestores únicos
 * derivada das transações visíveis (filtrados pelo setor scope, se houver).
 */
export function useAgenteOptions(): { uid: string; name: string; setor?: Setor }[] {
  const { allTransactions, setorScopeFilter } = useAdminFilters()
  return useMemo(() => {
    const map = new Map<string, { uid: string; name: string; setor?: Setor }>()
    for (const d of allTransactions) {
      if (!d.agenteId) continue
      if (setorScopeFilter && d.agenteSetor !== setorScopeFilter) continue
      if (!map.has(d.agenteId)) {
        map.set(d.agenteId, { uid: d.agenteId, name: d.agenteName, setor: d.agenteSetor })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [allTransactions, setorScopeFilter])
}

/**
 * Quando true, deve renderizar o segmento Premium/Starter/Ambos, só pro
 * supervisor virtual `premium_starter` (cobre os dois setores).
 */
export function useSupervisorSetores(): Setor[] {
  const { agente } = useAdminFilters()
  return useMemo(() => {
    if (agente?.role !== 'supervisor' || !agente.setor) return []
    const s = setoresInScope(agente.setor)
    return s.length > 1 ? s : []
  }, [agente?.role, agente?.setor])
}
