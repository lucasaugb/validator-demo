import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileEdit,
  ListChecks,
  Plus,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { Modal } from '../components/Modal'
import { TransactionForm } from '../components/TransactionForm'
import { TransactionsPerDayChart } from '../components/TransactionsPerDayChart'
import { MonthCalendarHeatmap } from '../components/MonthCalendarHeatmap'
import { GeoMap } from '../components/GeoMap'
import { ForecastPanel } from '../components/ForecastPanel'
import {
  aggregate,
  geoByPhoneRich,
  isInLastDays,
  pctChange,
  rawTotal,
  walletAnalytics,
} from '../lib/metrics'
import { effectiveUsdAmount } from '../lib/commission'
import { formatCurrency, formatDateBR, formatMoney } from '../lib/format'
import { UsdAmountChip } from '../components/UsdAmountChip'
import { finalStatusForAgent } from '../types'
import type { CurrencyTotals as Totals } from '../lib/metrics'
import type { Currency, Transaction } from '../types'
import { useAuth } from '../contexts/AuthContext'
import {
  deleteDraft,
  isDraftMeaningful,
  listDrafts,
  type TransactionDraft,
} from '../lib/drafts'

interface Props {
  transactions: Transaction[]
}

type Period = 'all' | 'month' | 'd30' | 'd7' | 'today'

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoje',
  d7: 'Últimos 7 dias',
  d30: 'Últimos 30 dias',
  month: 'Mês atual',
  all: 'Tudo',
}

function validatedTotals(transactions: Transaction[]): Totals {
  const totals: Totals = { USD: 0, EUR: 0, GBP: 0 }
  for (const d of transactions) {
    if (finalStatusForAgent(d) === 'validated') {
      totals[d.currency as Currency] += d.amount || 0
    }
  }
  return totals
}

/** Combina dois Totals (por moeda): usado pra unir invalid+rejected no Gestor. */
function sumTotals(a: Totals, b: Totals): Totals {
  return {
    USD: (a.USD || 0) + (b.USD || 0),
    EUR: (a.EUR || 0) + (b.EUR || 0),
    GBP: (a.GBP || 0) + (b.GBP || 0),
  }
}

function validatedCountOf(transactions: Transaction[]): number {
  let n = 0
  for (const d of transactions) if (finalStatusForAgent(d) === 'validated') n += 1
  return n
}

function activationCountOf(transactions: Transaction[]): number {
  let n = 0
  for (const d of transactions) {
    if (finalStatusForAgent(d) === 'validated' && d.isActivation) n += 1
  }
  return n
}

