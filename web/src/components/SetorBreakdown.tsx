import { CheckCircle2, Receipt, UserPlus } from 'lucide-react'
import { CurrencyTotals } from './CurrencyTotals'
import { SetorBadge } from './SetorBadge'
import type { SetorBreakdown as Row } from '../lib/metrics'

interface Props {
  rows: Row[]
}

export function SetorBreakdown({ rows }: Props) {
  const nonEmpty = rows.filter((r) => r.metrics.total > 0)
  if (nonEmpty.length === 0) {
    return (
      <div className="surface px-4 py-8 text-center text-xs text-app-subtle">
        Sem registros no período por setor.
      </div>
    )
  }

  return (
    <div className="surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-app-elev/40">
          <tr>
            <Th>Setor</Th>
            <Th className="text-right">
              <span className="inline-flex items-center gap-1">
                <Receipt size={10} /> Registros
              </span>
            </Th>
            <Th className="text-right">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={10} /> Verificados
              </span>
            </Th>
            <Th className="text-right">
              <span className="inline-flex items-center gap-1">
                <UserPlus size={10} strokeWidth={2} /> Ativações
              </span>
            </Th>
            <Th>Conversão</Th>
            <Th className="text-right">Valor registrado</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {nonEmpty.map((r) => {
            const rate = r.conversionRate
            const ratePct = (rate * 100).toFixed(0)
            return (
              <tr
                key={r.setor}
                className="transition-colors hover:bg-app-elev/40"
              >
                <Td>
                  {r.setor === 'sem_setor' ? (
                    <span className="font-medium text-app-text">{r.label}</span>
                  ) : (
                    <SetorBadge setor={r.setor} />
                  )}
                </Td>
                <Td className="text-right tabular-nums text-app-text">
                  {r.metrics.total}
                </Td>
                {/* Verificados/Ativações usam o critério ESTRITO
                    (validated = system verified + conversa approved), o
                    número que de fato vira comissão. Veja `bySetor` em
                    `lib/metrics.ts`. */}
                <Td className="text-right tabular-nums text-green-600 dark:text-green-400">
                  {r.metrics.validated}
                </Td>
                <Td className="text-right tabular-nums text-purple-600 dark:text-purple-400">
                  {r.metrics.validatedActivations}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-app-elev">
                      <div
                        className={`h-full rounded-full ${barColor(rate)}`}
                        style={{ width: `${Math.min(100, rate * 100)}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-[11px] tabular-nums text-app-muted">
                      {ratePct}%
                    </span>
                  </div>
                </Td>
                <Td className="text-right">
                  <CurrencyTotals totals={r.metrics.totalByCurrency} size="sm" />
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function barColor(rate: number): string {
  if (rate >= 0.8) return 'bg-green-500'
  if (rate >= 0.5) return 'bg-amber-500'
  if (rate > 0) return 'bg-red-500'
  return 'bg-app-border'
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`whitespace-nowrap px-3 py-3 align-middle text-app-text ${className ?? ''}`}>
      {children}
    </td>
  )
}
