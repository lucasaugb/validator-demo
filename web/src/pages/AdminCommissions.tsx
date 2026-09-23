import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Info,
  Search,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { MetricRibbon, type RibbonMetric } from '../components/MetricRibbon'
import {
  commissionByAgent,
  globalCommissionSummary,
  type AgentCommission,
  type CommissionStatus,
  type TransactionCommission,
} from '../lib/commission'
import {
  isInLastDays,
  isLastMonth,
  isThisMonth,
  pctChange,
} from '../lib/metrics'
import { formatCurrency, formatDateBR } from '../lib/format'
import { setorLabel } from '../types'
import type { Transaction } from '../types'
import { UsdAmountChip } from '../components/UsdAmountChip'
import { SetorBadge } from '../components/SetorBadge'

interface Props {
  transactions: Transaction[]
}

type Period = 'all' | 'month' | 'd30' | 'd7'

const PERIOD_LABEL: Record<Period, string> = {
  all: 'Tudo',
  month: 'Mês atual',
  d30: 'Últimos 30 dias',
  d7: 'Últimos 7 dias',
}

export function AdminCommissions({ transactions }: Props) {
  const [period, setPeriod] = useState<Period>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { current, previous, periodLabelLong } = useMemo(() => {
    if (period === 'all') {
      return {
        current: transactions,
        previous: [] as Transaction[],
        periodLabelLong: 'Histórico completo',
      }
    }
    if (period === 'month') {
      return {
        current: transactions.filter((d) => isThisMonth(d.transactionDate)),
        previous: transactions.filter((d) => isLastMonth(d.transactionDate)),
        periodLabelLong: monthLabel(),
      }
    }
    const days = period === 'd30' ? 30 : 7
    return {
      current: transactions.filter((d) => isInLastDays(d.transactionDate, days)),
      previous: transactions.filter(
        (d) =>
          isInLastDays(d.transactionDate, days * 2) &&
          !isInLastDays(d.transactionDate, days),
      ),
      periodLabelLong: `Últimos ${days} dias`,
    }
  }, [transactions, period])

  const byAgent = useMemo(() => commissionByAgent(current), [current])
  const byAgentPrev = useMemo(() => commissionByAgent(previous), [previous])
  const summary = useMemo(() => globalCommissionSummary(byAgent), [byAgent])
  const summaryPrev = useMemo(
    () => globalCommissionSummary(byAgentPrev),
    [byAgentPrev],
  )

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return byAgent
    return byAgent.filter(
      (a) =>
        a.agenteName.toLowerCase().includes(q) ||
        (a.setor && setorLabel[a.setor].toLowerCase().includes(q)),
    )
  }, [byAgent, query])

  const ribbon: RibbonMetric[] = [
    {
      label: 'A pagar (bruto)',
      value: compactUsd(summary.payableRawTotal),
      accent: 'green',
      delta: pctChange(summary.payableRawTotal, summaryPrev.payableRawTotal),
      detail: 'soma sem câmbio · USD/EUR/GBP',
    },
    {
      label: 'Bônus de ativação',
      value: formatCurrency(summary.fixedUsdTotal, 'USD'),
      accent: 'purple',
      delta: pctChange(summary.fixedUsdTotal, summaryPrev.fixedUsdTotal),
      detail: `${summary.activations} ativ. · $5 cada`,
    },
    {
      label: '% sobre volume',
      value: compactRawCurrency(summary.percentageByCurrency),
      accent: 'blue',
      detail: '1% × validados elegíveis',
    },
    {
      label: 'Aguardando operação',
      value: String(summary.activationsPendingOperation),
      accent: summary.activationsPendingOperation > 0 ? 'amber' : 'none',
      detail:
        summary.activationsPendingOperation > 0
          ? `${compactRawCurrency(summary.pendingByCurrency)} represado`
          : 'sem represamento',
    },
    {
      label: 'Não elegíveis',
      value: String(summary.activationsNotEligible),
      accent: 'red',
      detail:
        summary.activationsNotEligible > 0
          ? `${compactRawCurrency(summary.notEligibleByCurrency)} perdido`
          : 'sem perda',
    },
    {
      label: 'Gestores ativos',
      value: String(summary.agentsWithCommission),
      detail: `de ${countAgents(current)} com registros`,
    },
  ]

  return (
    <>
      <PageHeader
        title="Comissionamento"
        subtitle={`Apuração · ${periodLabelLong}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodToggle value={period} onChange={setPeriod} />
          </div>
        }
      />

      <MetricRibbon metrics={ribbon} />

      <div className="surface mt-4 px-4 py-3">
        <div className="flex items-start gap-3">
          <Info size={14} className="mt-0.5 shrink-0 text-app-muted" />
          <div className="text-[12px] leading-relaxed text-app-muted">
            <span className="font-medium text-app-text">Regras: </span>
            <strong>1% sobre o valor</strong> de cada registro validado +{' '}
            <strong>US$ 5</strong> por ativação validada. Em ativações, o 1%{' '}
            <strong>só é elegível</strong> quando o cliente realiza uma operação
            em <strong>data posterior</strong> ao registro (`last_operation_date`
            no sistema de origem). Registros comuns não têm essa restrição.
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mt-4 mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle"
          />
          <input
            type="text"
            placeholder="Buscar por agente ou setor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-app-border bg-app-input py-2 pl-9 pr-3 text-sm text-app-text outline-none transition-colors focus:border-app-border-strong"
          />
        </div>
      </div>

      <section className="surface overflow-hidden">
        <header className="flex items-center gap-2 border-b border-app-border px-4 py-3">
          <DollarSign size={11} className="text-app-muted" />
          <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-muted">
            Comissão por agente · {PERIOD_LABEL[period].toLowerCase()}
          </h2>
          <span className="rounded bg-app-elev px-1.5 py-0.5 text-[10px] tabular-nums text-app-muted">
            {filteredAgents.length}
          </span>
        </header>

        {filteredAgents.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-app-subtle">
            Nenhum agente com comissão {query ? 'pra essa busca' : 'no período'}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-app-elev/40 text-[10px] uppercase tracking-[0.1em] text-app-subtle">
                <tr>
                  <Th className="w-8" />
                  <Th className="text-left">Gestor · setor</Th>
                  <Th className="text-right">Validados</Th>
                  <Th className="text-right">Ativações</Th>
                  <Th className="text-right">$5 × ativ.</Th>
                  <Th className="text-right">1% sobre valor</Th>
                  <Th className="text-right">Aguardando</Th>
                  <Th className="text-right">Total a pagar</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60">
                {filteredAgents.map((a) => {
                  const isOpen = expanded === a.agenteId
                  return (
                    <>
                      <tr
                        key={a.agenteId}
                        className="cursor-pointer transition-colors hover:bg-app-elev/40"
                        onClick={() => setExpanded(isOpen ? null : a.agenteId)}
                      >
                        <Td className="text-app-subtle">
                          {isOpen ? (
                            <ChevronDown size={13} />
                          ) : (
                            <ChevronRight size={13} />
                          )}
                        </Td>
                        <Td>
                          <div className="font-medium text-app-text">
                            {a.agenteName}
                          </div>
                          {a.setor && (
                            <div className="mt-0.5">
                              <SetorBadge setor={a.setor} size="xs" />
                            </div>
                          )}
                        </Td>
                        <Td className="text-right tabular-nums text-app-text">
                          {a.validatedTransactions}
                        </Td>
                        <Td className="text-right tabular-nums">
                          <div className="text-app-text">{a.activations}</div>
                          <div className="text-[10px] text-app-subtle">
                            {a.activationsPendingOperation > 0 && (
                              <span title="aguardando operação">
                                ⏳ {a.activationsPendingOperation}
                              </span>
                            )}
                            {a.activationsNotEligible > 0 && (
                              <span
                                className="ml-1 text-red-500/80"
                                title="não elegíveis"
                              >
                                ✕ {a.activationsNotEligible}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td className="text-right tabular-nums">
                          <span className="font-medium text-app-text">
                            {formatCurrency(a.fixedUsd, 'USD')}
                          </span>
                        </Td>
                        <Td className="text-right tabular-nums">
                          <CurrencyStack amounts={a.percentageByCurrency} />
                        </Td>
                        <Td className="text-right tabular-nums">
                          {sumAmounts(a.pendingByCurrency) === 0 ? (
                            <span className="text-app-subtle">-</span>
                          ) : (
                            <CurrencyStack
                              amounts={a.pendingByCurrency}
                              tone="amber"
                            />
                          )}
                        </Td>
                        <Td className="text-right">
                          <div className="text-sm font-semibold tabular-nums text-app-text">
                            {compactUsd(a.payableRawTotal)}
                          </div>
                          <div className="text-[10px] text-app-subtle">
                            soma bruta s/ câmbio
                          </div>
                        </Td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td
                            colSpan={8}
                            className="bg-app-elev/30 px-0 py-0"
                          >
                            <AgentDrillIn agent={a} />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-app-border bg-app-elev/40">
                  <td className="px-3 py-2.5" colSpan={4}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-app-muted">
                      Totais
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="text-sm font-semibold text-app-text">
                      {formatCurrency(summary.fixedUsdTotal, 'USD')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <CurrencyStack
                      amounts={summary.percentageByCurrency}
                      bold
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {sumAmounts(summary.pendingByCurrency) === 0 ? (
                      <span className="text-app-subtle">-</span>
                    ) : (
                      <CurrencyStack
                        amounts={summary.pendingByCurrency}
                        tone="amber"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="text-base font-semibold tabular-nums text-app-text">
                      {compactUsd(summary.payableRawTotal)}
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function AgentDrillIn({ agent }: { agent: AgentCommission }) {
  if (agent.rows.length === 0) return null
  return (
    <div className="px-4 py-3">
      <div className="overflow-hidden rounded-md border border-app-border bg-app-card">
        <table className="w-full text-[11px]">
          <thead className="bg-app-elev/60 text-[9px] uppercase tracking-[0.1em] text-app-subtle">
            <tr>
              <Th className="w-12 text-left">#</Th>
              <Th className="w-24 text-left">Data dep.</Th>
              <Th className="text-left">Cliente</Th>
              <Th className="text-right">Valor</Th>
              <Th className="text-left">Tipo</Th>
              <Th className="w-24 text-left">Last op.</Th>
              <Th className="text-left">Status</Th>
              <Th className="text-right">Comissão</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/60">
            {agent.rows.map(({ transaction: d, commission: c }) => (
              <tr key={d.id} className="transition-colors hover:bg-app-elev/30">
                <Td className="font-mono tabular-nums text-app-text">
                  #{d.transactionNumber ?? '-'}
                </Td>
                <Td className="tabular-nums text-app-muted">
                  {formatDateBR(d.transactionDate)}
                </Td>
                <Td>
                  <div className="max-w-[180px] truncate text-app-text">
                    {d.clientName}
                  </div>
                  <div className="font-mono text-[9px] text-app-subtle">
                    conta {d.clientId}
                  </div>
                </Td>
                <Td className="text-right tabular-nums text-app-text">
                  {formatCurrency(d.amount, d.currency)}
                  <UsdAmountChip transaction={d} />
                </Td>
                <Td>
                  {d.isActivation ? (
                    <span className="inline-flex items-center gap-1 rounded border border-app-border bg-app-elev px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-app-text">
                      <UserPlus size={9} strokeWidth={2} className="text-app-muted" /> ativação
                    </span>
                  ) : (
                    <span className="text-[10px] text-app-muted">comum</span>
                  )}
                </Td>
                <Td className="tabular-nums text-app-muted">
                  {d.lastOperationDate === undefined ? (
                    <span className="text-app-subtle">-</span>
                  ) : d.lastOperationDate === null ? (
                    <span className="text-red-500/80">nunca</span>
                  ) : (
                    <span>{formatDateBR(String(d.lastOperationDate).slice(0, 10))}</span>
                  )}
                </Td>
                <Td>
                  <StatusBadge status={c.status} reason={c.reason} />
                </Td>
                <Td className="text-right tabular-nums">
                  <CommissionAmount c={c} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CommissionAmount({ c }: { c: TransactionCommission }) {
  if (c.status === 'not_validated') {
    return <span className="text-app-subtle">-</span>
  }
  const lines: { value: string; tone: 'normal' | 'muted' | 'dim' }[] = []
  if (c.fixedUsd > 0) {
    lines.push({
      value: `+${formatCurrency(c.fixedUsd, 'USD')} fixo`,
      tone: 'normal',
    })
  }
  if (c.status === 'eligible' && c.percentage > 0) {
    lines.push({
      value: `+${formatCurrency(c.percentage, c.currency)} (1%)`,
      tone: 'normal',
    })
  } else if (c.status === 'pending_operation' && c.percentage === 0) {
    lines.push({
      value: 'aguardando 1%',
      tone: 'muted',
    })
  } else if (c.status === 'not_eligible') {
    lines.push({
      value: '1% perdido',
      tone: 'dim',
    })
  }
  if (lines.length === 0) lines.push({ value: '-', tone: 'dim' })
  return (
    <div>
      {lines.map((l, i) => (
        <div
          key={i}
          className={`text-[11px] ${
            l.tone === 'normal'
              ? 'font-medium text-app-text'
              : l.tone === 'muted'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-app-subtle line-through'
          }`}
        >
          {l.value}
        </div>
      ))}
    </div>
  )
}

function StatusBadge({
  status,
  reason,
}: {
  status: CommissionStatus
  reason: string
}) {
  const map: Record<
    CommissionStatus,
    { cls: string; icon: React.ReactNode; label: string }
  > = {
    eligible: {
      cls: 'bg-green-500/10 text-green-600 dark:text-green-400',
      icon: <CheckCircle2 size={9} />,
      label: 'Elegível',
    },
    pending_operation: {
      cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      icon: <Clock size={9} />,
      label: 'Aguardando op.',
    },
    not_eligible: {
      cls: 'bg-red-500/10 text-red-600 dark:text-red-400',
      icon: <XCircle size={9} />,
      label: 'Sem operação',
    },
    not_validated: {
      cls: 'bg-app-elev text-app-muted',
      icon: <Clock size={9} />,
      label: 'Não validado',
    },
  }
  const s = map[status]
  return (
    <div className="flex flex-col">
      <span
        className={`inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}
      >
        {s.icon} {s.label}
      </span>
      <span className="mt-0.5 truncate text-[10px] text-app-subtle">
        {reason}
      </span>
    </div>
  )
}