export function AgenteHome({ transactions }: Props) {
  const { agente } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [period, setPeriod] = useState<Period>('month')
  // Mês explícito quando period === 'month'. 0 = mês atual, -1 = anterior, etc.
  const [monthOffset, setMonthOffset] = useState(0)
  const navigate = useNavigate()

  const { current, previous, periodLabelLong } = useMemo(() => {
    if (period === 'all') {
      return {
        current: transactions,
        previous: [] as Transaction[],
        periodLabelLong: 'Histórico completo',
      }
    }
    if (period === 'month') {
      const target = monthDateFromOffset(monthOffset)
      const prevTarget = monthDateFromOffset(monthOffset - 1)
      const tY = target.getFullYear()
      const tM = target.getMonth() + 1
      const pY = prevTarget.getFullYear()
      const pM = prevTarget.getMonth() + 1
      const inMonth = (d: Transaction, y: number, m: number) => {
        if (!d.transactionDate) return false
        const [dy, dm] = d.transactionDate.split('-').map(Number)
        return dy === y && dm === m
      }
      return {
        current: transactions.filter((d) => inMonth(d, tY, tM)),
        previous: transactions.filter((d) => inMonth(d, pY, pM)),
        periodLabelLong: target.toLocaleDateString('pt-BR', {
          month: 'long',
          year: 'numeric',
        }),
      }
    }
    if (period === 'today') {
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = (() => {
        const d = new Date()
        d.setDate(d.getDate() - 1)
        return d.toISOString().slice(0, 10)
      })()
      return {
        current: transactions.filter((d) => d.transactionDate === today),
        previous: transactions.filter((d) => d.transactionDate === yesterday),
        periodLabelLong: 'Hoje',
      }
    }
    const days = period === 'd30' ? 30 : 7
    return {
      current: transactions.filter((d) => isInLastDays(d.transactionDate, days)),
      previous: transactions.filter(
        (d) => isInLastDays(d.transactionDate, days * 2) && !isInLastDays(d.transactionDate, days),
      ),
      periodLabelLong: `Últimos ${days} dias`,
    }
  }, [transactions, period, monthOffset])

  // Janela do chart "Registros por dia" no modo Mês, espelha o filtro
  // de período. Quando navega pra mês passado, endDate é o último dia
  // daquele mês.
  const chartRange = useMemo<{ days: number; endDate?: string }>(() => {
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (period === 'today') return { days: 1 }
    if (period === 'd7') return { days: 7 }
    if (period === 'd30') return { days: 30 }
    if (period === 'month') {
      const target = monthDateFromOffset(monthOffset)
      const firstDay = new Date(target.getFullYear(), target.getMonth(), 1)
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0)
      const today = new Date()
      const effectiveEnd = lastDay > today ? today : lastDay
      const diffDays =
        Math.floor((effectiveEnd.getTime() - firstDay.getTime()) / 86_400_000) + 1
      return { days: Math.max(diffDays, 1), endDate: ymd(effectiveEnd) }
    }
    return { days: 30 }
  }, [period, monthOffset])

  const m = useMemo(() => aggregate(current), [current])
  const m0 = useMemo(() => aggregate(previous), [previous])
  const validated = useMemo(() => validatedCountOf(current), [current])
  const validated0 = useMemo(() => validatedCountOf(previous), [previous])
  const validatedActivations = useMemo(() => activationCountOf(current), [current])
  const validatedActivations0 = useMemo(
    () => activationCountOf(previous),
    [previous],
  )
  const pending = m.total - validated
  const validatedByCurrency = useMemo(() => validatedTotals(current), [current])
  const recent = transactions.slice(0, 10)

  const validationRate = m.total > 0 ? validated / m.total : 0

  const wallet = useMemo(() => walletAnalytics(current), [current])
  const walletPrev = useMemo(() => walletAnalytics(previous), [previous])

  const geo = useMemo(() => geoByPhoneRich(current), [current])

  // Mês em foco pro forecast: o mês navegado (modo Mês) ou o mês corrente.
  const forecastMonth = useMemo(() => {
    const d = period === 'month' ? monthDateFromOffset(monthOffset) : new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [period, monthOffset])


  // Volumes em USD por status: usados pra montar o bloco superior do summary
  // panel (hero "Volume verificado" + breakdown de pendente / inválido / total
  // registrado abaixo). Tudo a partir do `current` (filtrado pelo period
  // seletor) e convertido com a cotação USD do dia da transação.
  const totalRegisteredUsd = useMemo(
    () => current.reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )
  const totalValidatedUsd = useMemo(
    () =>
      current
        .filter((d) => finalStatusForAgent(d) === 'validated')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )
  const totalValidatedUsd0 = useMemo(
    () =>
      previous
        .filter((d) => finalStatusForAgent(d) === 'validated')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [previous],
  )
  const totalPendingUsd = useMemo(
    () =>
      current
        .filter((d) => finalStatusForAgent(d) === 'pending')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )
  const totalInvalidUsd = useMemo(
    () =>
      current
        .filter((d) => finalStatusForAgent(d) === 'rejected')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }, [])
  const firstName = agente?.name?.split(' ')[0] ?? 'agente'

  // Rascunhos de transações salvas no localStorage que ainda NÃO foram
  // enviados: usuário fechou a aba/recarregou no meio. Atualiza quando
  // abre/fecha o modal pra refletir alterações.
  const [drafts, setDrafts] = useState<TransactionDraft[]>([])
  const [draftNonce, setDraftNonce] = useState<string | undefined>(undefined)
  const refreshDrafts = () => {
    if (!agente?.uid) {
      setDrafts([])
      return
    }
    setDrafts(listDrafts(agente.uid).filter(isDraftMeaningful))
  }
  useEffect(() => {
    refreshDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agente?.uid])
  useEffect(() => {
    if (!modalOpen) refreshDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])

  const openNewTransaction = () => {
    setDraftNonce(undefined) // garante UUID novo
    setModalOpen(true)
  }
  const continueDraft = (nonce: string) => {
    setDraftNonce(nonce)
    setModalOpen(true)
  }
  const discardDraft = (nonce: string) => {
    if (!agente?.uid) return
    deleteDraft(agente.uid, nonce)
    refreshDrafts()
  }

  // Quantos transações importadas por planilha ainda estão sem comprovante,
  // gestor precisa anexar pelo botão de editar. Carrega banner discreto no
  // topo enquanto houver pendentes.
  const importedMissingReceipt = useMemo(
    () =>
      transactions.filter(
        (d) =>
          d.importedAt &&
          (d.transactionReceiptUrls?.length ?? 0) === 0 &&
          (d.conversationReceiptUrls?.length ?? 0) === 0,
      ).length,
    [transactions],
  )

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        subtitle={periodLabelLong}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodToggle value={period} onChange={setPeriod} />
            {period === 'month' && (
              <MonthOffsetNav offset={monthOffset} onChange={setMonthOffset} />
            )}
            <button
              onClick={openNewTransaction}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold btn-accent"
            >
              <Plus size={12} strokeWidth={2.4} />
              Novo registro
            </button>
          </div>
        }
      />

      {/* Banner discreto: lembra o gestor que tem comprovante a anexar nos
          registros importados pela planilha. */}
      {importedMissingReceipt > 0 && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-[11.5px]">
          <span className="text-app-text">
            <span className="font-semibold text-amber-700 dark:text-amber-300">
              {importedMissingReceipt}
            </span>{' '}
            registro{importedMissingReceipt === 1 ? '' : 's'} importado
            {importedMissingReceipt === 1 ? '' : 's'} sem comprovante,
            anexar pelo botão na linha.
          </span>
          <button
            type="button"
            onClick={() => navigate('/agente/registros')}
            className="rounded border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
          >
            ver lista
          </button>
        </div>
      )}

      {/* Summary panel: 1 container, 2 zonas:
            Zona A: hero Volume verificado + sub-volumes (Total/Pendente/
              Inválido) à esquerda; Ativações + Clientes à direita,
              separados do bloco de status pq não são derivados do volume
              registrado, são KPIs de relacionamento.
            Zona B: contagens que espelham os status do volume
              (Registros / Verificados / Pendentes / Inválidos). */}
      <div className="panel mt-1 mb-4 overflow-hidden">
        {/* Zona A: volumes + KPIs de relacionamento */}
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-5 pt-4 pb-3.5">
          {/* Esquerda: hero + sub-volumes */}
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-app-subtle">
              <span>Volume verificado</span>
              <span className="mx-1.5 text-app-border">·</span>
              <span className="font-normal normal-case tracking-normal text-app-muted">
                {periodLabelLong}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-app-text">
                {formatMoney(totalValidatedUsd)}
              </span>
              <DeltaBadge
                value={pctChange(totalValidatedUsd, totalValidatedUsd0)}
              />
            </div>
            <div className="mt-3.5 flex flex-wrap items-baseline gap-x-6 gap-y-1.5 font-mono text-[13px] tabular-nums">
              <SubVolume
                label="Total volume registrado"
                value={formatMoney(totalRegisteredUsd)}
              />
              <SubVolume
                label="Pendente"
                value={formatMoney(totalPendingUsd)}
                tone={totalPendingUsd > 0 ? 'amber' : 'muted'}
              />
              <SubVolume
                label="Inválido"
                value={formatMoney(totalInvalidUsd)}
                tone={totalInvalidUsd > 0 ? 'rose' : 'muted'}
              />
            </div>
          </div>

          {/* Direita: Ativações + Clientes (KPIs de relacionamento) */}
          <div className="flex shrink-0 items-start gap-x-6 font-mono tabular-nums">
            <SummaryKpi
              label="Ativações"
              value={validatedActivations}
              tone="violet"
              delta={pctChange(validatedActivations, validatedActivations0)}
            />
            <SummaryKpi
              label="Clientes"
              value={wallet.uniqueClients}
              delta={pctChange(
                wallet.uniqueClients,
                walletPrev.uniqueClients,
              )}
            />
          </div>
        </div>

        {/* Hairline */}
        <div className="h-px bg-app-border" />

        {/* Zona B: contagens que espelham o volume por status */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 bg-app-elev/30 px-5 py-3.5 font-mono tabular-nums">
          <SummaryKpi
            label="Registros"
            value={m.total}
            delta={pctChange(m.total, m0.total)}
          />
          <SummaryKpi
            label="Verificados"
            value={validated}
            hint={`${(validationRate * 100).toFixed(0)}%`}
            tone="emerald"
            delta={pctChange(validated, validated0)}
          />
          <SummaryKpi
            label="Pendentes"
            value={pending}
            tone={pending > 0 ? 'amber' : 'muted'}
          />
          <SummaryKpi
            label="Inválidos"
            value={m.invalid + m.rejectedOnly}
            tone={m.invalid + m.rejectedOnly > 0 ? 'rose' : 'muted'}
            delta={pctChange(
              m.invalid + m.rejectedOnly,
              m0.invalid + m0.rejectedOnly,
            )}
            invertDelta
          />
        </div>
      </div>

      {/* Forecast: projeção de fechamento vs meta (meu / meu time) */}
      {agente && (
        <div className="mt-3">
          <ForecastPanel
            month={forecastMonth}
            transactions={transactions}
            role={agente.role}
            agente={agente}
          />
        </div>
      )}

      {/* Rascunhos não enviados: só aparece se tem ao menos 1 */}
      {drafts.length > 0 && (
        <DraftsPanel
          drafts={drafts}
          onContinue={continueDraft}
          onDiscard={discardDraft}
        />
      )}

      {/* Série temporal: full width (agente não tem Top agentes) */}
      <div className="panel mt-3 overflow-hidden">
        <div className="panel-head">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            Registros por dia
          </h3>
          <span className="font-mono text-[10px] tabular-nums text-app-subtle">
            {m.total} registro{m.total === 1 ? '' : 's'}
          </span>
        </div>
        <div className="px-4 pt-3 pb-2">
          <TransactionsPerDayChart
            transactions={current}
            yearTransactions={transactions}
            days={chartRange.days}
            endDate={chartRange.endDate}
            height={190}
          />
        </div>
      </div>

      {/* Geografia (mapa) + Calendário do mês lado a lado */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Distribuição geográfica
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-app-subtle">
              {geo.filter((c) => c.code !== '??').length} país
              {geo.filter((c) => c.code !== '??').length === 1 ? '' : 'es'}
            </span>
          </div>
          <div className="px-3 py-3">
            <GeoMap countries={geo} height={320} viewMode="agent" />
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Calendário do mês
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-app-subtle">
              só verificados
            </span>
          </div>
          <div className="px-4 py-4">
            <MonthCalendarHeatmap transactions={transactions} viewMode="agent" />
          </div>
        </div>
      </div>

      {/* Valores por status + Atividade recente */}
      <SectionTitle label="Valores" hint={PERIOD_LABEL[period].toLowerCase()} />
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Por situação
            </h3>
            <span className="text-[10px] text-app-subtle">face-value</span>
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-app-border/60">
              <ValueRow
                label="Registrado"
                hint="registrados"
                totals={m.totalByCurrency}
              />
              <ValueRow
                label="Verificado"
                hint="verificados"
                totals={validatedByCurrency}
                accent="green"
                pctOfTop={
                  rawTotal(m.totalByCurrency) > 0
                    ? rawTotal(validatedByCurrency) / rawTotal(m.totalByCurrency)
                    : 0
                }
              />
              <ValueRow
                label="Pendentes"
                hint="aguardando"
                totals={m.pendingByCurrency}
                accent="orange"
              />
              <ValueRow
                label="Inválidos"
                hint="não verificados"
                totals={sumTotals(m.invalidByCurrency, m.rejectedByCurrency)}
                accent="red"
              />
            </tbody>
          </table>
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-head">
            <div className="flex items-center gap-1.5">
              <ListChecks size={12} className="text-app-muted" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
                Atividade recente
              </h3>
            </div>
            <button
              onClick={() => navigate('/agente/registros')}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-app-muted transition-colors hover:text-app-text"
            >
              ver tudo
              <ChevronRight size={11} />
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="px-4 py-8 text-center text-[11px] text-app-subtle">
              Nenhum registro ainda. Clique em "Novo registro".
            </div>
          ) : (
            <ul className="divide-y divide-app-border/60">
              {recent.map((d) => {
                const status = finalStatusForAgent(d)
                return (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-app-elev/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-app-text">
                        {d.transactionNumber != null && (
                          <span className="font-mono text-app-subtle">
                            #{d.transactionNumber}
                          </span>
                        )}
                        <span className="truncate">{d.clientName}</span>
                      </div>
                      <div className="font-mono text-[10px] tabular-nums text-app-subtle">
                        {formatDateBR(d.transactionDate)}
                        {d.isActivation && status === 'validated' && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-app-muted">
                            <UserPlus size={9} /> ativação
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[12px] font-semibold tabular-nums text-app-text">
                        {formatCurrency(d.amount, d.currency)}
                      </div>
                      <UsdAmountChip transaction={d} />
                      <StatusPill status={status} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={draftNonce ? 'Continuar rascunho' : 'Incluir Registro'}
        subtitle={
          draftNonce
            ? 'Voltando ao formulário que ficou aberto'
            : 'Adicione um novo registro'
        }
      >
        <TransactionForm
          // key força o componente a remontar quando o nonce muda, assim o
          // defaultValues do useForm reaplica os campos do draft (RHF não
          // re-inicializa defaultValues após mount).
          key={draftNonce ?? 'new'}
          onSuccess={() => setModalOpen(false)}
          draftNonce={draftNonce}
        />
      </Modal>
    </>
  )
}

/* ----------------------------- subcomponents ----------------------------- */

/**
 * Painel de rascunhos não enviados: transações que o agente começou a
 * preencher mas não chegou a confirmar (fechou aba, perdeu rede, recarregou).
 * Os campos texto são restaurados; as imagens precisam ser anexadas de novo.
 */
function DraftsPanel({
  drafts,
  onContinue,
  onDiscard,
}: {
  drafts: TransactionDraft[]
  onContinue: (nonce: string) => void
  onDiscard: (nonce: string) => void
}) {
  return (
    <div className="panel mt-3 overflow-hidden border-amber-500/30 bg-amber-500/[0.04]">
      <div className="panel-head border-amber-500/20">
        <div className="flex items-center gap-1.5">
          <FileEdit size={12} className="text-amber-600 dark:text-amber-400" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
            Rascunhos não enviados
          </h3>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-app-subtle">
          {drafts.length} aguardando
        </span>
      </div>
      <ul className="divide-y divide-app-border/60">
        {drafts.map((d) => {
          const updated = new Date(d.updatedAt || 0)
          const dd = String(updated.getDate()).padStart(2, '0')
          const mm = String(updated.getMonth() + 1).padStart(2, '0')
          const hh = String(updated.getHours()).padStart(2, '0')
          const mi = String(updated.getMinutes()).padStart(2, '0')
          const subtitle =
            d.clientName.trim() ||
            d.clientEmail.trim() ||
            d.clientId.trim() ||
            'Sem dados de cliente'
          return (
            <li
              key={d.nonce}
              className="flex items-center gap-3 px-4 py-2.5 text-[12px]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-app-text">
                  {subtitle}
                </div>
                <div className="font-mono text-[10px] tabular-nums text-app-subtle">
                  {d.amount ? `${d.currency} ${d.amount}` : 'sem valor'}{' '}
                  · editado {dd}/{mm} {hh}:{mi}
                  {' '}· comprovantes precisarão ser anexados de novo
                </div>
              </div>
              <button
                type="button"
                onClick={() => onContinue(d.nonce)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold btn-accent"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={() => onDiscard(d.nonce)}
                title="Descartar rascunho"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-app-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
              >
                <Trash2 size={11} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Sub-volume da zona A do summary, usado pra Total registrado / Pendente /
 * Inválido logo abaixo do hero "Volume verificado". Densidade alta, mas
 * legível: label inline minúsculo + valor 13px semibold com tom semântico.
 */
type StatTone = 'default' | 'muted' | 'emerald' | 'amber' | 'rose' | 'violet'

function SubVolume({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: StatTone
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
        {label}
      </span>
      <span className={`font-semibold ${toneClass(tone)}`}>{value}</span>
    </span>
  )
}

/**
 * KPI da zona B do summary, contagens (Registros, Verificados, ...). Valor
 * em 19px semibold com cor semântica, label 10px uppercase em cima. Sem
 * cell/border: só typography pra delimitar.
 */
function SummaryKpi({
  label,
  value,
  hint,
  delta,
  invertDelta,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  delta?: number | null
  invertDelta?: boolean
  tone?: StatTone
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={`text-[19px] font-semibold leading-none tracking-[-0.01em] ${toneClass(tone)}`}
        >
          {value}
        </span>
        {hint && (
          <span className="text-[10.5px] text-app-subtle">{hint}</span>
        )}
        {delta != null && <DeltaBadge value={delta} invert={invertDelta} />}
      </div>
    </div>
  )
}

function toneClass(tone: StatTone | undefined): string {
  switch (tone) {
    case 'emerald':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'amber':
      return 'text-amber-600 dark:text-amber-400'
    case 'rose':
      return 'text-rose-600 dark:text-rose-400'
    case 'violet':
      return 'text-violet-600 dark:text-violet-400'
    case 'muted':
      return 'text-app-muted'
    default:
      return 'text-app-text'
  }
}

function DeltaBadge({
  value,
  invert,
}: {
  value: number | null
  invert?: boolean
}) {
  if (value == null || !isFinite(value) || value === 0) {
    return <span className="font-mono text-[10px] text-app-subtle">-</span>
  }
  const positive = value > 0
  const isGood = invert ? !positive : positive
  const cls = isGood
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400'
  const Icon = positive ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums ${cls}`}
    >
      <Icon size={10} strokeWidth={2.4} />
      {Math.abs(value * 100).toFixed(0)}%
    </span>
  )
}

function SectionTitle({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mt-6 mb-2 flex items-center gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">
        {label}
      </span>
      <div className="h-px flex-1 bg-app-border" />
      {hint && (
        <span className="font-mono text-[10px] tabular-nums text-app-subtle">
          {hint}
        </span>
      )}
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
  // Mês de fechamento (comissão) fica isolado dos relativos, feedback persistente.
  const relativeOpts: { v: Period; label: string }[] = [
    { v: 'today', label: 'Hoje' },
    { v: 'd7', label: '7d' },
    { v: 'd30', label: '30d' },
    { v: 'all', label: 'Tudo' },
  ]
  const monthSelected = value === 'month'
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        role="tab"
        aria-selected={monthSelected}
        onClick={() => onChange('month')}
        title="Filtrar pelo mês"
        className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${
          monthSelected
            ? 'btn-accent shadow-[var(--shadow-card)]'
            : 'border border-app-border bg-app-card text-app-muted hover:bg-app-elev hover:text-app-text'
        }`}
      >
        Mês
      </button>
      <div className="seg" role="tablist">
        {relativeOpts.map((o) => (
          <button
            key={o.v}
            type="button"
            role="tab"
            aria-selected={value === o.v}
            onClick={() => onChange(o.v)}
            className="seg-item"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ValueRow({
  label,
  hint,
  totals,
  accent,
  pctOfTop,
}: {
  label: string
  hint: string
  totals: Totals
  accent?: 'green' | 'orange' | 'red'
  pctOfTop?: number
}) {
  const sum = (totals.USD || 0) + (totals.EUR || 0) + (totals.GBP || 0)
  const anyValue = sum > 0
  const valueCls =
    accent === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'orange'
        ? 'text-orange-600 dark:text-orange-400'
        : accent === 'red'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-app-text'

  return (
    <tr className="transition-colors hover:bg-app-elev/30">
      <td className="w-[44%] px-4 py-2 align-top">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-muted">
          {label}
        </div>
        <div className="mt-0.5 text-[10px] leading-snug text-app-subtle">
          {hint}
        </div>
      </td>
      <td className="px-4 py-2 align-top text-right">
        {!anyValue ? (
          <span className="font-mono text-[14px] font-medium tabular-nums text-app-subtle">
            {formatMoney(0)}
          </span>
        ) : (
          <div
            className={`font-mono text-[15px] font-medium tabular-nums tracking-[-0.01em] ${valueCls}`}
          >
            {formatMoney(sum)}
          </div>
        )}
        {pctOfTop !== undefined && pctOfTop > 0 && (
          <div className="mt-1 inline-flex rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
            {(pctOfTop * 100).toFixed(0)}%
          </div>
        )}
      </td>
    </tr>
  )
}

function StatusPill({ status }: { status: 'pending' | 'validated' | 'rejected' }) {
  if (status === 'validated') {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={9} /> verificado
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-rose-600 dark:text-rose-400">
        <XCircle size={9} /> inválido
      </span>
    )
  }
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600 dark:text-amber-400">
      <Clock size={9} /> pendente
    </span>
  )
}


/** Retorna o Date do dia 1 do mês deslocado em `offset` meses do mês atual. */
function monthDateFromOffset(offset: number): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + offset, 1)
}

function MonthOffsetNav({
  offset,
  onChange,
}: {
  offset: number
  onChange: (next: number) => void
}) {
  const target = monthDateFromOffset(offset)
  const label = target.toLocaleDateString('pt-BR', {
    month: 'short',
    year: '2-digit',
  })
  const canForward = offset < 0
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-1 py-1">
      <button
        type="button"
        onClick={() => onChange(offset - 1)}
        title="Mês anterior"
        className="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
      >
        ‹
      </button>
      <span className="min-w-[72px] text-center font-mono text-[10.5px] font-semibold tabular-nums uppercase text-app-text">
        {label}
      </span>
      <button
        type="button"
        onClick={() => canForward && onChange(offset + 1)}
        disabled={!canForward}
        title={canForward ? 'Próximo mês' : 'Mês atual'}
        className="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        ›
      </button>
    </div>
  )
}
