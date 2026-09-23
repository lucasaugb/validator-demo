import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Hourglass,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { AdminFiltersInline } from '../components/AdminFiltersInline'
import {
  pendingCommissionRows,
  type PendingCommissionRow,
} from '../lib/commission'
import { setCommissionSettled } from '../lib/transactions'
import { formatCurrency, formatDateBR, formatMoney } from '../lib/format'
import { setorLabel, setoresInScope } from '../types'
import type { Transaction, Setor } from '../types'
import { UsdAmountChip } from '../components/UsdAmountChip'
import { SetorBadge } from '../components/SetorBadge'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  transactions: Transaction[]
  /**
   * Quando true, esconde colunas de agente/setor, usado na visão do gestor,
   * que só vê os próprios transações.
   */
  agenteScoped?: boolean
}

type StatusFilter = 'all' | 'awaiting' | 'paid' | 'lost'
type SettledFilter = 'all' | 'done' | 'todo'

const MONTH_LABELS_LONG = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

/**
 * Tela "Comissões Pendentes": lista ativações validadas com a situação do
 * 1% após ativação. Regra: $5 paga no mês da transação; 1% paga no mês da
 * primeira operação posterior. Mantém registros já pagos pra rastrear o
 * histórico.
 *
 * Visual "sistema": stat-strip horizontal sem cards, panel denso, linhas
 * clicáveis (navegam pra /transacoes?transacao=<id>).
 */
