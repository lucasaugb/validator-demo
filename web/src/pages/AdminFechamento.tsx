import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  Send,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { AdminFiltersInline } from '../components/AdminFiltersInline'
import { Modal } from '../components/Modal'
import {
  ACTIVATION_FIXED_USD,
  TRANSACTION_PCT,
  commissionByAgentForMonth,
  effectiveUsdAmount,
  globalCommissionSummary,
  type AgentCommission,
  type TransactionCommission,
} from '../lib/commission'
import {
  executeFechamento,
  previewFechamento,
  type CloseResponse,
  type PreviewResponse,
} from '../lib/fechamento'
import { formatCurrency, formatDateBR, formatMoney } from '../lib/format'
import { SETORES, finalStatus, setorLabel } from '../types'
import type { Transaction, Setor } from '../types'
import { UsdAmountChip } from '../components/UsdAmountChip'
import { SetorBadge } from '../components/SetorBadge'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  transactions: Transaction[]
}

type SetorFilter = Setor | 'all'

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
 * Fechamento de Competência: apuração mensal × setor.
 *
 * Estética: tabela contábil, não dashboard. Cada bloco é uma lista densa
 * com colunas (qtd | valor | atalho). Botão "Encerrar" embaixo.
 *
 * Bloqueio: ativações em `pending_operation` impedem encerrar (o 1% delas
 * fica indefinido até o sistema de origem confirmar primeira operação).
 */
