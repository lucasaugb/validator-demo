import { AlertOctagon, ArrowRight, Copy } from 'lucide-react'
import { formatCurrency, formatDateBR } from '../lib/format'
import type { InvalidLogEntry } from '../lib/metrics'
import { SetorBadge } from './SetorBadge'
import { UsdAmountChip } from './UsdAmountChip'

interface Props {
  entries: InvalidLogEntry[]
  onOpen?: (transactionId: string) => void
  onSeeAll?: () => void
  title?: string
  emptyHint?: string
}

/**
 * Log denso de transações inválidas / duplicados com motivo inline. Pensado pra
 * o admin diagnosticar de relance sem precisar abrir o modal. Cada linha é
 * clicável (abre o modal de detalhes).
 */
export function InvalidLog({
  entries,
  onOpen,
  onSeeAll,
  title = 'Log de inválidos · diagnóstico',
  emptyHint = 'Nenhum registro inválido recente. Operação limpa.',
}: Props) {
  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertOctagon size={11} className="text-app-muted" />
          <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-muted">
            {title}
          </h2>
          <span className="rounded bg-app-elev px-1.5 py-0.5 text-[10px] tabular-nums text-app-muted">
            {entries.length}
          </span>
        </div>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-app-muted transition-colors hover:text-app-text"
          >
            ver todos
            <ArrowRight size={11} />
          </button>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-app-subtle">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-app-elev/40 text-[10px] uppercase tracking-[0.1em] text-app-subtle">
              <tr>
                <Th className="w-14 text-left">#</Th>
                <Th className="w-24 text-left">Data</Th>
                <Th className="text-left">Cliente</Th>
                <Th className="text-left">Gestor · setor</Th>
                <Th className="text-right">Valor</Th>
                <Th className="text-left">Motivo</Th>
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border/60">
              {entries.map(({ transaction: d, reason }) => {
                const isDup =
                  reason.code === 'duplicate_cross' || reason.code === 'duplicate_same'
                return (
                  <tr
                    key={d.id}
                    onClick={() => onOpen?.(d.id)}
                    className="group cursor-pointer transition-colors hover:bg-app-elev/50"
                  >
                    <Td className="font-mono tabular-nums text-app-text">
                      #{d.transactionNumber ?? '-'}
                    </Td>
                    <Td className="tabular-nums text-app-muted">
                      {formatDateBR(d.transactionDate)}
                    </Td>
                    <Td>
                      <div className="max-w-[200px] truncate text-app-text">
                        {d.clientName}
                      </div>
                      <div className="font-mono text-[10px] text-app-subtle">
                        conta {d.clientId}
                      </div>
                    </Td>
                    <Td>
                      <div className="max-w-[180px] truncate text-app-text">
                        {d.agenteName}
                      </div>
                      {d.agenteSetor && (
                        <div className="mt-0.5">
                          <SetorBadge setor={d.agenteSetor} size="xs" />
                        </div>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      <div className="font-medium text-app-text">
                        {formatCurrency(d.amount, d.currency)}
                        <UsdAmountChip transaction={d} />
                      </div>
                      <div className="text-[10px] text-app-subtle">{d.currency}</div>
                    </Td>
                    <Td>
                      <ReasonBadge reason={reason} isDup={isDup} />
                    </Td>
                    <Td className="text-right">
                      <ArrowRight
                        size={12}
                        className="text-app-subtle opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ReasonBadge({
  reason,
  isDup,
}: {
  reason: InvalidLogEntry['reason']
  isDup: boolean
}) {
  const dotCls = isDup ? 'bg-orange-500' : 'bg-red-500'
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5">
        {isDup ? (
          <Copy size={11} className="text-orange-500" />
        ) : (
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotCls}`} />
        )}
        <span className="font-medium text-app-text">{reason.short}</span>
      </div>
      {reason.detail && (
        <span className="mt-0.5 truncate pl-4 text-[10px] text-app-subtle">
          {reason.detail}
        </span>
      )}
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
      className={`whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <td className={`whitespace-nowrap px-3 py-2.5 align-top ${className ?? ''}`}>
      {children}
    </td>
  )
}
