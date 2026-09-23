import { ArrowUpRight } from 'lucide-react'
import type { WalletAnalytics } from '../lib/metrics'
import { formatCurrency } from '../lib/format'
import type { Currency } from '../types'

interface Props {
  analytics: WalletAnalytics
  title?: string
  subtitle?: string
}

/**
 * Painel "Análise de carteira": clientes únicos, recorrência, ticket médio,
 * maior transação, cliente top.
 *
 * Estilo: extrato financeiro. Label uppercase pequena, valor grande mono-tabular,
 * sem ícones decorativos. Divisão por linhas verticais sutis.
 */
export function WalletPanel({ analytics: w, title, subtitle }: Props) {
  return (
    <section className="surface mt-4 overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-app-border px-4 py-3">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-muted">
          {title ?? 'Análise de carteira'}
        </h2>
        {subtitle && (
          <span className="text-[10px] uppercase tracking-[0.14em] text-app-subtle">
            {subtitle}
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 divide-y divide-app-border md:grid-cols-4 md:divide-x md:divide-y-0">
        <Tile
          label="Clientes únicos"
          value={String(w.uniqueClients)}
          hint={
            w.uniqueClients > 0
              ? `${w.verifiedClients} com registro verificado`
              : 'sem clientes no período'
          }
        />
        <Tile
          label="Recorrência"
          value={
            w.transactionsPerClient > 0 ? `${w.transactionsPerClient.toFixed(2)}×` : '-'
          }
          hint={
            w.recurringClients > 0
              ? `${w.recurringClients} cliente${w.recurringClients === 1 ? '' : 's'} com >1 registro`
              : 'todos com 1 registro'
          }
        />
        <Tile
          label="Ticket médio"
          value={lines(w.avgTicketByCurrency)}
          hint="média por registro verificado"
        />
        <Tile
          label="Maior volume"
          value={lines(w.maxTicketByCurrency)}
          hint="recorde de valor no período"
        />
      </div>

      {w.topClient && (
        <div className="flex items-center justify-between gap-3 border-t border-app-border bg-app-elev/40 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-subtle">
              Cliente mais valioso
            </span>
            <span className="truncate text-sm text-app-text">
              {w.topClient.clientName || `Conta ${w.topClient.clientId}`}
            </span>
            <span className="text-[10px] text-app-subtle">
              · conta {w.topClient.clientId} · {w.topClient.transactions} registro
              {w.topClient.transactions === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-medium tabular-nums text-app-text">
            <span>
              {formatCurrency(
                (w.topClient.totalByCurrency.USD || 0) +
                  (w.topClient.totalByCurrency.EUR || 0) +
                  (w.topClient.totalByCurrency.GBP || 0),
                'USD',
              )}
            </span>
            <ArrowUpRight size={11} className="text-app-subtle" />
          </div>
        </div>
      )}
    </section>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string | string[]
  hint?: string
}) {
  const linesArr = Array.isArray(value) ? value : [value]
  const empty = linesArr.length === 0 || (linesArr.length === 1 && linesArr[0] === '-')
  return (
    <div className="px-5 py-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-subtle">
        {label}
      </div>
      <div
        className={`mt-2 text-[18px] font-medium leading-tight tabular-nums tracking-[-0.015em] ${
          empty ? 'text-app-subtle' : 'text-app-text'
        }`}
      >
        {linesArr.map((l, i) => (
          <div key={i} className={i > 0 ? 'mt-0.5' : ''}>
            {l}
          </div>
        ))}
      </div>
      {hint && <div className="mt-2 text-[11px] leading-snug text-app-subtle">{hint}</div>}
    </div>
  )
}

function lines(amounts: Record<Currency, number>): string[] {
  // Sistema simplificado: soma face-value de todas as moedas legado.
  const sum = (amounts.USD || 0) + (amounts.EUR || 0) + (amounts.GBP || 0)
  return sum > 0 ? [formatCurrency(sum, 'USD')] : ['-']
}