export function AdminFechamento({ transactions }: Props) {
  const navigate = useNavigate()
  const { agente } = useAuth()
  const isSupervisor = agente?.role === 'supervisor'
  const canEncerrar = !isSupervisor // só admin/super_admin encerram competência
  const [{ year, month }, setView] = useState(() => {
    const now = new Date()
    // Default: mês anterior (regra natural de fechamento de competência).
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
    const prevYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    return { year: prevYear, month: prevMonth }
  })
  // Supervisor é travado no próprio setor (initial state). Não deve mudar.
  const [setor, setSetor] = useState<SetorFilter>(
    isSupervisor && agente?.setor ? agente.setor : 'all',
  )

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthLabel = `${MONTH_LABELS_LONG[month]} ${year}`

  // Recorte transacional: transactionDate dentro do mês + setor do agente. Usado
  // pra contagem de validados/pendentes/inválidos do mês (visão transacional).
  const inScope = useMemo(() => {
    return transactions.filter((d) => {
      if (!d.transactionDate) return false
      const [dy, dm] = d.transactionDate.split('-').map(Number)
      if (dy !== year || dm !== month + 1) return false
      if (setor === 'all') return true
      return d.agenteSetor === setor
    })
  }, [transactions, year, month, setor])

  // Recorte de COMISSÃO: precisa ver transações de qualquer mês porque o 1% de
  // ativações com primeira operação NESTE mês (mas transação anterior) também
  // entra. `commissionByAgentForMonth` faz essa atribuição corretamente.
  const setorScopedTransactions = useMemo(() => {
    if (setor === 'all') return transactions
    return transactions.filter((d) => d.agenteSetor === setor)
  }, [transactions, setor])

  // Partição por status: soma face-value em USD-equivalente.
  const partition = useMemo(() => computePartition(inScope), [inScope])
  const byAgent = useMemo(
    () => commissionByAgentForMonth(setorScopedTransactions, monthKey),
    [setorScopedTransactions, monthKey],
  )
  const summary = useMemo(() => globalCommissionSummary(byAgent), [byAgent])

  const pendingEdits = useMemo(
    () => inScope.filter((d) => d.pendingEdit),
    [inScope],
  )

  const isBlocked = summary.activationsPendingOperation > 0

  const now = new Date()
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth()
  const canForward = !isCurrentMonth

  const goPrev = () =>
    setView(({ year: y, month: m }) =>
      m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 },
    )
  const goNext = () =>
    setView(({ year: y, month: m }) =>
      m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 },
    )

  const goTransactions = (params: Record<string, string>) => {
    const q = new URLSearchParams(params)
    if (setor !== 'all') q.set('setor', setor)
    q.set('mes', monthKey)
    navigate(`/admin/transacoes?${q.toString()}`)
  }

  const setorTitle = setor === 'all' ? 'Todos os setores' : setorLabel[setor]

  // Comissão consolidada: sem deduções
  const pctConsolidated =
    summary.percentageByCurrency.USD +
    summary.percentageByCurrency.EUR +
    summary.percentageByCurrency.GBP
  const pendingPct =
    summary.pendingByCurrency.USD +
    summary.pendingByCurrency.EUR +
    summary.pendingByCurrency.GBP
  const lostPct =
    summary.notEligibleByCurrency.USD +
    summary.notEligibleByCurrency.EUR +
    summary.notEligibleByCurrency.GBP

  return (
    <>
      <PageHeader
        title="Fechamento de Competência"
        subtitle={`${monthLabel} · ${setorTitle}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav
              monthLabel={monthLabel}
              onPrev={goPrev}
              onNext={goNext}
              canForward={canForward}
            />
            {!isSupervisor && (
              <SetorToggle value={setor} onChange={setSetor} />
            )}
            <AdminFiltersInline />
          </div>
        }
      />

      {/* TRANSAÇÕES DO MÊS */}
      <Section title="Transações do mês" hint={`${inScope.length} no total`}>
        <LedgerTable>
          <LedgerRow
            dot="emerald"
            label="Validados"
            sublabel="entram na comissão"
            qty={partition.validated.count}
            value={partition.validated.usd}
            onClick={() => goTransactions({ filter: 'verified' })}
          />
          <LedgerRow
            dot="amber"
            label="Pendentes de validação"
            sublabel="aguardando source"
            qty={partition.pending.count}
            value={partition.pending.usd}
            onClick={() => goTransactions({ filter: 'system_pending' })}
            disabledClick={partition.pending.count === 0}
          />
          <LedgerRow
            dot="rose"
            label="Inválidos"
            sublabel="rejeitados pelo sistema"
            qty={partition.invalid.count}
            value={partition.invalid.usd}
            onClick={() => goTransactions({ filter: 'invalid' })}
            disabledClick={partition.invalid.count === 0}
          />
          <LedgerRow
            dot="amber"
            label="Ativações aguardando operação"
            sublabel="travam o fechamento"
            qty={summary.activationsPendingOperation}
            value={null}
            valueOverride={
              summary.activationsPendingOperation > 0
                ? '1% indefinido'
                : '-'
            }
            onClick={() => goTransactions({ filter: 'pending_op' })}
            disabledClick={summary.activationsPendingOperation === 0}
            isBlocker={summary.activationsPendingOperation > 0}
          />
        </LedgerTable>
      </Section>

      {/* COMISSÃO A PAGAR */}
      <Section
        title="Composição da comissão"
        hint={`${summary.agentsWithCommission} gestor${summary.agentsWithCommission === 1 ? '' : 'es'} com valor`}
      >
        <LedgerTable>
          <LedgerRow
            label={`Bônus de ativação`}
            sublabel={`${summary.activations} × $${ACTIVATION_FIXED_USD}`}
            qty={summary.activations}
            value={summary.fixedUsdTotal}
          />
          <LedgerRow
            label={`${TRANSACTION_PCT * 100}% atribuído ao mês`}
            sublabel="comuns do mês + 1% de ativações com 1ª op neste mês"
            qty={null}
            value={pctConsolidated}
          />
          <LedgerTotal label="Total a pagar" value={summary.payableRawTotal} />
          {(pendingPct > 0 || lostPct > 0) && (
            <>
              <LedgerSpacer />
              {pendingPct > 0 && (
                <LedgerRow
                  tone="muted"
                  label="Represado (aguardando op.)"
                  sublabel="entra na próxima competência"
                  qty={summary.activationsPendingOperation}
                  value={pendingPct}
                  valueTone="amber"
                />
              )}
              {lostPct > 0 && (
                <LedgerRow
                  tone="muted"
                  label="Perdido (não elegível)"
                  sublabel="cliente operou antes / não operou"
                  qty={summary.activationsNotEligible}
                  value={lostPct}
                  valueTone="rose"
                />
              )}
            </>
          )}
        </LedgerTable>
      </Section>

      {/* EXTRATOS POR AGENTE: formato do PDF que será enviado */}
      <ExtractsSection
        byAgent={byAgent}
        monthLabel={monthLabel}
        setor={setor}
        onGoAgent={(agenteId) => goTransactions({ agente: agenteId })}
      />

      {/* AVISOS: só se tem edição pendente */}
      {pendingEdits.length > 0 && (
        <div className="mt-3 flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2.5">
          <AlertTriangle
            size={12}
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <div className="flex-1 text-[11px]">
            <span className="font-medium text-amber-700 dark:text-amber-300">
              {pendingEdits.length} edição{pendingEdits.length === 1 ? '' : 'ões'} aguardando aprovação
            </span>
            <span className="text-app-muted">
              {' '}
              · pode mudar a comissão consolidada
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin/edicoes')}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-semibold text-app-text transition-colors hover:bg-app-elev"
          >
            Revisar
            <ArrowRight size={10} />
          </button>
        </div>
      )}

      {/* ENCERRAMENTO: só admin/super_admin */}
      {canEncerrar ? (
        <ClosurePanel
          isBlocked={isBlocked}
          pendingOpCount={summary.activationsPendingOperation}
          month={monthKey}
          monthLabel={monthLabel}
          setor={setor}
          setorLabel={setorTitle}
        />
      ) : (
        <SupervisorClosureNotice />
      )}
    </>
  )
}

/**
 * Aviso que aparece pro supervisor no lugar do botão "Encerrar competência".
 * Encerrar é prerrogativa do admin (envia DMs no Slack, gera PDF, etc.).
 */
function SupervisorClosureNotice() {
  return (
    <div className="panel mt-3 overflow-hidden">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <Lock
          size={13}
          className="mt-0.5 shrink-0 text-app-subtle"
          aria-hidden
        />
        <div className="text-[11.5px]">
          <div className="font-medium text-app-text">
            Encerramento restrito ao administrador
          </div>
          <div className="mt-0.5 text-app-subtle">
            Apuração visível, mas o envio dos PDFs por Slack é feito por um
            admin global.
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------- closure panel + confirm modal -------------------- */

function ClosurePanel({
  isBlocked,
  pendingOpCount,
  month,
  monthLabel,
  setor,
  setorLabel,
}: {
  isBlocked: boolean
  pendingOpCount: number
  month: string
  monthLabel: string
  setor: SetorFilter
  setorLabel: string
}) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div className="panel mt-3 overflow-hidden">
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            {isBlocked ? (
              <Clock
                size={13}
                className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
            ) : (
              <CheckCircle2
                size={13}
                className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              />
            )}
            <div className="text-[11.5px]">
              <span
                className={`font-medium ${
                  isBlocked
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {isBlocked
                  ? 'Competência bloqueada'
                  : 'Competência pronta para encerrar'}
              </span>
              <div className="mt-0.5 text-app-subtle">
                {isBlocked
                  ? `${pendingOpCount} ativação${pendingOpCount === 1 ? '' : 'ões'} ainda sem confirmação de operação na origem.`
                  : 'Cada gestor receberá uma DM no Slack com o PDF do extrato.'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={isBlocked}
            title={
              isBlocked
                ? `${pendingOpCount} ativação(ões) aguardando operação`
                : 'Abrir confirmação de envio'
            }
            className={
              isBlocked
                ? 'inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-app-border bg-app-elev/60 px-3 py-1.5 text-[11px] font-semibold text-app-muted'
                : 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold btn-accent'
            }
          >
            {isBlocked ? <Lock size={11} /> : <Send size={11} />}
            Encerrar competência
          </button>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Encerrar competência"
        subtitle={`${monthLabel} · ${setorLabel}`}
        width="2xl"
      >
        <ClosureModalBody
          month={month}
          monthLabel={monthLabel}
          setor={setor}
          onClose={() => setModalOpen(false)}
        />
      </Modal>
    </>
  )
}

type ModalPhase = 'loading' | 'preview' | 'sending' | 'done' | 'error'

function ClosureModalBody({
  month,
  monthLabel,
  setor,
  onClose,
}: {
  month: string
  monthLabel: string
  setor: SetorFilter
  onClose: () => void
}) {
  const [phase, setPhase] = useState<ModalPhase>('loading')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [result, setResult] = useState<CloseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Carrega preview ao abrir
  useState(() => {
    previewFechamento(month, setor)
      .then((p) => {
        setPreview(p)
        setPhase('preview')
      })
      .catch((e: Error) => {
        setError(e.message)
        setPhase('error')
      })
  })

  const confirm = async () => {
    setPhase('sending')
    setError(null)
    try {
      const r = await executeFechamento(month, setor)
      setResult(r)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar')
      setPhase('error')
    }
  }

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-app-muted">
        <Loader2 size={14} className="animate-spin" />
        Carregando apuração…
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11.5px]">
          <div className="flex items-start gap-2">
            <XCircle
              size={13}
              className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400"
            />
            <div>
              <div className="font-medium text-rose-700 dark:text-rose-300">
                Falha ao processar fechamento
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-app-muted">
                {error}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-md border border-app-border bg-app-card px-3 py-1.5 text-[11px] font-semibold text-app-text transition-colors hover:bg-app-elev"
          >
            Fechar
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done' && result) {
    return <ClosureResultView result={result} onClose={onClose} />
  }

  if (!preview) return null

  return (
    <ClosurePreviewView
      preview={preview}
      monthLabel={monthLabel}
      phase={phase}
      onConfirm={confirm}
      onClose={onClose}
    />
  )
}