function CurrencyStack({
  amounts,
  bold,
  tone,
}: {
  amounts: { USD: number; EUR: number; GBP: number }
  bold?: boolean
  tone?: 'amber'
}) {
  const cls = `${bold ? 'font-semibold' : 'font-medium'} ${
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-app-text'
  }`
  // Sistema simplificado: soma face-value e exibe em $.
  const sum = (amounts.USD || 0) + (amounts.EUR || 0) + (amounts.GBP || 0)
  if (sum <= 0) return <span className="text-app-subtle">-</span>
  return (
    <div className={`text-[11px] tabular-nums ${cls}`}>
      {formatCurrency(sum, 'USD')}
    </div>
  )
}

function PeriodToggle({
  value,
  onChange,
}: {
  value: Period
  onChange: (v: Period) => void
}) {
  const opts: { v: Period; label: string }[] = [
    { v: 'month', label: 'Mês' },
    { v: 'd30', label: '30d' },
    { v: 'd7', label: '7d' },
    { v: 'all', label: 'Tudo' },
  ]
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-app-border bg-app-card p-0.5"
      role="tablist"
    >
      {opts.map((o) => (
        <button
          key={o.v}
          role="tab"
          aria-selected={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors ${
            value === o.v
              ? 'bg-app-elev text-app-text shadow-[0_1px_0_0_var(--app-border)_inset]'
              : 'text-app-muted hover:text-app-text'
          }`}
        >
          {o.label}
        </button>
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
      className={`whitespace-nowrap px-3 py-2.5 font-semibold ${className ?? ''}`}
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
    <td className={`whitespace-nowrap px-3 py-2.5 align-top ${className ?? ''}`}>
      {children}
    </td>
  )
}

function sumAmounts(a: { USD: number; EUR: number; GBP: number }): number {
  return a.USD + a.EUR + a.GBP
}

function compactUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `$${(v / 1_000).toFixed(1)}k`
  return formatCurrency(v, 'USD')
}

function compactRawCurrency(amounts: {
  USD: number
  EUR: number
  GBP: number
}): string {
  // Sistema simplificado: soma face-value de todas as moedas legado.
  const sum = (amounts.USD || 0) + (amounts.EUR || 0) + (amounts.GBP || 0)
  return formatCurrency(sum, 'USD')
}

function countAgents(transactions: Transaction[]): number {
  const set = new Set<string>()
  for (const d of transactions) set.add(d.agenteId)
  return set.size
}

function monthLabel(): string {
  const now = new Date()
  return now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
