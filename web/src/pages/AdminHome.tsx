import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Download,
  Trophy,
  Users2,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { AdminFiltersInline } from '../components/AdminFiltersInline'
import { AuditStatusBanner } from '../components/AuditStatusBanner'
import { CommissionBalanceCard, HiddenDots } from '../components/CommissionBalanceCard'
import { useBalanceVisibility } from '../contexts/BalanceVisibilityContext'
import { SetorBreakdown } from '../components/SetorBreakdown'
import { ConversionFunnel } from '../components/ConversionFunnel'
import { InvalidLog } from '../components/InvalidLog'
import { Modal } from '../components/Modal'
import { TransactionDetails } from '../components/TransactionDetails'
import { MonthlyCommissionChart } from '../components/MonthlyCommissionChart'
import { SetorCommissionTable } from '../components/SetorCommissionTable'
import { TransactionsPerDayChart } from '../components/TransactionsPerDayChart'
import { MonthCalendarHeatmap } from '../components/MonthCalendarHeatmap'
import { GeoMap } from '../components/GeoMap'
import { AgentLeaderboard } from '../components/AgentLeaderboard'
import { TeamInsights } from '../components/TeamInsights'
import { PerformancePanel } from '../components/PerformancePanel'
import { SetorBadge } from '../components/SetorBadge'
import { ForecastPanel } from '../components/ForecastPanel'
import {
  aggregate,
  agentScorecards,
  bySetor,
  conversionFunnel,
  geoByPhoneRich,
  inactiveAgentInsight,
  invalidRateAlerts,
  invalidReasonBuckets,
  isInLastDays,
  pctChange,
  recentInvalids,
  stalePendingCount,
  teamInsights,
  topAgentes,
  topClients,
  walletAnalytics,
} from '../lib/metrics'
import {
  commissionByAgent,
  commissionByAgentForMonth,
  commissionBySetor,
  commissionBySetorForMonth,
  effectiveUsdAmount,
  globalCommissionSummary,
  monthlyPayoutSplit,
} from '../lib/commission'
import { exportTransactionsCsv } from '../lib/exportCsv'
import { subscribeAgentes } from '../lib/agentes'
import type { Agente } from '../types'
import { formatCurrency, formatMoney } from '../lib/format'
import { SETORES, setorLabel, setoresInScope } from '../types'
import type { Setor } from '../types'
import type { Transaction } from '../types'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  transactions: Transaction[]
  /**
   * Transações do escopo SEM o filtro global (agente/setor) da barra admin,
   * usados só pelo Forecast, que tem o próprio seletor de escopo e precisa da
   * base completa pra o modo "Geral". Cai em `transactions` quando ausente.
   */
  rawTransactions?: Transaction[]
}

type Period = 'all' | 'month' | 'd30' | 'd7' | 'today'

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoje',
  d7: 'Últimos 7 dias',
  d30: 'Últimos 30 dias',
  month: 'Mês atual',
  all: 'Tudo',
}

type SetorFilter = Setor | 'all'