function ClosurePreviewView({
  preview,
  monthLabel,
  phase,
  onConfirm,
  onClose,
}: {
  preview: PreviewResponse
  monthLabel: string
  phase: ModalPhase
  onConfirm: () => void
  onClose: () => void
}) {
  const sending = phase === 'sending'
  const willReceive = preview.agents.filter((a) => a.hasSlackId)
  const willSkip = preview.agents.filter((a) => !a.hasSlackId)
  const canSend = preview.canClose && willReceive.length > 0

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="rounded-md border border-app-border bg-app-elev/30 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-app-muted">
          Resumo do envio
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-5">
          <SummaryStat label="Gestores c/ DM" value={preview.agentsWithSlack} />
          <SummaryStat
            label="Sem Slack"
            value={preview.agentsWithoutSlack}
            tone={preview.agentsWithoutSlack > 0 ? 'amber' : undefined}
          />
          <SummaryStat
            label="Admins c/ resumo"
            value={preview.adminsWithSlack}
            hint={
              preview.adminsWithoutSlack > 0
                ? `+${preview.adminsWithoutSlack} sem slack`
                : undefined
            }
          />
          <SummaryStat
            label="Supervisores c/ resumo"
            value={preview.supervisorsWithSlack}
            hint={
              preview.supervisorsWithoutSlack > 0
                ? `+${preview.supervisorsWithoutSlack} sem slack`
                : undefined
            }
          />
          <SummaryStat
            label="Total a pagar"
            value={formatMoney(preview.totalPayable)}
            mono
          />
        </div>
      </div>

      {/* Lista de quem recebe */}
      {willReceive.length > 0 && (
        <Block title={`Recebem PDF (${willReceive.length})`}>
          <ul className="divide-y divide-app-border/60">
            {willReceive.map((a) => (
              <li
                key={a.agenteId}
                className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-app-text">
                    {a.agenteName}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-app-subtle">
                    {a.validatedTransactions} validado{a.validatedTransactions === 1 ? '' : 's'} ·{' '}
                    {a.activations} ativ
                    {a.setor && ` · ${setorLabelOf(a.setor)}`}
                  </div>
                </div>
                <div className="font-mono text-[12px] font-semibold tabular-nums text-app-text">
                  {formatMoney(a.payableRawTotal)}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Lista de quem fica fora */}
      {willSkip.length > 0 && (
        <Block
          title={`Pulados: sem Slack ID (${willSkip.length})`}
          tone="amber"
        >
          <ul className="divide-y divide-app-border/60">
            {willSkip.map((a) => (
              <li
                key={a.agenteId}
                className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-app-text">
                    {a.agenteName}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-app-subtle">
                    cadastre o Slack ID em /admin/agentes pra incluir
                  </div>
                </div>
                <div className="font-mono text-[12px] font-semibold tabular-nums text-app-muted">
                  {formatMoney(a.payableRawTotal)}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Admins que recebem o resumo administrativo */}
      {preview.admins.length > 0 && (
        <Block title={`Resumo administrativo (${preview.admins.length})`}>
          <ul className="divide-y divide-app-border/60">
            {preview.admins.map((adm) => (
              <li
                key={adm.uid}
                className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-app-text">
                    {adm.name}
                    <span className="ml-2 rounded bg-app-elev px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-app-muted">
                      {adm.role === 'super_admin' ? 'super admin' : 'admin'}
                    </span>
                  </div>
                  <div className="text-[10px] text-app-subtle">
                    {adm.hasSlackId
                      ? 'recebe PDF consolidado por DM'
                      : 'sem Slack ID: não será notificado'}
                  </div>
                </div>
                <div
                  className={`font-mono text-[10.5px] uppercase tracking-[0.1em] ${
                    adm.hasSlackId
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {adm.hasSlackId ? 'OK' : 'pendente'}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Supervisores recebem o resumo FILTRADO pelo setor deles */}
      {preview.supervisors.length > 0 && (
        <Block title={`Supervisores notificados (${preview.supervisors.length})`}>
          <ul className="divide-y divide-app-border/60">
            {preview.supervisors.map((sup) => (
              <li
                key={sup.uid}
                className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-app-text">
                    {sup.name}
                    <span className="ml-2 rounded border border-teal-500/30 bg-teal-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-teal-700 dark:text-teal-300">
                      supervisor · {setorLabelOf(sup.setor)}
                    </span>
                  </div>
                  <div className="text-[10px] text-app-subtle">
                    {sup.hasSlackId
                      ? `recebe PDF do setor ${setorLabelOf(sup.setor)} por DM`
                      : 'sem Slack ID: não será notificado'}
                  </div>
                </div>
                <div
                  className={`font-mono text-[10.5px] uppercase tracking-[0.1em] ${
                    sup.hasSlackId
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {sup.hasSlackId ? 'OK' : 'pendente'}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Aviso de bloqueio */}
      {!preview.canClose && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-[11.5px]">
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={13}
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <div>
              <div className="font-medium text-amber-700 dark:text-amber-300">
                {preview.pendingOperationCount} ativação{preview.pendingOperationCount === 1 ? '' : 'ões'} aguardando operação
              </div>
              <div className="mt-0.5 text-app-muted">
                Resolva nos Registros antes de encerrar a competência.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ações */}
      <div className="flex items-center justify-between gap-3 border-t border-app-border pt-3">
        <div className="text-[10.5px] text-app-subtle">
          Ao confirmar, cada gestor da lista recebe uma DM no Slack com o PDF
          do extrato de {monthLabel}.
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="inline-flex items-center rounded-md border border-app-border bg-app-card px-3 py-1.5 text-[11px] font-semibold text-app-text transition-colors hover:bg-app-elev disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSend || sending}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold btn-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Enviando…
              </>
            ) : (
              <>
                <Send size={11} />
                Confirmar e enviar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClosureResultView({
  result,
  onClose,
}: {
  result: CloseResponse
  onClose: () => void
}) {
  const okAll =
    result.errorCount === 0 &&
    result.adminErrorCount === 0 &&
    result.supervisorErrorCount === 0
  return (
    <div className="space-y-4">
      <div
        className={`rounded-md border px-4 py-3 ${
          okAll
            ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
            : 'border-amber-500/30 bg-amber-500/[0.06]'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {okAll ? (
            <CheckCircle2
              size={14}
              className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            />
          )}
          <div>
            <div
              className={`font-semibold ${
                okAll
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {okAll ? 'Fechamento enviado' : 'Enviado parcialmente'}
            </div>
            <div className="mt-0.5 text-[11.5px] text-app-muted">
              Gestores: {result.sentCount} entregue
              {result.sentCount === 1 ? '' : 's'} ·{' '}
              {result.skippedCount} pulado{result.skippedCount === 1 ? '' : 's'} ·{' '}
              {result.errorCount} erro{result.errorCount === 1 ? '' : 's'}
              <br />
              Admins: {result.adminSentCount} resumo
              {result.adminSentCount === 1 ? '' : 's'} ·{' '}
              {result.adminSkippedCount} pulado{result.adminSkippedCount === 1 ? '' : 's'} ·{' '}
              {result.adminErrorCount} erro{result.adminErrorCount === 1 ? '' : 's'}
              <br />
              Supervisores: {result.supervisorSentCount} resumo
              {result.supervisorSentCount === 1 ? '' : 's'} ·{' '}
              {result.supervisorSkippedCount} pulado{result.supervisorSkippedCount === 1 ? '' : 's'} ·{' '}
              {result.supervisorErrorCount} erro{result.supervisorErrorCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </div>

      {result.sent.length > 0 && (
        <Block title={`Gestores notificados (${result.sent.length})`}>
          <ul className="divide-y divide-app-border/60 text-[11.5px]">
            {result.sent.map((s) => (
              <li
                key={s.agenteId}
                className="flex items-center justify-between gap-3 px-4 py-1.5"
              >
                <span className="truncate text-app-text">
                  {s.agenteName}
                  <span className="ml-2 font-mono text-[9.5px] text-app-subtle">
                    {s.slackUserId}
                  </span>
                </span>
                <span className="font-mono text-app-text tabular-nums">
                  {formatMoney(s.payableTotal)}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {result.adminSent.length > 0 && (
        <Block title={`Admins com resumo (${result.adminSent.length})`}>
          <ul className="divide-y divide-app-border/60 text-[11.5px]">
            {result.adminSent.map((s) => (
              <li
                key={s.uid}
                className="flex items-center justify-between gap-3 px-4 py-1.5"
              >
                <span className="truncate text-app-text">
                  {s.name}
                  <span className="ml-2 rounded bg-app-elev px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-app-muted">
                    {s.role === 'super_admin' ? 'super' : 'admin'}
                  </span>
                  <span className="ml-2 font-mono text-[9.5px] text-app-subtle">
                    {s.slackUserId}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {result.supervisorSent.length > 0 && (
        <Block title={`Supervisores com resumo (${result.supervisorSent.length})`}>
          <ul className="divide-y divide-app-border/60 text-[11.5px]">
            {result.supervisorSent.map((s) => (
              <li
                key={s.uid}
                className="flex items-center justify-between gap-3 px-4 py-1.5"
              >
                <span className="truncate text-app-text">
                  {s.name}
                  <span className="ml-2 rounded border border-teal-500/30 bg-teal-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-teal-700 dark:text-teal-300">
                    {setorLabelOf(s.setor)}
                  </span>
                  <span className="ml-2 font-mono text-[9.5px] text-app-subtle">
                    {s.slackUserId}
                  </span>
                </span>
                <span className="font-mono text-[9.5px] tabular-nums text-app-muted">
                  {s.agentCount} gestor{s.agentCount === 1 ? '' : 'es'}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {result.supervisorErrors.length > 0 && (
        <Block title={`Erros: supervisores (${result.supervisorErrors.length})`} tone="rose">
          <ul className="divide-y divide-app-border/60 text-[11.5px]">
            {result.supervisorErrors.map((e, i) => (
              <li key={i} className="px-4 py-1.5">
                <div className="text-app-text">
                  {e.name}
                  <span className="ml-2 text-[9.5px] text-app-subtle">
                    {setorLabelOf(e.setor)}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-rose-600 dark:text-rose-400">
                  {e.error}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {result.errors.length > 0 && (
        <Block title={`Erros: gestores (${result.errors.length})`} tone="rose">
          <ul className="divide-y divide-app-border/60 text-[11.5px]">
            {result.errors.map((e, i) => (
              <li key={i} className="px-4 py-1.5">
                <div className="text-app-text">{e.agenteName}</div>
                <div className="font-mono text-[10px] text-rose-600 dark:text-rose-400">
                  {e.error}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {result.adminErrors.length > 0 && (
        <Block title={`Erros: admins (${result.adminErrors.length})`} tone="rose">
          <ul className="divide-y divide-app-border/60 text-[11.5px]">
            {result.adminErrors.map((e, i) => (
              <li key={i} className="px-4 py-1.5">
                <div className="text-app-text">{e.name}</div>
                <div className="font-mono text-[10px] text-rose-600 dark:text-rose-400">
                  {e.error}
                </div>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <div className="flex justify-end border-t border-app-border pt-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-semibold btn-accent"
        >
          Fechar
        </button>
      </div>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tone,
  mono,
  hint,
}: {
  label: string
  value: string | number
  tone?: 'amber' | 'rose'
  mono?: boolean
  hint?: string
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'rose'
        ? 'text-rose-700 dark:text-rose-300'
        : 'text-app-text'
  return (
    <div>
      <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-app-subtle">
        {label}
      </div>
      <div
        className={`mt-0.5 ${mono ? 'font-mono tabular-nums' : ''} text-[14px] font-semibold ${cls}`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[9.5px] text-app-subtle">{hint}</div>
      )}
    </div>
  )
}

function Block({
  title,
  tone,
  children,
}: {
  title: string
  tone?: 'amber' | 'rose'
  children: React.ReactNode
}) {
  const headCls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'rose'
        ? 'text-rose-700 dark:text-rose-300'
        : 'text-app-muted'
  return (
    <div className="overflow-hidden rounded-md border border-app-border bg-app-card">
      <div
        className={`border-b border-app-border bg-app-elev/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] ${headCls}`}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function setorLabelOf(s: string): string {
  return setorLabel[s as Setor] ?? s
}

/* -------------------- partição por status -------------------- */

interface PartitionBucket {
  count: number
  usd: number
}
interface Partition {
  validated: PartitionBucket
  pending: PartitionBucket
  invalid: PartitionBucket
}

function computePartition(transactions: Transaction[]): Partition {
  const out: Partition = {
    validated: { count: 0, usd: 0 },
    pending: { count: 0, usd: 0 },
    invalid: { count: 0, usd: 0 },
  }
  for (const d of transactions) {
    const usd = effectiveUsdAmount(d)
    const s = finalStatus(d)
    if (s === 'validated') {
      out.validated.count += 1
      out.validated.usd += usd
    } else if (d.systemValidation === 'invalid' || d.systemValidation === 'duplicate') {
      out.invalid.count += 1
      out.invalid.usd += usd
    } else {
      out.pending.count += 1
      out.pending.usd += usd
    }
  }
  return out
}

/* -------------------- ledger primitives -------------------- */

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="panel mt-3 overflow-hidden">
      <div className="panel-head">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
          {title}
        </h3>
        {hint && (
          <span className="font-mono text-[10px] tabular-nums text-app-subtle">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function LedgerTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full text-[12px]">
      <tbody className="divide-y divide-app-border/60">{children}</tbody>
    </table>
  )
}

function LedgerRow({
  dot,
  label,
  sublabel,
  qty,
  value,
  valueOverride,
  valueTone,
  tone,
  onClick,
  disabledClick,
  isBlocker,
}: {
  dot?: 'emerald' | 'amber' | 'rose'
  label: string
  sublabel?: string
  qty: number | null
  value: number | null
  valueOverride?: string
  valueTone?: 'amber' | 'rose'
  tone?: 'muted'
  onClick?: () => void
  disabledClick?: boolean
  isBlocker?: boolean
}) {
  const dotCls =
    dot === 'emerald'
      ? 'bg-emerald-500'
      : dot === 'amber'
        ? 'bg-amber-500'
        : dot === 'rose'
          ? 'bg-rose-500'
          : ''
  const labelCls =
    tone === 'muted' ? 'text-app-muted' : 'text-app-text'
  const valueCls =
    valueTone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : valueTone === 'rose'
        ? 'text-rose-600 dark:text-rose-400'
        : tone === 'muted'
          ? 'text-app-muted'
          : 'text-app-text'
  const showAction = onClick && !disabledClick
  return (
    <tr
      className={`transition-colors ${showAction ? 'cursor-pointer hover:bg-app-elev/40' : ''}`}
      onClick={showAction ? onClick : undefined}
    >
      <td className="w-6 px-4 py-2.5">
        {dot && (
          <span
            className={`inline-block h-2 w-2 rounded-full ${dotCls}`}
            aria-hidden
          />
        )}
      </td>
      <td className="py-2.5 pr-3">
        <div className={`text-[12px] ${labelCls}`}>
          {label}
          {isBlocker && (
            <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-300">
              bloqueia
            </span>
          )}
        </div>
        {sublabel && (
          <div className="mt-0.5 text-[10.5px] text-app-subtle">{sublabel}</div>
        )}
      </td>
      <td className="w-20 px-3 py-2.5 text-right font-mono text-[11px] tabular-nums text-app-muted">
        {qty != null ? qty : ''}
      </td>
      <td
        className={`w-28 px-3 py-2.5 text-right font-mono text-[13px] font-semibold tabular-nums ${valueCls}`}
      >
        {valueOverride != null
          ? valueOverride
          : value != null
            ? formatMoney(value)
            : '-'}
      </td>
      <td className="w-8 pr-3 text-right">
        {showAction && (
          <ArrowRight size={11} className="inline text-app-subtle" />
        )}
      </td>
    </tr>
  )
}

function LedgerTotal({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-t border-app-border bg-app-elev/40">
      <td className="px-4 py-2.5" />
      <td className="py-2.5 pr-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-app-text">
          {label}
        </div>
      </td>
      <td />
      <td className="px-3 py-2.5 text-right font-mono text-[15px] font-semibold tabular-nums text-app-text">
        {formatMoney(value)}
      </td>
      <td />
    </tr>
  )
}

function LedgerSpacer() {
  return (
    <tr>
      <td colSpan={5} className="py-1" />
    </tr>
  )
}

/* -------------------- extratos por gestor (modelo do PDF) -------------------- */

/**
 * Seção que renderiza um EXTRATO por gestor, formato idêntico ao PDF que
 * será enviado por DM. Header compacto sempre visível; clica e abre o extrato
 * completo (tabela linha-a-linha + subtotais + total).
 */
function ExtractsSection({
  byAgent,
  monthLabel,
  setor,
  onGoAgent,
}: {
  byAgent: AgentCommission[]
  monthLabel: string
  setor: SetorFilter
  onGoAgent: (agenteId: string) => void
}) {
  // Default: tudo RECOLHIDO (decisão 2026-06-02). O extrato de cada gestor é
  // denso, então a tela abre limpa e o usuário expande o que quiser. "Expandir
  // todos" continua disponível pra abrir tudo de uma vez.
  const [openAll, setOpenAll] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (openAll) {
      setOpenIds(new Set(byAgent.map((a) => a.agenteId)))
    }
  }, [byAgent, openAll])

  const toggleOne = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (openAll) {
      setOpenAll(false)
      setOpenIds(new Set())
    } else {
      setOpenAll(true)
      setOpenIds(new Set(byAgent.map((a) => a.agenteId)))
    }
  }

  return (
    <div className="panel mt-3 overflow-hidden">
      <div className="panel-head">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
          Extratos por gestor
        </h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-app-subtle">
            {byAgent.length === 0
              ? 'sem movimentação'
              : `${byAgent.length} ${byAgent.length === 1 ? 'gestor' : 'gestores'}`}
          </span>
          {byAgent.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
            >
              {openAll ? 'Recolher todos' : 'Expandir todos'}
            </button>
          )}
        </div>
      </div>

      {byAgent.length === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] text-app-subtle">
          Nenhum gestor registrou validação em {monthLabel}
          {setor !== 'all' ? ` · ${setorLabel[setor]}` : ''}.
        </div>
      ) : (
        <ul className="divide-y divide-app-border/60">
          {byAgent.map((a) => (
            <AgentExtract
              key={a.agenteId}
              agent={a}
              monthLabel={monthLabel}
              open={openIds.has(a.agenteId)}
              onToggle={() => toggleOne(a.agenteId)}
              onGo={() => onGoAgent(a.agenteId)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Um único extrato: formato fechamento financeiro:
 *   Header (sempre visível): agente · setor · subtotais inline
 *   Corpo (expandido): tabela com cada transação + breakdown + linha de total
 */
function AgentExtract({
  agent: a,
  monthLabel,
  open,
  onToggle,
  onGo,
}: {
  agent: AgentCommission
  monthLabel: string
  open: boolean
  onToggle: () => void
  onGo: () => void
}) {
  const hasPending = a.activationsPendingOperation > 0
  const pctSum =
    a.percentageByCurrency.USD +
    a.percentageByCurrency.EUR +
    a.percentageByCurrency.GBP
  const pendingSum =
    a.pendingByCurrency.USD +
    a.pendingByCurrency.EUR +
    a.pendingByCurrency.GBP
  const lostSum =
    a.notEligibleByCurrency.USD +
    a.notEligibleByCurrency.EUR +
    a.notEligibleByCurrency.GBP

  return (
    <li>
      {/* Header: sempre visível */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-app-elev/40"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-app-subtle transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[12.5px] font-semibold text-app-text">
              {a.agenteName}
            </span>
            {a.setor && <SetorBadge setor={a.setor} size="xs" />}
            {hasPending && (
              <span className="rounded bg-amber-500/15 px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-300">
                aguarda
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-app-subtle">
            {a.validatedTransactions} validado{a.validatedTransactions === 1 ? '' : 's'} ·{' '}
            {a.activations} ativ
            {hasPending && ` · ${a.activationsPendingOperation} aguardando`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[13px] font-semibold tabular-nums text-app-text">
            {formatMoney(a.payableRawTotal)}
          </div>
          <div className="text-[9.5px] uppercase tracking-[0.1em] text-app-subtle">
            a pagar
          </div>
        </div>
      </button>

      {/* Corpo: só quando expandido */}
      {open && (
        <div className="border-t border-app-border bg-app-elev/30 px-4 py-3">
          {/* Cabeçalho do extrato (estilo PDF) */}
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-app-muted">
              Extrato de comissão · {monthLabel}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onGo()
              }}
              className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
            >
              Ver registros
              <ArrowRight size={9} />
            </button>
          </div>

          {/* Tabela de transações */}
          <div className="overflow-hidden rounded-md border border-app-border bg-app-card">
            <table className="w-full text-[11px]">
              <thead className="border-b border-app-border bg-app-elev/60 text-[9px] uppercase tracking-[0.1em] text-app-subtle">
                <tr>
                  <ExTh className="w-12 text-left">#</ExTh>
                  <ExTh className="w-20 text-left">Data</ExTh>
                  <ExTh className="text-left">Cliente · Conta</ExTh>
                  <ExTh className="w-24 text-right">Valor</ExTh>
                  <ExTh className="w-16 text-left">Tipo</ExTh>
                  <ExTh className="w-28 text-right">Comissão</ExTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60">
                {a.rows.map(({ transaction: d, commission: c }) => (
                  <tr
                    key={d.id}
                    className="transition-colors hover:bg-app-elev/30"
                  >
                    <ExTd className="font-mono tabular-nums text-app-text">
                      #{d.transactionNumber ?? '-'}
                    </ExTd>
                    <ExTd className="font-mono tabular-nums text-app-muted">
                      {formatDateBR(d.transactionDate)}
                    </ExTd>
                    <ExTd>
                      <div className="max-w-[200px] truncate text-app-text">
                        {d.clientName}
                      </div>
                      <div className="font-mono text-[9px] text-app-subtle">
                        {d.clientId}
                      </div>
                    </ExTd>
                    <ExTd className="text-right">
                      <div className="font-mono tabular-nums text-app-text">
                        {formatCurrency(d.amount, d.currency)}
                      </div>
                      <UsdAmountChip transaction={d} />
                    </ExTd>
                    <ExTd>
                      {d.isActivation ? (
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300">
                          ativação
                        </span>
                      ) : (
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-app-muted">
                          comum
                        </span>
                      )}
                    </ExTd>
                    <ExTd className="text-right">
                      <ExtractCommissionAmount c={c} />
                    </ExTd>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-app-border">
                <ExFooterRow
                  label="Bônus de ativação"
                  sublabel={`${a.activations} × $${ACTIVATION_FIXED_USD}`}
                  value={formatMoney(a.fixedUsd)}
                />
                <ExFooterRow
                  label={`${TRANSACTION_PCT * 100}% sobre volume`}
                  sublabel="elegíveis"
                  value={pctSum > 0 ? formatMoney(pctSum) : '-'}
                />
                {pendingSum > 0 && (
                  <ExFooterRow
                    label="Aguardando operação"
                    sublabel={`${a.activationsPendingOperation} ativ · 1% represado`}
                    value={formatMoney(pendingSum)}
                    tone="amber"
                  />
                )}
                {lostSum > 0 && (
                  <ExFooterRow
                    label="Não elegível"
                    sublabel={`${a.activationsNotEligible} ativ · 1% perdido`}
                    value={formatMoney(lostSum)}
                    tone="rose"
                  />
                )}
                <tr className="border-t-2 border-app-border-strong bg-app-elev/60">
                  <td colSpan={4} className="px-3 py-2.5">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-app-text">
                      Total a pagar
                    </div>
                  </td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right font-mono text-[14px] font-semibold tabular-nums text-app-text">
                    {formatMoney(a.payableRawTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </li>
  )
}

function ExTh({
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

function ExTd({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 align-top ${className ?? ''}`}
    >
      {children}
    </td>
  )
}

function ExFooterRow({
  label,
  sublabel,
  value,
  tone,
}: {
  label: string
  sublabel?: string
  value: string
  tone?: 'amber' | 'rose'
}) {
  const labelCls = 'text-app-muted'
  const valueCls =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'rose'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-app-text'
  return (
    <tr>
      <td colSpan={4} className="px-3 py-1.5">
        <div className={`text-[10.5px] ${labelCls}`}>
          {label}
          {sublabel && (
            <span className="ml-2 text-[9.5px] text-app-subtle">
              {sublabel}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-1.5" />
      <td
        className={`px-3 py-1.5 text-right font-mono text-[11px] tabular-nums ${valueCls}`}
      >
        {value}
      </td>
    </tr>
  )
}

function ExtractCommissionAmount({ c }: { c: TransactionCommission }) {
  if (c.status === 'not_validated') {
    return <span className="text-app-subtle">-</span>
  }
  const lines: { value: string; cls: string }[] = []
  if (c.fixedUsd > 0) {
    lines.push({
      value: `+${formatCurrency(c.fixedUsd, 'USD')}`,
      cls: 'font-mono tabular-nums text-violet-700 dark:text-violet-300',
    })
  }
  if (c.status === 'eligible' && c.percentage > 0) {
    lines.push({
      value: `+${formatCurrency(c.percentage, 'USD')}`,
      cls: 'font-mono tabular-nums text-app-text',
    })
  } else if (c.status === 'pending_operation') {
    lines.push({
      value: 'aguard. 1%',
      cls: 'font-mono text-[9.5px] uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400',
    })
  } else if (c.status === 'not_eligible') {
    lines.push({
      value: '1% perdido',
      cls: 'font-mono text-[9.5px] uppercase tracking-[0.1em] text-rose-500 line-through',
    })
  }
  if (lines.length === 0) lines.push({ value: '-', cls: 'text-app-subtle' })
  return (
    <div>
      {lines.map((l, i) => (
        <div key={i} className={l.cls}>
          {l.value}
        </div>
      ))}
    </div>
  )
}


/* -------------------- header controls -------------------- */

function MonthNav({
  monthLabel,
  onPrev,
  onNext,
  canForward,
}: {
  monthLabel: string
  onPrev: () => void
  onNext: () => void
  canForward: boolean
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-1 py-1">
      <button
        type="button"
        onClick={onPrev}
        title="Mês anterior"
        className="flex h-6 w-6 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
      >
        <ChevronLeft size={13} />
      </button>
      <span className="min-w-[120px] text-center font-mono text-[11px] font-semibold tabular-nums text-app-text">
        {monthLabel}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!canForward}
        title={canForward ? 'Próximo mês' : 'Mês atual'}
        className="flex h-6 w-6 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight size={13} />
      </button>
    </div>
  )
}

function SetorToggle({
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
    <div className="seg" role="tablist">
      {opts.map((o) => (
        <button
          key={o.v}
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