export function CommissoesPendentes({ transactions, agenteScoped }: Props) {
  const navigate = useNavigate()
  const { agente } = useAuth()
  const isSupervisor = agente?.role === 'supervisor'
  const [status, setStatus] = useState<StatusFilter>('all')
  const [settledFilter, setSettledFilter] = useState<SettledFilter>('all')
  // Filtra pelo MÊS em que o 1% após operação cai (percentagePayoutMonth =
  // mês da 1ª operação). 'all' = sem filtro. Só registros 'paid' têm esse mês,
  // então selecionar um mês naturalmente restringe aos que serão pagos nele.
  const [payoutMonth, setPayoutMonth] = useState<string>('all')
  const [query, setQuery] = useState('')
  // Quem pode marcar/desmarcar "Concluído": admin/super e supervisor (a tela
  // só é montada pra esses papéis). Usa o nome pra trilha leve na linha.
  const settleByName = agente?.name
  // Filtro de setor: mesma regra de AdminEdits: admin/super veem todos;
  // supervisor premium_starter (escopo > 1 setor) também tem filtro; supervisor
  // de setor único já vê só o próprio; gestor (agenteScoped) nem chega aqui.
  const filterableSetores = useMemo<Setor[]>(() => {
    if (agenteScoped) return []
    if (isSupervisor) {
      const scope = agente?.setor ? setoresInScope(agente.setor) : []
      return scope.length > 1 ? scope : []
    }
    return ['premium', 'starter', 'eventos', 'online']
  }, [agenteScoped, isSupervisor, agente?.setor])
  const showSetorFilter = filterableSetores.length > 0
  const [setorFilter, setSetorFilter] = useState<Setor | 'all'>('all')

  const rows = useMemo(() => pendingCommissionRows(transactions), [transactions])

  // Meses (yyyy-MM) em que algum 1% após operação será/foi pago, alimenta o
  // dropdown "Mês pagamento operação", mais recente primeiro.
  const payoutMonths = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      if (r.status === 'paid' && r.percentagePayoutMonth) {
        set.add(r.percentagePayoutMonth)
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Suporta busca por "#42" ou "42" pelo transactionNumber, igual AdminTransactions.
    const qNumber = q.replace(/^#/, '')
    const qIsNumeric = /^\d+$/.test(qNumber)
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false
      if (setorFilter !== 'all' && r.transaction.agenteSetor !== setorFilter) return false
      const isSettled = !!r.transaction.commissionSettledAt
      if (settledFilter === 'done' && !isSettled) return false
      if (settledFilter === 'todo' && isSettled) return false
      // Mês de pagamento do 1% após operação, só registros 'paid' têm
      // percentagePayoutMonth, então isso restringe naturalmente aos pagáveis.
      if (payoutMonth !== 'all' && r.percentagePayoutMonth !== payoutMonth) {
        return false
      }
      if (!q) return true
      const d = r.transaction
      if (qIsNumeric && d.transactionNumber === Number(qNumber)) return true
      return (
        d.clientName.toLowerCase().includes(q) ||
        d.clientId.toLowerCase().includes(q) ||
        d.agenteName.toLowerCase().includes(q) ||
        (d.agenteSetor && setorLabel[d.agenteSetor].toLowerCase().includes(q))
      )
    })
  }, [rows, status, query, setorFilter, settledFilter, payoutMonth])

  const counts = useMemo(() => {
    let awaiting = 0
    let paid = 0
    let lost = 0
    let awaitingUsd = 0
    let paidUsd = 0
    let lostUsd = 0
    let settledDone = 0
    let settledTodo = 0
    for (const r of rows) {
      if (r.status === 'awaiting') {
        awaiting += 1
        awaitingUsd += r.pctEstimateUsd
      } else if (r.status === 'paid') {
        paid += 1
        paidUsd += r.pctEstimateUsd
      } else {
        lost += 1
        lostUsd += r.pctEstimateUsd
      }
      if (r.transaction.commissionSettledAt) settledDone += 1
      else settledTodo += 1
    }
    return {
      awaiting,
      paid,
      lost,
      awaitingUsd,
      paidUsd,
      lostUsd,
      settledDone,
      settledTodo,
    }
  }, [rows])

  const openTransaction = (d: Transaction) => {
    const base = agenteScoped ? '/agente/transacoes' : '/admin/transacoes'
    navigate(`${base}?transacao=${encodeURIComponent(d.id)}`)
  }

  const toggleSettled = async (d: Transaction) => {
    try {
      await setCommissionSettled(d, !d.commissionSettledAt, settleByName)
    } catch (err) {
      console.error('falha ao marcar pagamento concluído:', err)
      alert('Não foi possível atualizar o status de pagamento. Tente de novo.')
    }
  }

  return (
    <>
      <PageHeader
        title="Comissões Pendentes"
        subtitle="Acompanhamento do 1% após ativação, pago no mês da primeira operação do cliente"
      />

      {/* Stat strip: estilo sistema, sem cards individuais */}
      <div className="stat-strip">
        <StatCell
          label="Aguardando 1ª op."
          value={String(counts.awaiting)}
          detail={
            counts.awaiting > 0
              ? `${formatMoney(counts.awaitingUsd)} de 1% represado`
              : 'sem represamento'
          }
          tone={counts.awaiting > 0 ? 'amber' : undefined}
          onClick={() => setStatus(status === 'awaiting' ? 'all' : 'awaiting')}
        />
        <StatCell
          label="1% a pagar"
          value={String(counts.paid)}
          detail={`${formatMoney(counts.paidUsd)} a creditar`}
          tone="emerald"
          onClick={() => setStatus(status === 'paid' ? 'all' : 'paid')}
        />
        <StatCell
          label="1% não elegível"
          value={String(counts.lost)}
          detail={
            counts.lost > 0
              ? `${formatMoney(counts.lostUsd)} perdido`
              : 'sem perda'
          }
          tone={counts.lost > 0 ? 'rose' : undefined}
          onClick={() => setStatus(status === 'lost' ? 'all' : 'lost')}
        />
        <StatCell
          label="Total ativações"
          value={String(rows.length)}
          detail="validadas no histórico"
        />
      </div>

      {/* Regra: bloco denso, panel */}
      <div className="panel mt-3 overflow-hidden">
        <div className="px-4 py-2.5 text-[11px] leading-relaxed text-app-muted">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-app-text">
            Regra ·
          </span>{' '}
          Bônus fixo <strong className="text-app-text">US$ 5</strong> cai no mês
          do registro. O{' '}
          <strong className="text-app-text">1%</strong> só é creditado quando o
          cliente faz a primeira operação no sistema de origem, e cai{' '}
          <strong className="text-app-text">no mês dessa operação</strong>.
          Sem operação, o 1% fica represado até a confirmação da source.
        </div>
      </div>

      {/* Toolbar: busca + filtro segmentado */}
      <div className="mt-3 mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-64 flex-1">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-subtle"
          />
          <input
            type="text"
            placeholder={
              agenteScoped
                ? 'Buscar por #, cliente ou conta'
                : 'Buscar por #, cliente, conta, agente ou setor'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-app-border bg-app-input py-1.5 pl-8 pr-2 text-[12px] text-app-text outline-none transition-colors focus:border-app-border-strong"
          />
        </div>
        <StatusToggle value={status} onChange={setStatus} counts={counts} />
        <SettledToggle
          value={settledFilter}
          onChange={setSettledFilter}
          counts={counts}
        />
        <PayoutMonthSelect
          value={payoutMonth}
          onChange={setPayoutMonth}
          months={payoutMonths}
        />
        {!agenteScoped && <AdminFiltersInline />}
      </div>

      {showSetorFilter && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            Setor
          </span>
          <button
            type="button"
            onClick={() => setSetorFilter('all')}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              setorFilter === 'all'
                ? 'border-app-border-strong bg-app-elev text-app-text'
                : 'border-app-border bg-app-card text-app-muted hover:bg-app-elev'
            }`}
          >
            Todos
          </button>
          {filterableSetores.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSetorFilter(s)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                setorFilter === s
                  ? 'border-app-border-strong bg-app-elev text-app-text'
                  : 'border-app-border bg-app-card text-app-muted hover:bg-app-elev'
              }`}
            >
              {setorLabel[s]}
            </button>
          ))}
        </div>
      )}

      {/* Lista: panel denso */}
      <section className="panel overflow-hidden">
        <header className="panel-head">
          <div className="flex items-center gap-2">
            <Hourglass size={11} className="text-app-muted" />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">
              Ativações · {labelForStatus(status)}
            </h2>
          </div>
          <span className="font-mono text-[10px] tabular-nums text-app-subtle">
            {filtered.length}
          </span>
        </header>

        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-app-subtle">
            {rows.length === 0
              ? 'Nenhuma ativação validada ainda.'
              : 'Nenhuma ativação pra este filtro.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="border-b border-app-border bg-app-elev/40 text-[9.5px] uppercase tracking-[0.12em] text-app-subtle">
                <tr>
                  <Th className="w-12 text-left">#</Th>
                  <Th className="text-left">Cliente</Th>
                  <Th className="w-32 text-left">ID cliente</Th>
                  {!agenteScoped && <Th className="text-left">Agente · Setor</Th>}
                  <Th className="w-24 text-left">Data dep.</Th>
                  <Th className="w-28 text-right">Valor</Th>
                  <Th className="w-28 text-left">Status do 1%</Th>
                  <Th className="text-left">Atribuição</Th>
                  <Th className="w-24 text-right">Valores</Th>
                  <Th className="w-32 text-center">Pagamento</Th>
                  <Th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60">
                {filtered.map((r) => (
                  <PendingRow
                    key={r.transaction.id}
                    row={r}
                    agenteScoped={!!agenteScoped}
                    onOpen={() => openTransaction(r.transaction)}
                    onToggleSettled={() => toggleSettled(r.transaction)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function PendingRow({
  row: r,
  agenteScoped,
  onOpen,
  onToggleSettled,
}: {
  row: PendingCommissionRow
  agenteScoped: boolean
  onOpen: () => void
  onToggleSettled: () => void
}) {
  const d = r.transaction
  const settled = !!d.commissionSettledAt
  return (
    <tr
      onClick={onOpen}
      title="Abrir transação"
      className={`cursor-pointer transition-colors hover:bg-app-elev/40 ${
        settled ? 'opacity-55 [&_td]:line-through' : ''
      }`}
    >
      <Td className="font-mono tabular-nums text-app-text">
        #{d.transactionNumber ?? '-'}
      </Td>
      <Td>
        <div className="max-w-[220px] truncate text-app-text">{d.clientName}</div>
        {d.clientEmail && (
          <div className="max-w-[220px] truncate text-[10px] text-app-subtle">
            {d.clientEmail}
          </div>
        )}
      </Td>
      <Td>
        <span
          className="rounded border border-app-border bg-app-elev px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-app-text"
          title="Conta do cliente"
        >
          {d.clientId || '-'}
        </span>
      </Td>
      {!agenteScoped && (
        <Td>
          <div className="text-app-text">{d.agenteName}</div>
          {d.agenteSetor && (
            <div className="mt-0.5">
              <SetorBadge setor={d.agenteSetor} size="xs" />
            </div>
          )}
        </Td>
      )}
      <Td className="font-mono tabular-nums text-app-muted">
        {formatDateBR(d.transactionDate)}
      </Td>
      <Td className="text-right font-mono tabular-nums text-app-text">
        {formatCurrency(d.amount, d.currency)}
        <UsdAmountChip transaction={d} />
      </Td>
      <Td>
        <StatusBadge status={r.status} />
      </Td>
      <Td>
        <AttributionLine row={r} />
      </Td>
      <Td className="text-right font-mono tabular-nums">
        <ValuesColumn row={r} />
      </Td>
      <Td className="text-center no-underline">
        <SettleButton
          settled={settled}
          eligible={r.status !== 'lost'}
          onToggle={onToggleSettled}
        />
      </Td>
      <Td className="text-right text-app-subtle">
        <ArrowUpRight size={11} />
      </Td>
    </tr>
  )
}

/**
 * Botão "Concluído": marca/desmarca que o 1% + ativação daquele registro já
 * foram pagos. Para a propagação do clique pra não abrir o registro. Quando
 * marcado, vira um chip verde "Pago" com hover pra desmarcar.
 *
 * Registros "Não elegíveis" (status `lost`) não podem ser concluídos: o 1%
 * nunca cai em mês nenhum, então o botão fica desabilitado (a não ser que o
 * registro já tenha sido marcado como pago antes, aí permite desfazer).
 */
function SettleButton({
  settled,
  eligible,
  onToggle,
}: {
  settled: boolean
  eligible: boolean
  onToggle: () => void
}) {
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }
  if (settled) {
    return (
      <button
        type="button"
        onClick={handle}
        title="Marcado como pago: clique para desfazer"
        className="group inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10.5px] font-medium text-emerald-600 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 dark:text-emerald-400 dark:hover:text-rose-400"
      >
        <Check size={11} className="group-hover:hidden" />
        <RotateCcw size={11} className="hidden group-hover:inline" />
        <span className="group-hover:hidden">Pago</span>
        <span className="hidden group-hover:inline">Desfazer</span>
      </button>
    )
  }
  if (!eligible) {
    return (
      <span
        title="Não elegível: o 1% não cai em mês nenhum, então não há o que concluir"
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-app-border/60 bg-app-elev/40 px-2 py-1 text-[10.5px] font-medium text-app-subtle"
      >
        <XCircle size={11} />
        Não elegível
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={handle}
      title="Marcar 1% + ativação como pagos"
      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10.5px] font-semibold text-emerald-700 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
    >
      <Check size={11} />
      Concluído
    </button>
  )
}

function AttributionLine({ row: r }: { row: PendingCommissionRow }) {
  const fixedTxt = r.fixedPayoutMonth
    ? `pagar em ${monthLabel(r.fixedPayoutMonth)}`
    : '-'
  let pctTxt: string
  let pctCls = 'text-app-text'
  if (r.status === 'paid' && r.percentagePayoutMonth) {
    pctTxt = `pagar em ${monthLabel(r.percentagePayoutMonth)}`
  } else if (r.status === 'awaiting') {
    pctTxt = 'aguardando operação'
    pctCls = 'text-amber-600 dark:text-amber-400'
  } else {
    pctTxt = 'não elegível'
    pctCls = 'text-rose-500/80'
  }
  return (
    <div className="text-[10.5px] leading-snug">
      <div>
        <span className="text-app-subtle">Valor fixo</span>{' '}
        <span className="text-app-text">{fixedTxt}</span>
      </div>
      <div>
        <span className="text-app-subtle">1% após ativação</span>{' '}
        <span className={pctCls}>{pctTxt}</span>
      </div>
    </div>
  )
}

function ValuesColumn({ row: r }: { row: PendingCommissionRow }) {
  return (
    <div className="text-[10.5px]">
      <div className="text-violet-700 dark:text-violet-300">+$5.00</div>
      <div
        className={
          r.status === 'paid'
            ? 'text-app-text'
            : r.status === 'awaiting'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-app-subtle line-through'
        }
      >
        {formatMoney(r.pctEstimateUsd)}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: PendingCommissionRow['status'] }) {
  const map: Record<
    PendingCommissionRow['status'],
    { cls: string; icon: React.ReactNode; label: string }
  > = {
    awaiting: {
      cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      icon: <Clock size={9} />,
      label: 'Aguardando',
    },
    paid: {
      cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      icon: <CheckCircle2 size={9} />,
      label: 'Pagar em',
    },
    lost: {
      cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      icon: <XCircle size={9} />,
      label: 'Não elegível',
    },
  }
  const s = map[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}
    >
      {s.icon} {s.label}
    </span>
  )
}

function StatCell({
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  label: string
  value: string
  detail?: string
  tone?: 'amber' | 'emerald' | 'rose'
  onClick?: () => void
}) {
  const valueCls =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'emerald'
        ? 'text-emerald-600 dark:text-emerald-400'
        : tone === 'rose'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-app-text'
  return (
    <div
      className={`stat-cell ${onClick ? 'is-clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-app-subtle">
        {label}
      </div>
      <div className={`mt-1 font-mono text-[18px] tabular-nums ${valueCls}`}>
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 text-[10px] leading-snug text-app-subtle">
          {detail}
        </div>
      )}
    </div>
  )
}

function StatusToggle({
  value,
  onChange,
  counts,
}: {
  value: StatusFilter
  onChange: (v: StatusFilter) => void
  counts: { awaiting: number; paid: number; lost: number }
}) {
  const opts: { v: StatusFilter; label: string; count?: number }[] = [
    { v: 'all', label: 'Todos' },
    { v: 'awaiting', label: 'Aguardando', count: counts.awaiting },
    { v: 'paid', label: 'A pagar', count: counts.paid },
    { v: 'lost', label: 'Não elegíveis', count: counts.lost },
  ]
  return (
    <div className="seg" role="tablist">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={value === o.v}
          onClick={() => onChange(o.v)}
          className="seg-item flex items-center gap-1.5"
        >
          <span>{o.label}</span>
          {o.count !== undefined && (
            <span className="rounded bg-app-elev px-1 py-px text-[9px] tabular-nums text-app-muted">
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function SettledToggle({
  value,
  onChange,
  counts,
}: {
  value: SettledFilter
  onChange: (v: SettledFilter) => void
  counts: { settledDone: number; settledTodo: number }
}) {
  const opts: { v: SettledFilter; label: string; count?: number }[] = [
    { v: 'all', label: 'Todos' },
    { v: 'todo', label: 'Não concluídos', count: counts.settledTodo },
    { v: 'done', label: 'Concluídos', count: counts.settledDone },
  ]
  return (
    <div className="seg" role="tablist" aria-label="Filtro de pagamento">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={value === o.v}
          onClick={() => onChange(o.v)}
          className="seg-item flex items-center gap-1.5"
        >
          <span>{o.label}</span>
          {o.count !== undefined && (
            <span className="rounded bg-app-elev px-1 py-px text-[9px] tabular-nums text-app-muted">
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Dropdown "Mês pagamento operação": filtra pelos registros cujo 1% após
 * operação cai num mês específico (mês da 1ª operação do cliente). Lista só os
 * meses que têm pagamento; vazio → desabilitado.
 */
function PayoutMonthSelect({
  value,
  onChange,
  months,
}: {
  value: string
  onChange: (v: string) => void
  months: string[]
}) {
  const active = value !== 'all'
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={months.length === 0}
      title="Filtrar pelo mês em que o 1% após operação será pago"
      className={`rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:border-app-border-strong disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-app-border-strong bg-app-elev text-app-text'
          : 'border-app-border bg-app-input text-app-muted'
      }`}
    >
      <option value="all">Mês pagamento operação · todos</option>
      {months.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
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
      className={`whitespace-nowrap px-3 py-2 font-semibold ${className ?? ''}`}
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
    <td
      className={`whitespace-nowrap px-3 py-2.5 align-top ${className ?? ''}`}
    >
      {children}
    </td>
  )
}

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return yearMonth
  return `${MONTH_LABELS_LONG[m - 1]} ${y}`
}

function labelForStatus(s: StatusFilter): string {
  if (s === 'awaiting') return 'aguardando operação'
  if (s === 'paid') return '1% a pagar'
  if (s === 'lost') return 'não elegíveis'
  return 'todas'
}