export function AdminHome({ transactions, rawTransactions }: Props) {
  const navigate = useNavigate()
  const { agente } = useAuth()
  const isSupervisor = agente?.role === 'supervisor'
  const forecastTransactions = rawTransactions ?? transactions
  const { hidden: balancesHidden } = useBalanceVisibility()
  const [period, setPeriod] = useState<Period>('month')
  // Supervisor é travado no próprio setor, sem filtro de setor.
  const [setorFilter, setSetorFilter] = useState<SetorFilter>('all')
  // Mês explícito quando period === 'month'. Default: mês atual.
  const [monthOffset, setMonthOffset] = useState(0)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [topClientsOpen, setTopClientsOpen] = useState(false)
  const [topAgentsOpen, setTopAgentsOpen] = useState(false)
  const [agentes, setAgentes] = useState<Agente[]>([])

  useEffect(() => subscribeAgentes(setAgentes), [])

  const avatarUrlByAgente = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const a of agentes) m.set(a.uid, a.avatarUrl)
    return m
  }, [agentes])

  const detailsTarget = useMemo(
    () => transactions.find((d) => d.id === detailsId) ?? null,
    [transactions, detailsId],
  )

  // Filtra por setor PRIMEIRO: depois aplica recorte temporal
  const transactionsBySetor = useMemo(() => {
    if (setorFilter === 'all') return transactions
    return transactions.filter((d) => d.agenteSetor === setorFilter)
  }, [transactions, setorFilter])

  const { current, previous, periodLabelLong } = useMemo(() => {
    if (period === 'all') {
      return {
        current: transactionsBySetor,
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
        current: transactionsBySetor.filter((d) => inMonth(d, tY, tM)),
        previous: transactionsBySetor.filter((d) => inMonth(d, pY, pM)),
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
        current: transactionsBySetor.filter((d) => d.transactionDate === today),
        previous: transactionsBySetor.filter((d) => d.transactionDate === yesterday),
        periodLabelLong: 'Hoje',
      }
    }
    const days = period === 'd30' ? 30 : 7
    const cur = transactionsBySetor.filter((d) => isInLastDays(d.transactionDate, days))
    const prev = transactionsBySetor.filter(
      (d) => isInLastDays(d.transactionDate, days * 2) && !isInLastDays(d.transactionDate, days),
    )
    return {
      current: cur,
      previous: prev,
      periodLabelLong: `Últimos ${days} dias`,
    }
  }, [transactionsBySetor, period, monthOffset])

  // Chave yyyy-MM do mês selecionado (e anterior), só no modo "Mês". A comissão
  // usa a base de MÊS DE PAGAMENTO nesse modo, igual à tela Fechamento: o 1% de
  // ativações cai no mês da 1ª operação, não no mês da transação. Nos períodos
  // relativos (Hoje/7d/30d/Tudo) não há um mês de fechamento único, então cai
  // no cálculo por transactionDate (commissionByAgent).
  const monthKeys = useMemo(() => {
    if (period !== 'month') return null
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return {
      current: key(monthDateFromOffset(monthOffset)),
      previous: key(monthDateFromOffset(monthOffset - 1)),
    }
  }, [period, monthOffset])

  const m = useMemo(() => aggregate(current), [current])
  const m0 = useMemo(() => aggregate(previous), [previous])
  const all = useMemo(() => aggregate(transactions), [transactions])

  const funnel = useMemo(() => conversionFunnel(current), [current])
  const setorCommission = useMemo(
    () =>
      monthKeys
        ? commissionBySetorForMonth(transactionsBySetor, monthKeys.current)
        : commissionBySetor(current),
    [monthKeys, transactionsBySetor, current],
  )
  const ranking = useMemo(() => topAgentes(current, 5), [current])
  // Lista completa pro modal "ver tudo" (ordenada por valor validado USD).
  const allAgents = useMemo(() => topAgentes(current, 100), [current])
  const clients = useMemo(() => topClients(current, 5), [current])
  // Lista completa pro modal "ver tudo" (limite alto, ordenada por valor USD).
  const allClients = useMemo(() => topClients(current, 100), [current])
  const invalidAlerts = useMemo(() => invalidRateAlerts(transactions), [transactions])
  const setorRows = useMemo(() => bySetor(current), [current])
  const invalidEntries = useMemo(() => recentInvalids(current, 8), [current])
  const reasonBuckets = useMemo(() => invalidReasonBuckets(current), [current])

  const stale = useMemo(() => stalePendingCount(transactions), [transactions])

  // No modo "Mês", comissão = base de pagamento do mês (bate com Fechamento):
  // passa TODOS as transações do setor (sem recorte de mês) pra capturar o 1%
  // de ativações de meses anteriores cuja 1ª operação caiu neste mês.
  const commissionByAgentList = useMemo(
    () =>
      monthKeys
        ? commissionByAgentForMonth(transactionsBySetor, monthKeys.current)
        : commissionByAgent(current),
    [monthKeys, transactionsBySetor, current],
  )
  const commissionSummary = useMemo(
    () => globalCommissionSummary(commissionByAgentList),
    [commissionByAgentList],
  )
  const commissionSummaryPrev = useMemo(
    () =>
      globalCommissionSummary(
        monthKeys
          ? commissionByAgentForMonth(transactionsBySetor, monthKeys.previous)
          : commissionByAgent(previous),
      ),
    [monthKeys, transactionsBySetor, previous],
  )
  // Decomposição do 1% do mês: quanto é de registros do próprio mês vs quanto
  // veio de ativações de meses anteriores que operaram agora (carry-over). Só
  // no modo "Mês"; null nos períodos relativos.
  const payoutSplit = useMemo(
    () =>
      monthKeys ? monthlyPayoutSplit(transactionsBySetor, monthKeys.current) : null,
    [monthKeys, transactionsBySetor],
  )
  const commissionBreakdown = useMemo(() => {
    if (payoutSplit) {
      // Base de pagamento: headline (payableRawTotal) = bônus + 1% deste mês +
      // 1% de outros meses. Deixamos o carry-over explícito numa célula própria.
      return [
        {
          label: 'Bônus ativações',
          value: formatMoney(commissionSummary.fixedUsdTotal),
          tone: 'paid' as const,
        },
        {
          label: '1% deste mês',
          value: formatMoney(payoutSplit.pctThisMonthUsd),
          tone: 'paid' as const,
        },
        {
          label:
            payoutSplit.carryoverCount > 0
              ? `1% de outros meses (${payoutSplit.carryoverCount})`
              : '1% de outros meses',
          value: formatMoney(payoutSplit.pctCarryoverUsd),
          tone: payoutSplit.pctCarryoverUsd > 0 ? ('paid' as const) : ('info' as const),
        },
        {
          label: 'Aguardando op.',
          value: formatMoney(commissionSummary.pendingByCurrency.USD),
          tone:
            commissionSummary.pendingByCurrency.USD > 0
              ? ('pending' as const)
              : ('info' as const),
        },
      ]
    }
    return [
      {
        label: 'Bônus ativações',
        value: formatMoney(commissionSummary.fixedUsdTotal),
        tone: 'paid' as const,
      },
      {
        label: '1% volume',
        value: formatMoney(commissionSummary.percentageByCurrency.USD),
        tone: 'paid' as const,
      },
      {
        label: 'Aguardando op.',
        value: formatMoney(commissionSummary.pendingByCurrency.USD),
        tone:
          commissionSummary.pendingByCurrency.USD > 0
            ? ('pending' as const)
            : ('info' as const),
      },
      {
        label: 'Não elegível',
        value: formatMoney(commissionSummary.notEligibleByCurrency.USD),
        tone:
          commissionSummary.notEligibleByCurrency.USD > 0
            ? ('lost' as const)
            : ('info' as const),
      },
    ]
  }, [payoutSplit, commissionSummary])
  const topAgentsByCommission = useMemo(
    () =>
      [...commissionByAgentList]
        .filter((a) => a.payableRawTotal > 0)
        .sort((a, b) => b.payableRawTotal - a.payableRawTotal)
        .slice(0, 3),
    [commissionByAgentList],
  )
  const wallet = useMemo(() => walletAnalytics(current), [current])
  const walletPrev = useMemo(() => walletAnalytics(previous), [previous])

  const geo = useMemo(() => geoByPhoneRich(current), [current])

  // Comparativo "vs mesmo dia mês anterior": hoje (ex: 18/06) contra o mesmo dia
  // do mês anterior (18/05). Independe do filtro de período da página, é sempre
  // hoje vs o dia correspondente do mês passado, mas respeita o filtro de setor.
  const dayCompare = useMemo(() => {
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = new Date()
    const y = today.getFullYear()
    const mo = today.getMonth() // 0-based
    const day = today.getDate()
    // último dia do mês anterior: pra clampar quando o dia não existe lá (ex: 31).
    const prevMonthLastDay = new Date(y, mo, 0).getDate()
    const prevDate = new Date(y, mo - 1, Math.min(day, prevMonthLastDay))
    const dd = (s: string) => {
      const [, mm, d] = s.split('-')
      return `${d}/${mm}`
    }
    const todayStr = ymd(today)
    const prevStr = ymd(prevDate)
    return { todayStr, prevStr, caption: `${dd(todayStr)} vs ${dd(prevStr)}` }
  }, [])
  // Arrays do dia extraídos (em vez de filtrar dentro do aggregate): além das
  // contagens, o painel de Performance agora soma volume em USD sobre eles.
  const dayCurTransactions = useMemo(
    () => transactionsBySetor.filter((d) => d.transactionDate === dayCompare.todayStr),
    [transactionsBySetor, dayCompare],
  )
  const dayPrevTransactions = useMemo(
    () => transactionsBySetor.filter((d) => d.transactionDate === dayCompare.prevStr),
    [transactionsBySetor, dayCompare],
  )
  const mDayCur = useMemo(() => aggregate(dayCurTransactions), [dayCurTransactions])
  const mDayPrev = useMemo(() => aggregate(dayPrevTransactions), [dayPrevTransactions])
  const dayVolumeUsd = useMemo(
    () => dayCurTransactions.reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [dayCurTransactions],
  )
  const dayVolumeUsd0 = useMemo(
    () => dayPrevTransactions.reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [dayPrevTransactions],
  )

  // Volume total registrado em USD: soma face-value de TODOS os transactions do
  // período (effectiveUsdAmount converte quando a moeda não é USD). Mesma base
  // do card "Total volume registrado" do banner. Declarado AQUI (antes de
  // `perfIndicators`) porque o useMemo dos indicadores roda durante o render e
  // consumir um const declarado abaixo dispararia erro de TDZ.
  const totalTransactionedUsd = useMemo(
    () => current.reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )
  const totalTransactionedUsd0 = useMemo(
    () => previous.reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [previous],
  )

  // Indicadores principais do panel de Performance, comparativo vs período
  // anterior (mês) + comparativo do dia (hoje vs mesmo dia mês anterior).
  // Inválidos com invertDelta (queda é boa).
  const perfIndicators = useMemo(
    () => [
      {
        label: 'Registros',
        current: m.total,
        previous: m0.total,
        dayCurrent: mDayCur.total,
        dayPrevious: mDayPrev.total,
        dotColor: 'var(--app-subtle)',
      },
      {
        label: 'Validados',
        current: m.validated,
        previous: m0.validated,
        dayCurrent: mDayCur.validated,
        dayPrevious: mDayPrev.validated,
        dotColor: 'var(--app-accent)',
      },
      {
        label: 'Ativações',
        current: m.activations,
        previous: m0.activations,
        dayCurrent: mDayCur.activations,
        dayPrevious: mDayPrev.activations,
        dotColor: '#d8b34d',
      },
      // Substituiu "Inválidos" a pedido do usuário. Mesma base do card
      // "Total volume registrado": TODO o volume do período, não só o validado.
      {
        label: 'Volume registrado',
        current: totalTransactionedUsd,
        previous: totalTransactionedUsd0,
        dayCurrent: dayVolumeUsd,
        dayPrevious: dayVolumeUsd0,
        dotColor: 'var(--app-pos)',
        format: 'currency' as const,
      },
    ],
    [
      m,
      m0,
      mDayCur,
      mDayPrev,
      totalTransactionedUsd,
      totalTransactionedUsd0,
      dayVolumeUsd,
      dayVolumeUsd0,
    ],
  )

  const scorecardsCurrent = useMemo(() => agentScorecards(current), [current])
  const scorecardsPrev = useMemo(() => agentScorecards(previous), [previous])
  // Insight de inatividade: gestor ativo há mais tempo sem registrar nada
  // (qualquer status, não só validado). Usa histórico completo do setor filtrado
  //: independe do período da página, já que o objetivo é flagrar quem parou.
  const inactiveInsight = useMemo(
    () => inactiveAgentInsight(transactionsBySetor, agentes),
    [transactionsBySetor, agentes],
  )
  const insights = useMemo(() => {
    const base = teamInsights(scorecardsCurrent, scorecardsPrev)
    return inactiveInsight ? [...base, inactiveInsight] : base
  }, [scorecardsCurrent, scorecardsPrev, inactiveInsight])

  // partição: validados + pendentes + inválidos + rejeitados = total
  const pendentes = m.total - m.validated - m.invalid - m.rejectedOnly

  const totalVerifiedUsd = useMemo(
    () =>
      current
        .filter((d) => d.systemValidation === 'verified' && d.conversationValidation === 'approved')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )
  const totalVerifiedUsd0 = useMemo(
    () =>
      previous
        .filter((d) => d.systemValidation === 'verified' && d.conversationValidation === 'approved')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [previous],
  )
  const totalPendingUsd = useMemo(
    () =>
      current
        .filter((d) => d.systemValidation === 'pending' || d.conversationValidation === 'pending')
        .filter((d) => d.systemValidation !== 'invalid' && d.systemValidation !== 'duplicate')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )
  const totalInvalidUsd = useMemo(
    () =>
      current
        .filter((d) => d.systemValidation === 'invalid' || d.systemValidation === 'duplicate' || d.conversationValidation === 'rejected')
        .reduce((s, d) => s + effectiveUsdAmount(d), 0),
    [current],
  )

  // Janela do chart "Registros por dia" no modo Mês, derivada do filtro
  // de período da página. Quando o período é 'month' navegando pra um mês
  // passado, `endDate` aponta pro último dia daquele mês (e `days` cobre
  // o mês inteiro). Pra 'all' ou 'today' cai num default sensato de 30d.
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
    // 'all': fallback 30d até hoje
    return { days: 30 }
  }, [period, monthOffset])

  // Mês em foco pro forecast: o mês navegado (modo Mês) ou o mês corrente.
  const forecastMonth = useMemo(() => {
    const d = period === 'month' ? monthDateFromOffset(monthOffset) : new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [period, monthOffset])

  // Supervisor: setores reais cobertos (expande virtual). Admin: undefined = todos.
  const forecastScopeSetores = useMemo(
    () => (isSupervisor && agente?.setor ? setoresInScope(agente.setor) : undefined),
    [isSupervisor, agente?.setor],
  )

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle={`${periodLabelLong}${
          isSupervisor && agente?.setor
            ? ` · ${setorLabel[agente.setor]}`
            : setorFilter !== 'all'
              ? ` · ${setorLabel[setorFilter]}`
              : ''
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodToggle value={period} onChange={setPeriod} />
            {period === 'month' && (
              <MonthOffsetNav offset={monthOffset} onChange={setMonthOffset} />
            )}
            {!isSupervisor && (
              <SetorFilterToggle value={setorFilter} onChange={setSetorFilter} />
            )}
            <AdminFiltersInline />
            <button
              onClick={() => exportTransactionsCsv(current, `validator-transactions-${period}.csv`)}
              className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-card px-2.5 py-1.5 text-[11px] font-medium text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
              title="Exportar CSV"
            >
              <Download size={12} />
              CSV
            </button>
          </div>
        }
      />

      <div className="mb-3">
        <AuditStatusBanner />
      </div>

      {/* Alertas inline acima: só aparecem se houver, sem ocupar espaço quando vazio */}
      {(stale > 0 || all.conversationPending > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
          {stale > 0 && (
            <button
              onClick={() => navigate('/admin/transacoes?filter=system_pending')}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-2 py-1 font-medium text-rose-700 transition-colors hover:bg-rose-500/[0.12] dark:text-rose-300"
            >
              <AlertTriangle size={11} />
              {stale} pendente{stale === 1 ? '' : 's'} além de 12h
            </button>
          )}
          {all.conversationPending > 0 && (
            <button
              onClick={() => navigate('/admin/transacoes?filter=conversation_pending')}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1 font-medium text-amber-700 transition-colors hover:bg-amber-500/[0.12] dark:text-amber-200"
            >
              <Clock size={11} />
              {all.conversationPending} conversa{all.conversationPending === 1 ? '' : 's'} pendente{all.conversationPending === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {/* Banner duo: Total Validado + Comissão Calculada, ambos em USD */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CommissionBalanceCard
          amountUsd={totalVerifiedUsd}
          label="Total validado"
          period={periodLabelLong}
          deltaPct={pctChange(totalVerifiedUsd, totalVerifiedUsd0)}
          breakdown={[
            {
              label: 'Total volume registrado',
              value: formatMoney(totalTransactionedUsd),
              tone: 'info',
            },
            {
              label: 'Pendente',
              value: formatMoney(totalPendingUsd),
              tone: totalPendingUsd > 0 ? 'pending' : 'info',
            },
            {
              label: 'Inválido',
              value: formatMoney(totalInvalidUsd),
              tone: totalInvalidUsd > 0 ? 'lost' : 'info',
            },
            {
              label: 'Registros',
              value: String(m.total),
              tone: 'info',
            },
          ]}
          onClick={() => navigate('/admin/transacoes')}
          variant="admin"
        />
        <CommissionBalanceCard
          amountUsd={commissionSummary.payableRawTotal}
          label={monthKeys ? 'Comissão a pagar no mês' : 'Comissão calculada'}
          period={periodLabelLong}
          hideable
          note={
            monthKeys
              ? 'Base de pagamento do mês, mesmo critério da tela Fechamento: o 1% de ativações entra no mês da 1ª operação, não no do registro.'
              : undefined
          }
          deltaPct={pctChange(
            commissionSummary.payableRawTotal,
            commissionSummaryPrev.payableRawTotal,
          )}
          breakdown={commissionBreakdown}
          onClick={() => navigate('/admin/fechamento')}
          variant="admin"
        />
      </div>

      {/* Stat strip: KPIs de COUNT (banner cobre os valores). */}
      <div className="stat-strip mt-3">
        <StatCell
          label="Registros"
          value={m.total}
          delta={pctChange(m.total, m0.total)}
          onClick={() => navigate('/admin/transacoes')}
        />
        <StatCell
          label="Verificados"
          value={funnel.fullyValidated}
          delta={pctChange(
            funnel.fullyValidated,
            conversionFunnel(previous).fullyValidated,
          )}
          hint={`${(funnel.finalConversionRate * 100).toFixed(1)}%`}
          onClick={() => navigate('/admin/transacoes?filter=verified')}
        />
        <StatCell
          label="Pendentes"
          value={pendentes}
          tone={pendentes > 0 ? 'amber' : 'muted'}
          onClick={() => navigate('/admin/transacoes?filter=system_pending')}
        />
        <StatCell
          label="Inválidos"
          value={m.invalid}
          delta={pctChange(m.invalid, m0.invalid)}
          invertDelta
          tone={m.invalid > 0 ? 'rose' : 'muted'}
          onClick={() => navigate('/admin/transacoes?filter=invalid')}
        />
        <StatCell
          label="Ativações"
          value={m.validatedActivations}
          delta={pctChange(m.validatedActivations, m0.validatedActivations)}
          tone="violet"
          onClick={() => navigate('/admin/transacoes?filter=activations')}
        />
        <StatCell
          label="Clientes únicos"
          value={wallet.uniqueClients}
          delta={pctChange(wallet.uniqueClients, walletPrev.uniqueClients)}
          hint={
            wallet.recurringClients > 0
              ? `${wallet.recurringClients} rec.`
              : undefined
          }
        />
      </div>

      {/* Forecast: projeção de fechamento vs meta (Geral · Time · Colaborador) */}
      {agente && (
        <div className="mt-3">
          <ForecastPanel
            month={forecastMonth}
            transactions={forecastTransactions}
            role={agente.role}
            agente={agente}
            agentes={agentes}
            scopeSetores={forecastScopeSetores}
          />
        </div>
      )}

      {/* Série temporal MENOR + panel de Performance ao lado */}
      <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Registros por dia
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-app-subtle">
              {funnel.fullyValidated} validado{funnel.fullyValidated === 1 ? '' : 's'}
            </span>
          </div>
          <div className="px-4 pt-3 pb-2">
            <TransactionsPerDayChart
              transactions={current}
              yearTransactions={transactionsBySetor}
              days={chartRange.days}
              endDate={chartRange.endDate}
              height={160}
            />
          </div>
        </div>

        <PerformancePanel
          indicators={perfIndicators}
          dayCaption={dayCompare.caption}
        />
      </div>

      {/* Geografia (mapa) + Calendário do mês, lado a lado */}
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
            <GeoMap countries={geo} height={340} />
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Calendário do mês
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-app-subtle">
              só validados · createdAt
            </span>
          </div>
          <div className="px-4 py-4">
            <MonthCalendarHeatmap transactions={transactions} />
          </div>
        </div>
      </div>

      {/* Funil: faixa horizontal abaixo */}
      <div className="panel mt-3 overflow-hidden">
        <div className="panel-head">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            Funil de validação
          </h3>
          <span className="font-mono text-[10px] tabular-nums text-app-subtle">
            {(funnel.finalConversionRate * 100).toFixed(1)}% conversão final
          </span>
        </div>
        <div className="px-4 py-4">
          <ConversionFunnel funnel={funnel} bare />
        </div>
      </div>

      {/* Comparativo entre gestores: tabela densa, protagonista de tela de sistema */}
      <SectionTitle label="Equipe" hint={PERIOD_LABEL[period].toLowerCase()} />
      <TeamInsights
        insights={insights}
        onSelectAgent={(id) => navigate(`/admin/transacoes?agente=${id}`)}
      />
      <div className="panel mt-3 overflow-hidden">
        <AgentLeaderboard
          current={scorecardsCurrent}
          previous={scorecardsPrev}
          onSelectAgent={(id) => navigate(`/admin/transacoes?agente=${id}`)}
          avatarUrlByAgente={avatarUrlByAgente}
          hidden={balancesHidden}
        />
      </div>

      {/* Listas densas: Top gestores / Top clientes em DUAS colunas */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RankingList
          title="Top gestores"
          icon={Trophy}
          rows={ranking.map((a, i) => ({
            id: a.agenteId,
            rank: i + 1,
            primary: a.agenteName,
            // Top gestores agora usa o critério ESTRITO (validated = sistema +
            // conversa). Conta e valor exibidos batem com o que vira comissão.
            secondary: `${a.setor ? setorLabel[a.setor] + ' · ' : ''}${a.validated} validado${a.validated === 1 ? '' : 's'}${a.validatedActivations ? ` · ${a.validatedActivations} ativ.` : ''}`,
            valueLines: a.validatedUsd > 0 ? [formatCurrency(a.validatedUsd, 'USD')] : [],
          }))}
          onSeeAll={() => setTopAgentsOpen(true)}
          emptyText="Nenhuma ativação no período."
        />
        <RankingList
          title="Top clientes"
          icon={Users2}
          rows={clients.map((c, i) => ({
            id: c.clientId,
            rank: i + 1,
            primary: c.clientName || `Conta ${c.clientId}`,
            secondary: `conta ${c.clientId} · ${c.validatedTransactions} validado${c.validatedTransactions === 1 ? '' : 's'}`,
            valueLines: c.totalUsd > 0 ? [formatCurrency(c.totalUsd, 'USD')] : [],
          }))}
          onSeeAll={() => setTopClientsOpen(true)}
          emptyText="Nenhum cliente validado no período."
        />
      </div>

      {/* Setor breakdown + Comissão por setor lado a lado */}
      <SectionTitle label="Setores" hint={PERIOD_LABEL[period].toLowerCase()} />
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SetorBreakdown rows={setorRows} />
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Comissão por setor
            </h3>
          </div>
          <SetorCommissionTable rows={setorCommission} hidden={balancesHidden} />
        </div>
      </div>

      {/* Comissão histórica + métrica ao lado */}
      <SectionTitle label="Comissão" hint="histórico em USD" />
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Comissão calculada · histórico
            </h3>
            <span className="rounded-md bg-app-elev px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-app-text">
              {balancesHidden ? (
                <HiddenDots count={3} size="sm" />
              ) : (
                compactUsd(commissionSummary.payableRawTotal)
              )}
            </span>
          </div>
          <div className="px-4 py-3">
            <MonthlyCommissionChart
              transactions={transactions}
              defaultGranularity="month"
              height={140}
              hidden={balancesHidden}
            />
          </div>
        </div>

        <CommissionInsightsPanel
          summary={commissionSummary}
          summaryPrev={commissionSummaryPrev}
          topAgents={topAgentsByCommission}
          hidden={balancesHidden}
        />
      </div>

      {/* Inválidos + diagnóstico */}
      <SectionTitle label="Inválidos" hint={`${m.invalid + m.duplicate} no período`} />
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <InvalidLog
          entries={invalidEntries}
          onOpen={(id) => setDetailsId(id)}
          onSeeAll={() => navigate('/admin/transacoes?filter=invalid')}
        />
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Diagnóstico
            </h3>
            <span className="text-[10px] text-app-subtle">por motivo</span>
          </div>
          <div className="px-4 py-3.5">
            {reasonBuckets.length === 0 ? (
              <EmptyHint text="Sem inválidos para diagnosticar." />
            ) : (
              <ReasonList buckets={reasonBuckets} total={m.invalid + m.duplicate} />
            )}
          </div>
        </div>
      </div>

      {/* Alertas: tabela compacta só se houver */}
      {invalidAlerts.length > 0 && (
        <div className="panel mt-4 overflow-hidden border-rose-500/30 bg-rose-500/[0.03]">
          <div className="panel-head border-rose-500/20">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-rose-500" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-text">
                Alta taxa de inválidos
              </h3>
            </div>
            <span className="text-[10px] text-app-subtle">
              ≥5 decididos · taxa ≥30%
            </span>
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-app-border/60">
              {invalidAlerts.map((a) => (
                <tr key={a.agenteId} className="transition-colors hover:bg-app-elev/40">
                  <td className="px-4 py-2">
                    <div className="text-[12px] font-medium text-app-text">
                      {a.agenteName}
                    </div>
                    <div className="text-[10px] text-app-subtle">
                      {a.setor && <span>{setorLabel[a.setor]} · </span>}
                      {a.invalidCount}/{a.totalDecided}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[14px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    {(a.rate * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!detailsTarget}
        onClose={() => setDetailsId(null)}
        title="Detalhes do registro"
        subtitle={
          detailsTarget?.transactionNumber != null
            ? `#${detailsTarget.transactionNumber} · ${detailsTarget.clientName}`
            : detailsTarget?.clientName
        }
        width="3xl"
      >
        {detailsTarget && (
          <TransactionDetails
            transaction={detailsTarget}
            onClose={() => setDetailsId(null)}
          />
        )}
      </Modal>

      <Modal
        open={topClientsOpen}
        onClose={() => setTopClientsOpen(false)}
        title="Top clientes"
        subtitle={`Por valor transacionado (validado) · ${PERIOD_LABEL[period].toLowerCase()}`}
        width="2xl"
      >
        <TopClientsTable rows={allClients} />
      </Modal>

      <Modal
        open={topAgentsOpen}
        onClose={() => setTopAgentsOpen(false)}
        title="Top gestores"
        subtitle={`Por valor validado · ${PERIOD_LABEL[period].toLowerCase()}`}
        width="2xl"
      >
        <TopAgentsTable rows={allAgents} />
      </Modal>
    </>
  )
}

