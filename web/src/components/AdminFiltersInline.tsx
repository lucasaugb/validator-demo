import {
  useAdminFilters,
  useAgenteOptions,
  useSupervisorSetores,
} from '../contexts/AdminFiltersContext'
import { setorLabel } from '../types'

/**
 * Controles compactos pra encaixar inline nos toolbars/actions das telas
 * admin. Não traz wrapper visual: é só o segmento Premium/Starter (quando
 * aplicável) seguido do dropdown de gestor. Use junto com os filtros
 * existentes (mês, período, etc.) sem mudar o layout deles.
 *
 * Esconde tudo automaticamente se não há gestores na lista, pra não poluir
 * tela vazia.
 */
export function AdminFiltersInline({
  className,
}: {
  className?: string
}) {
  const { agenteFilter, setAgenteFilter, setorScopeFilter, setSetorScopeFilter } =
    useAdminFilters()
  const agentes = useAgenteOptions()
  const supervisorSetores = useSupervisorSetores()

  // Sem nada pra filtrar e sem segmento premium/starter: não renderiza.
  if (agentes.length === 0 && supervisorSetores.length === 0) return null

  return (
    <div className={`inline-flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      {supervisorSetores.length > 0 && (
        <div className="seg" role="tablist" title="Filtrar por setor">
          <button
            type="button"
            role="tab"
            aria-selected={setorScopeFilter === null}
            onClick={() => setSetorScopeFilter(null)}
            className="seg-item"
          >
            Ambos
          </button>
          {supervisorSetores.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={setorScopeFilter === s}
              onClick={() => setSetorScopeFilter(s)}
              className="seg-item"
            >
              {setorLabel[s]}
            </button>
          ))}
        </div>
      )}
      {agentes.length > 0 && (
        // Cap em 160px pra o select não bloar e empurrar o título da página
        // pra "...". Nomes mais longos ficam visíveis ao abrir o dropdown.
        <select
          value={agenteFilter ?? ''}
          onChange={(e) => setAgenteFilter(e.target.value || null)}
          title="Filtrar por gestor"
          className="max-w-[160px] truncate rounded-md border border-app-border bg-app-card px-2 py-1 text-[12px] text-app-text outline-none transition-colors focus:border-app-border-strong"
        >
          <option value="">Todos os gestores</option>
          {agentes.map((a) => (
            <option key={a.uid} value={a.uid}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
