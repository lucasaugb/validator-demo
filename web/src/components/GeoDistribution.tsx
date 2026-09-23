import { Globe2 } from 'lucide-react'
import type { CountryDistribution } from '../lib/metrics'

interface Props {
  countries: CountryDistribution[]
  /** Limita a quantos países mostrar (top N). Default 6. */
  limit?: number
  /** Métrica usada na barra: clientes únicos (default) ou transações. */
  metric?: 'clients' | 'transactions'
  /** Rótulo abaixo do total (default: "clientes únicos"). */
  totalLabel?: string
}

/**
 * Distribuição geográfica baseada no DDI do telefone. Mostra "top X" países
 * com bandeira, barra horizontal proporcional e contagem. Total agregado
 * no canto superior direito.
 */
export function GeoDistribution({
  countries,
  limit = 6,
  metric = 'clients',
  totalLabel,
}: Props) {
  const totalClients = countries.reduce((s, c) => s + c.clients, 0)
  const totalTransactions = countries.reduce((s, c) => s + c.transactions, 0)
  const total = metric === 'clients' ? totalClients : totalTransactions
  const top = countries.slice(0, limit)
  const max = Math.max(
    ...top.map((c) => (metric === 'clients' ? c.clients : c.transactions)),
    1,
  )
  const others = countries.slice(limit)
  const othersCount = others.reduce(
    (s, c) => s + (metric === 'clients' ? c.clients : c.transactions),
    0,
  )

  if (countries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Globe2 size={28} className="text-app-subtle" strokeWidth={1.5} />
        <p className="mt-3 text-xs text-app-subtle">
          Sem dado geográfico no período.
        </p>
        <p className="mt-1 text-[10px] text-app-subtle">
          País vem do sistema de origem (DDI do telefone como fallback).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[22px] font-semibold leading-none tabular-nums tracking-tight text-app-text">
            {total}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-app-subtle">
            {totalLabel ?? (metric === 'clients' ? 'clientes únicos' : 'registros')}
          </div>
        </div>
        <div className="text-right text-[10px] text-app-subtle">
          {countries.length} {countries.length === 1 ? 'país' : 'países'}
        </div>
      </div>

      <ul className="space-y-2">
        {top.map((c) => {
          const v = metric === 'clients' ? c.clients : c.transactions
          const pct = total > 0 ? (v / total) * 100 : 0
          return (
            <li key={c.code} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-base leading-none">{c.flag}</span>
                  <span className="min-w-0 truncate text-app-text">{c.name}</span>
                </div>
                <div className="flex items-baseline gap-2 tabular-nums">
                  <span className="font-medium text-app-text">{v}</span>
                  <span className="text-[10px] text-app-subtle">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-app-elev">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(v / max) * 100}%`,
                    background: 'var(--app-accent)',
                    opacity: 0.85,
                  }}
                />
              </div>
            </li>
          )
        })}
        {othersCount > 0 && (
          <li className="flex items-center justify-between gap-2 text-[11px] text-app-subtle">
            <span>Outros ({others.length} país{others.length === 1 ? '' : 'es'})</span>
            <span className="tabular-nums">{othersCount}</span>
          </li>
        )}
      </ul>
    </div>
  )
}