/** Tabela simples dos top gestores por valor validado (USD, sistema + conversa). */
function TopAgentsTable({ rows }: { rows: ReturnType<typeof topAgentes> }) {
  if (rows.length === 0) {
    return (
      <div className="px-1 py-8 text-center text-[12px] text-app-subtle">
        Nenhuma ativação no período.
      </div>
    )
  }
  return (
    <table className="w-full text-left text-[12.5px]">
      <thead>
        <tr className="border-b border-app-border text-[10px] uppercase tracking-[0.14em] text-app-subtle">
          <th className="py-2 pr-2 font-semibold">#</th>
          <th className="py-2 pr-2 font-semibold">Gestor</th>
          <th className="py-2 pr-2 text-right font-semibold">Validados</th>
          <th className="py-2 pr-2 text-right font-semibold">Ativ.</th>
          <th className="py-2 pl-2 text-right font-semibold">Valor (USD)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-app-border/60">
        {rows.map((a, i) => (
          <tr key={a.agenteId} className="hover:bg-app-elev/30">
            <td className="py-2 pr-2 font-mono text-[11px] tabular-nums text-app-subtle">
              {String(i + 1).padStart(2, '0')}
            </td>
            <td className="py-2 pr-2">
              <div className="truncate font-medium text-app-text">{a.agenteName}</div>
              {a.setor && (
                <div className="mt-0.5">
                  <SetorBadge setor={a.setor} size="xs" />
                </div>
              )}
            </td>
            <td className="py-2 pr-2 text-right font-mono tabular-nums text-app-muted">
              {a.validated}
            </td>
            <td className="py-2 pr-2 text-right font-mono tabular-nums text-app-muted">
              {a.validatedActivations}
            </td>
            <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-app-text">
              {formatCurrency(a.validatedUsd, 'USD')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Tabela simples dos top clientes por valor transacionado (USD, validados). */
function TopClientsTable({ rows }: { rows: ReturnType<typeof topClients> }) {
  if (rows.length === 0) {
    return (
      <div className="px-1 py-8 text-center text-[12px] text-app-subtle">
        Nenhum cliente validado no período.
      </div>
    )
  }
  return (
    <table className="w-full text-left text-[12.5px]">
      <thead>
        <tr className="border-b border-app-border text-[10px] uppercase tracking-[0.14em] text-app-subtle">
          <th className="py-2 pr-2 font-semibold">#</th>
          <th className="py-2 pr-2 font-semibold">Cliente</th>
          <th className="py-2 pr-2 text-right font-semibold">Validados</th>
          <th className="py-2 pl-2 text-right font-semibold">Valor (USD)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-app-border/60">
        {rows.map((c, i) => (
          <tr key={c.clientId} className="hover:bg-app-elev/30">
            <td className="py-2 pr-2 font-mono text-[11px] tabular-nums text-app-subtle">
              {String(i + 1).padStart(2, '0')}
            </td>
            <td className="py-2 pr-2">
              <div className="truncate font-medium text-app-text">
                {c.clientName || `Conta ${c.clientId}`}
              </div>
              <div className="text-[10px] text-app-subtle">conta {c.clientId}</div>
            </td>
            <td className="py-2 pr-2 text-right font-mono tabular-nums text-app-muted">
              {c.validatedTransactions}
            </td>
            <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-app-text">
              {formatCurrency(c.totalUsd, 'USD')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ----------------------------- subcomponents ----------------------------- */

interface StatCellProps {
  label: string
  value: string | number
  delta?: number | null
  invertDelta?: boolean
  hint?: string
  tone?: 'amber' | 'rose' | 'violet' | 'teal' | 'muted' | 'default'
  onClick?: () => void
}

function StatCell({
  label,
  value,
  delta,
  invertDelta,
  hint,
  tone = 'default',
  onClick,
}: StatCellProps) {
  // Paleta Binance contida: ênfases viram GOLD (marca), negativo usa o vermelho
  // unificado, alerta fica no am(ber)/gold. Sem violet/teal competindo.
  const valueCls =
    tone === 'amber'
      ? 'text-amber-500'
      : tone === 'rose'
        ? 'text-app-neg'
        : tone === 'violet'
          ? 'text-app-accent-text'
          : tone === 'teal'
            ? 'text-app-accent-text'
            : tone === 'muted'
              ? 'text-app-muted'
              : 'text-app-text'
  return (
    <div
      className={`stat-cell ${onClick ? 'is-clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={`font-mono text-[19px] font-semibold leading-none tabular-nums tracking-[-0.01em] ${valueCls}`}
        >
          {value}
        </span>
        {hint && (
          <span className="font-mono text-[10px] tabular-nums text-app-subtle">
            {hint}
          </span>
        )}
      </div>
      {delta !== undefined && delta !== null && (
        <div className="mt-1">
          <DeltaBadge value={delta} invert={invertDelta} />
        </div>
      )}
    </div>
  )
}

function DeltaBadge({ value, invert }: { value: number; invert?: boolean }) {
  if (!isFinite(value) || value === 0) {
    return (
      <span className="font-mono text-[10px] text-app-subtle">-</span>
    )
  }
  const positive = value > 0
  // Para deltas onde subir = ruim (ex: inválidos), invertemos a cor.
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

interface RankingRow {
  id: string
  rank: number
  primary: string
  secondary: string
  valueLines: string[]
}

function RankingList({
  title,
  icon: Icon,
  rows,
  onSeeAll,
  emptyText,
}: {
  title: string
  icon: typeof Trophy
  rows: RankingRow[]
  onSeeAll?: () => void
  emptyText: string
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="text-app-muted" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            {title}
          </h3>
        </div>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-[10px] font-medium text-app-muted hover:text-app-text"
          >
            ver tudo →
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] text-app-subtle">
          {emptyText}
        </div>
      ) : (
        <ul className="divide-y divide-app-border/60">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-app-elev/30"
            >
              <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-app-subtle">
                {String(r.rank).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-app-text">
                  {r.primary}
                </div>
                <div className="truncate text-[10px] text-app-subtle">
                  {r.secondary}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                {r.valueLines.length === 0 ? (
                  <span className="text-app-subtle">-</span>
                ) : (
                  r.valueLines.map((l, i) => (
                    <div key={i} className={i > 0 ? 'mt-0.5 text-app-subtle' : 'text-app-text'}>
                      {l}
                    </div>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
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
  // Mês de fechamento (comissão) é semanticamente DIFERENTE de janelas
  // relativas: fica num botão isolado. Ver feedback_month_filter_isolated.
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
        title="Mês de fechamento: base da comissão"
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

function ReasonList({
  buckets,
  total,
}: {
  buckets: { code: string; label: string; count: number }[]
  total: number
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1)
  return (
    <ul className="space-y-2">
      {buckets.map((b) => {
        const pct = total > 0 ? (b.count / total) * 100 : 0
        return (
          <li key={b.code}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-app-text">{b.label}</span>
              <span className="font-mono tabular-nums text-app-subtle">
                <span className="text-app-text">{b.count}</span>
                <span className="ml-1">· {pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-app-elev">
              <div
                className="h-full rounded-full bg-rose-500/70"
                style={{ width: `${(b.count / max) * 100}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-app-border px-3 py-5 text-center text-[11px] text-app-subtle">
      {text}
    </div>
  )
}

/* ------------------------------- helpers -------------------------------- */

function compactUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `$${(v / 1_000).toFixed(1)}k`
  return formatCurrency(v, 'USD')
}

/** Retorna o Date do dia 1 do mês deslocado em `offset` meses do mês atual. */
function monthDateFromOffset(offset: number): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + offset, 1)
}

function SetorFilterToggle({
  value,
  onChange,
}: {
  value: SetorFilter
  onChange: (v: SetorFilter) => void
}) {
  const opts: { v: SetorFilter; label: string }[] = [
    { v: 'all', label: 'Todos' },
    ...SETORES.map((s) => ({ v: s as SetorFilter, label: setorLabel[s] })),
  ]
  return (
    <div className="seg" role="tablist" aria-label="Filtro por setor">
      {opts.map((o) => (
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
  )
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

/**
 * Painel ao lado do gráfico de comissão histórica. Mostra:
 *  - Tendência (delta vs período anterior em USD)
 *  - Ativações elegíveis × pendentes × perdidas
 *  - Top 3 gestores em comissão no período
 *
 * Respeita o toggle global de "esconder valores" (balancesHidden).
 */
function CommissionInsightsPanel({
  summary,
  summaryPrev,
  topAgents,
  hidden,
}: {
  summary: ReturnType<typeof globalCommissionSummary>
  summaryPrev: ReturnType<typeof globalCommissionSummary>
  topAgents: ReturnType<typeof commissionByAgent>
  hidden: boolean
}) {
  const delta = summary.payableRawTotal - summaryPrev.payableRawTotal
  const pct =
    summaryPrev.payableRawTotal > 0
      ? (delta / summaryPrev.payableRawTotal) * 100
      : null
  const deltaTone =
    delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-app-muted'
  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
          Destaques
        </h3>
        <span className="text-[10px] text-app-subtle">em USD</span>
      </div>
      <div className="divide-y divide-app-border/60">
        <div className="px-4 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
            Tendência vs anterior
          </div>
          <div className={`mt-1 font-mono text-[16px] font-semibold tabular-nums ${deltaTone}`}>
            {hidden ? (
              <HiddenDots count={3} size="md" />
            ) : (
              <>
                {delta >= 0 ? '+' : '−'}
                {compactUsd(Math.abs(delta))}
                {pct !== null && (
                  <span className="ml-1 text-[11px] font-normal">
                    ({pct >= 0 ? '+' : ''}
                    {pct.toFixed(0)}%)
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
            Ativações no período
          </div>
          <div className="mt-1 flex items-baseline gap-3 font-mono text-[12px] tabular-nums">
            <span className="text-app-text">
              <span className="text-[14px] font-semibold">{summary.activations}</span> elegíveis
            </span>
            {summary.activationsPendingOperation > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {summary.activationsPendingOperation} aguardando
              </span>
            )}
            {summary.activationsNotEligible > 0 && (
              <span className="text-rose-600 dark:text-rose-400">
                {summary.activationsNotEligible} perdidas
              </span>
            )}
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
            Top gestores
          </div>
          {topAgents.length === 0 ? (
            <div className="text-[11px] text-app-subtle">
              Sem comissão no período.
            </div>
          ) : (
            <ul className="space-y-1">
              {topAgents.map((a, i) => (
                <li
                  key={a.agenteId}
                  className="flex items-baseline justify-between gap-2 text-[11px]"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="font-mono text-app-subtle">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate text-app-text">
                      {a.agenteName}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono font-semibold tabular-nums text-app-text">
                    {hidden ? (
                      <HiddenDots count={2} size="sm" />
                    ) : (
                      compactUsd(a.payableRawTotal)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

