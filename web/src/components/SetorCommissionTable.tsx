import { formatCurrency } from '../lib/format'
import type { SetorCommissionRow } from '../lib/commission'
import { HiddenDots } from './CommissionBalanceCard'

interface Props {
  rows: SetorCommissionRow[]
  /** Quando true, mostra linha de total agregando todos. */
  showTotal?: boolean
  /** Quando true, oculta TODOS os valores monetários de comissão (olhinho). */
  hidden?: boolean
}

export function SetorCommissionTable({
  rows,
  showTotal = true,
  hidden = false,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-app-subtle">
        Sem dados de comissão por setor no período.
      </div>
    )
  }

  const max = Math.max(...rows.map((r) => r.payableRawTotal), 1)
  const totals = rows.reduce(
    (acc, r) => {
      acc.fixedUsd += r.fixedUsd
      acc.payableRawTotal += r.payableRawTotal
      acc.activations += r.activations
      acc.validatedTransactions += r.validatedTransactions
      acc.agents += r.agentsCount
      acc.usd += r.percentageByCurrency.USD
      acc.eur += r.percentageByCurrency.EUR
      acc.gbp += r.percentageByCurrency.GBP
      return acc
    },
    {
      fixedUsd: 0,
      payableRawTotal: 0,
      activations: 0,
      validatedTransactions: 0,
      agents: 0,
      usd: 0,
      eur: 0,
      gbp: 0,
    },
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-app-elev/40 text-[10px] uppercase tracking-[0.14em] text-app-subtle">
          <tr>
            <Th className="text-left">Setor</Th>
            <Th className="text-right">Gestores</Th>
            <Th className="text-right">Validados</Th>
            <Th className="text-right">Ativ.</Th>
            <Th className="text-right">Bônus US$</Th>
            <Th className="text-right">1% sobre dep.</Th>
            <Th>Participação</Th>
            <Th className="text-right">Total bruto</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {rows.map((r) => (
            <tr key={r.setor} className="transition-colors hover:bg-app-elev/40">
              <Td>
                <span className="font-medium text-app-text">{r.label}</span>
              </Td>
              <Td className="text-right tabular-nums text-app-muted">
                {r.agentsCount}
              </Td>
              <Td className="text-right tabular-nums text-app-text">
                {r.validatedTransactions}
              </Td>
              <Td className="text-right tabular-nums text-app-text">
                {r.activations}
              </Td>
              <Td className="text-right tabular-nums text-app-text">
                {hidden ? (
                  <HiddenDots count={3} size="sm" />
                ) : (
                  formatCurrency(r.fixedUsd, 'USD')
                )}
              </Td>
              <Td className="text-right">
                {hidden ? (
                  <HiddenDots count={3} size="sm" />
                ) : (
                  <CurrencyStack amounts={r.percentageByCurrency} />
                )}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-24 overflow-hidden rounded-full bg-app-elev">
                    <div
                      className="h-full bg-app-text/80"
                      style={{
                        width: `${(r.payableRawTotal / max) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] tabular-nums text-app-muted">
                    {totals.payableRawTotal > 0
                      ? `${((r.payableRawTotal / totals.payableRawTotal) * 100).toFixed(0)}%`
                      : '-'}
                  </span>
                </div>
              </Td>
              <Td className="text-right text-[13px] font-medium tabular-nums text-app-text">
                {hidden ? (
                  <HiddenDots count={3} size="sm" />
                ) : (
                  formatCurrency(r.payableRawTotal, 'USD')
                )}
              </Td>
            </tr>
          ))}
        </tbody>
        {showTotal && (
          <tfoot>
            <tr className="border-t border-app-border bg-app-elev/60">
              <Td>
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-muted">
                  Total
                </span>
              </Td>
              <Td className="text-right tabular-nums text-app-muted">{totals.agents}</Td>
              <Td className="text-right tabular-nums text-app-text">
                {totals.validatedTransactions}
              </Td>
              <Td className="text-right tabular-nums text-app-text">
                {totals.activations}
              </Td>
              <Td className="text-right tabular-nums text-app-text">
                {hidden ? (
                  <HiddenDots count={3} size="sm" />
                ) : (
                  formatCurrency(totals.fixedUsd, 'USD')
                )}
              </Td>
              <Td className="text-right">
                {hidden ? (
                  <HiddenDots count={3} size="sm" />
                ) : (
                  <CurrencyStack
                    amounts={{ USD: totals.usd, EUR: totals.eur, GBP: totals.gbp }}
                  />
                )}
              </Td>
              <Td />
              <Td className="text-right text-[14px] font-medium tabular-nums text-app-text">
                {hidden ? (
                  <HiddenDots count={3} size="sm" />
                ) : (
                  formatCurrency(totals.payableRawTotal, 'USD')
                )}
              </Td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function CurrencyStack({
  amounts,
}: {
  amounts: { USD: number; EUR: number; GBP: number }
}) {
  // Sistema simplificado: soma face-value e exibe em $.
  const sum = (amounts.USD || 0) + (amounts.EUR || 0) + (amounts.GBP || 0)
  if (sum <= 0) return <span className="text-app-subtle">-</span>
  const lines = [formatCurrency(sum, 'USD')]
  return (
    <div className="text-right">
      {lines.map((l, i) => (
        <div key={i} className="text-[11px] tabular-nums text-app-text">
          {l}
        </div>
      ))}
    </div>
  )
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-[0.14em] ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td className={`whitespace-nowrap px-3 py-2.5 align-middle ${className ?? ''}`}>
      {children}
    </td>
  )
}
