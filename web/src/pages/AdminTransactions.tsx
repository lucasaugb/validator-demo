import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Calendar, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { AdminFiltersInline } from '../components/AdminFiltersInline'
import { TransactionList } from '../components/TransactionList'
import { Modal } from '../components/Modal'
import { TransactionDetails } from '../components/TransactionDetails'
import { TransactionEditForm } from '../components/TransactionEditForm'
import { deleteTransaction } from '../lib/transactions'
import { CURRENCIES, SETORES, finalStatus, setorLabel, setoresInScope } from '../types'
import type { Currency, Transaction, Setor } from '../types'
import { isOutsidePartner } from '../lib/partner'
import { tribeLabel, tribeOf } from '../lib/pipedrive'
import type { TribeClassification } from '../lib/pipedrive'
import { commissionForTransaction } from '../lib/commission'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  transactions: Transaction[]
}

// Filtro do status de validação (sistema + conversa). Independente do filtro
// de ativação: assim o usuário pode combinar "ativações" + "inválidos" pra
// caçar ativações que o sistema invalidou, etc.
//
// `verified` = sistema verified (independe da conversa). `validated` = strict
// (sistema verified + conversa approved). Os 2 ficam separados pra distinguir
// "o sistema confirmou" de "tudo aprovado pra comissão".
type StatusFilter =
  | 'all'
  | 'system_pending'
  | 'verified'
  | 'validated'
  | 'invalid'
  | 'duplicate'
  | 'conversation_pending'

const statusLabels: Record<StatusFilter, string> = {
  all: 'Todos',
  system_pending: 'Aguardando sistema',
  verified: 'Verificado Sistema',
  validated: 'Validado (Sistema + Conversa)',
  invalid: 'Inválidos',
  duplicate: 'Duplicados',
  conversation_pending: 'Aguardando conversa',
}

const ALL_STATUS_FILTERS: StatusFilter[] = [
  'all',
  'system_pending',
  'verified',
  'validated',
  'invalid',
  'duplicate',
  'conversation_pending',
]

// Filtro independente de ativação. `pending_op` é um sub-filtro de
// `activations` (ativação verificada cuja primeira operação ainda não veio
// da source): fica no mesmo segmento porque é sempre uma ativação.
type ActFilter = 'all' | 'activations' | 'pending_op' | 'non_activations'

const actLabels: Record<ActFilter, string> = {
  all: 'Todas',
  activations: 'Ativações',
  pending_op: 'Aguard. 1ª op.',
  non_activations: 'Transação Comum',
}

const ALL_ACT_FILTERS: ActFilter[] = [
  'all',
  'activations',
  'pending_op',
  'non_activations',
]

function parseStatusFilter(value: string | null): StatusFilter {
  return ALL_STATUS_FILTERS.includes(value as StatusFilter)
    ? (value as StatusFilter)
    : 'all'
}

function parseActFilter(value: string | null): ActFilter {
  return ALL_ACT_FILTERS.includes(value as ActFilter)
    ? (value as ActFilter)
    : 'all'
}

/**
 * Backward-compat: URL antiga usava `filter=activations` ou `filter=pending_op`
 * ou `filter=verified` (etc.) num único param. Quando aparece, mapeia pra os
 * 2 novos params correspondentes.
 */
function parseLegacyFilter(value: string | null): {
  status: StatusFilter
  act: ActFilter
} | null {
  if (!value) return null
  switch (value) {
    case 'activations':
      return { status: 'all', act: 'activations' }
    case 'pending_op':
      return { status: 'all', act: 'pending_op' }
    case 'system_pending':
    case 'verified':
    case 'validated':
    case 'invalid':
    case 'duplicate':
    case 'conversation_pending':
      return { status: value as StatusFilter, act: 'all' }
    default:
      return null
  }
}

function parseSetor(value: string | null): Setor | 'all' {
  if (value && SETORES.includes(value as Setor)) return value as Setor
  return 'all'
}

function parseMonth(value: string | null): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}$/.test(value) ? value : null
}

export function AdminTransactions({ transactions }: Props) {
  const { agente } = useAuth()
  const isSupervisor = agente?.role === 'supervisor'
  // Indicador de parceria (visual): super_admin vê o valor do PartnerCode; admin só vê
  // "Fora da parceria"; supervisor não vê nada disso.
  const partnerView: 'none' | 'status' | 'full' =
    agente?.role === 'super_admin'
      ? 'full'
      : agente?.role === 'admin'
        ? 'status'
        : 'none'
  const canSeePartner = partnerView !== 'none'
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  // Inicializa lendo `status` e `act` da URL; se vier `filter=<legado>` mapeia
  // pra os 2 novos.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const legacy = parseLegacyFilter(searchParams.get('filter'))
    if (legacy) return legacy.status
    return parseStatusFilter(searchParams.get('status'))
  })
  const [actFilter, setActFilter] = useState<ActFilter>(() => {
    const legacy = parseLegacyFilter(searchParams.get('filter'))
    if (legacy) return legacy.act
    return parseActFilter(searchParams.get('act'))
  })
  const [setor, setSetor] = useState<Setor | 'all'>(() =>
    parseSetor(searchParams.get('setor')),
  )
  const [currency, setCurrency] = useState<Currency | 'all'>('all')
  // Filtro por Perfil CRM (Premium/Starter/Não encontrado), URL `?crm=`.
  const [tribeFilter, setTribeFilter] = useState<'all' | TribeClassification>(() => {
    const v = searchParams.get('crm')
    return v === 'premium' || v === 'starter' || v === 'nao_encontrado' ? v : 'all'
  })
  // Filtro visual "Fora da parceria" (admin/super_admin). Independente dos demais.
  const [outsidePartnerOnly, setOutsidePartnerOnly] = useState(
    () => searchParams.get('parceria') === 'fora',
  )

  // Filtro de mês: pode vir do MonthFilterPicker (UI) OU do deep-link
  // (Fechamento → Transações). Mesma chave URL: `?mes=YYYY-MM`.
  const monthFilter = parseMonth(searchParams.get('mes'))
  // Filtro de agente: só vem via deep-link (Fechamento drill-in).
  const agenteFilter = searchParams.get('agente') || null
  // Chip "Filtro do fechamento" só aparece quando agente está em deep-link
  // (mes tem UI própria via picker, dispensa o chip).
  const hasDeepLink = !!agenteFilter

  // Sync URL → state (caso o usuario navegue por link externo). Lê tanto os
  // 2 params novos (`status`, `act`) quanto o legado (`filter`).
  useEffect(() => {
    const legacy = parseLegacyFilter(searchParams.get('filter'))
    if (legacy) {
      if (legacy.status !== statusFilter) setStatusFilter(legacy.status)
      if (legacy.act !== actFilter) setActFilter(legacy.act)
    } else {
      const sFromUrl = parseStatusFilter(searchParams.get('status'))
      if (sFromUrl !== statusFilter) setStatusFilter(sFromUrl)
      const aFromUrl = parseActFilter(searchParams.get('act'))
      if (aFromUrl !== actFilter) setActFilter(aFromUrl)
    }
    const fromSetor = parseSetor(searchParams.get('setor'))
    if (fromSetor !== setor) setSetor(fromSetor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Deep-link `?transacao=<id>` (vindo de Comissões Pendentes etc.), abre o
  // modal de detalhes UMA VEZ quando a transação aparece no snapshot. O filtro
  // visual da página continua valendo até o usuário sair / limpar; só não
  // re-abre o modal se o user fechar e o ID permanecer na URL.
  const transacaoFromUrl = searchParams.get('transacao')
  const autoOpenedTransacaoRef = useRef<string | null>(null)
  useEffect(() => {
    if (!transacaoFromUrl) {
      autoOpenedTransacaoRef.current = null
      return
    }
    if (autoOpenedTransacaoRef.current === transacaoFromUrl) return
    const exists = transactions.some((d) => d.id === transacaoFromUrl)
    if (exists) {
      setDetailsTargetId(transacaoFromUrl)
      autoOpenedTransacaoRef.current = transacaoFromUrl
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transacaoFromUrl, transactions.length])

  const clearDeepLink = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('mes')
    next.delete('agente')
    next.delete('setor')
    setSearchParams(next, { replace: true })
  }
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [detailsTargetId, setDetailsTargetId] = useState<string | null>(null)
  const detailsTarget = useMemo(
    () => transactions.find((d) => d.id === detailsTargetId) ?? null,
    [transactions, detailsTargetId],
  )
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
  const editTarget = useMemo(
    () => transactions.find((d) => d.id === editTargetId) ?? null,
    [transactions, editTargetId],
  )

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // Supervisor: cascata cliente-side só toca docs do MESMO setor (rules
      // proíbem cross-setor). Admin/super_admin não passa nada, toca todos.
      await deleteTransaction(deleteTarget, {
        actorSetores:
          isSupervisor && agente?.setor ? setoresInScope(agente.setor) : undefined,
      })
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Falha ao excluir.')
    } finally {
      setDeleting(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // suporta busca por "#42" ou "42" no campo transactionNumber
    const qNumber = q.replace(/^#/, '')
    const qIsNumeric = /^\d+$/.test(qNumber)
    return transactions.filter((d) => {
      // Deep-link de transação específica (vindo de Comissões Pendentes): ignora
      // todos os outros filtros e mostra só o doc apontado pela URL.
      if (transacaoFromUrl) return d.id === transacaoFromUrl
      if (setor !== 'all' && d.agenteSetor !== setor) return false
      if (currency !== 'all' && d.currency !== currency) return false
      // Perfil CRM (Premium/Starter/Não encontrado). Docs ainda não classificados
      // (tribeOf === null) ficam de fora quando há filtro específico ativo.
      if (tribeFilter !== 'all' && tribeOf(d) !== tribeFilter) return false
      // Deep-link filters
      if (monthFilter) {
        const dMonth = d.transactionDate ? d.transactionDate.slice(0, 7) : ''
        if (dMonth !== monthFilter) return false
      }
      if (agenteFilter && d.agenteId !== agenteFilter) return false

      // Filtro de status: independente do filtro de ativação.
      if (statusFilter === 'system_pending' && d.systemValidation !== 'pending')
        return false
      if (statusFilter === 'verified' && d.systemValidation !== 'verified')
        return false
      // `validated` é o critério ESTRITO (sistema verified + conversa
      // approved). Útil pra isolar o que de fato vira comissão, vs `verified`
      // que mostra todos system-verified independente da conversa.
      if (statusFilter === 'validated' && finalStatus(d) !== 'validated')
        return false
      // "Inválidos" cobre invalid + duplicate (duplicado também é inválido
      // no negócio). "Duplicados" é o sub-filtro que isola só os duplicates.
      if (
        statusFilter === 'invalid' &&
        d.systemValidation !== 'invalid' &&
        d.systemValidation !== 'duplicate'
      )
        return false
      if (statusFilter === 'duplicate' && d.systemValidation !== 'duplicate')
        return false
      if (
        statusFilter === 'conversation_pending' &&
        d.conversationValidation !== 'pending'
      )
        return false

      // Filtro de ativação: independente do status. `activations` cobre
      // qualquer ativação (mesmo pending/invalid); `pending_op` é o caso
      // específico de ativação verificada esperando 1ª operação.
      if (actFilter === 'activations' && !d.isActivation) return false
      if (actFilter === 'non_activations' && d.isActivation) return false
      // "Aguard. 1ª op." = ativação VALIDADA cujo 1% ainda NÃO foi liberado por
      // falta da operação qualificadora.
      //
      // Cuidado com o dado real: "verificou mas o cliente ainda não operou" é
      // gravado pelo backend como `lastOperationDate = null` (não `undefined`),
      // que a comissão classifica como `not_eligible`, NÃO `pending_operation`.
      // (`pending_operation`/undefined só ocorre quando nem deu pra consultar a
      // conta.) O pass diário `refresh_activation_eligibility` re-checa
      // justamente esses (null ou operou-antes) pra liberar o 1% quando o
      // cliente operar. Logo, "aguardando 1ª op" = qualquer ativação validada
      // cujo 1% ainda não virou `eligible`: pending_operation OU not_eligible.
      if (actFilter === 'pending_op') {
        const cs = commissionForTransaction(d).status
        if (cs !== 'pending_operation' && cs !== 'not_eligible') return false
      }

      // Filtro visual "Fora da parceria": só admin/super_admin. Mantém só os
      // verified que não estão no nossa parceria (outro parceria ou sem parceria).
      if (canSeePartner && outsidePartnerOnly && !isOutsidePartner(d)) return false

      if (!q) return true
      if (qIsNumeric && d.transactionNumber === Number(qNumber)) return true
      return (
        d.clientName.toLowerCase().includes(q) ||
        d.clientEmail.toLowerCase().includes(q) ||
        d.clientId.toLowerCase().includes(q) ||
        d.agenteName.toLowerCase().includes(q)
      )
    })
  }, [
    transactions,
    query,
    statusFilter,
    actFilter,
    setor,
    currency,
    tribeFilter,
    monthFilter,
    agenteFilter,
    transacaoFromUrl,
    canSeePartner,
    outsidePartnerOnly,
  ])

  // Documento alvo do deep-link (pra renderizar o chip de "Visualizando transação").
  const transacaoFromUrlTarget = useMemo(() => {
    if (!transacaoFromUrl) return null
    return transactions.find((d) => d.id === transacaoFromUrl) ?? null
  }, [transactions, transacaoFromUrl])

  const clearTransacaoDeepLink = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('transacao')
    setSearchParams(next, { replace: true })
  }

  // Nome do agente em deep-link (pra mostrar no chip)
  const agenteFilterName = useMemo(() => {
    if (!agenteFilter) return null
    const hit = transactions.find((d) => d.agenteId === agenteFilter)
    return hit?.agenteName ?? agenteFilter
  }, [transactions, agenteFilter])

  return (
    <>
      <PageHeader title="Registros" subtitle="Todos os registros da operação" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle"
          />
          <input
            type="text"
            placeholder="Buscar por # do registro, cliente, email, ID ou gestor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-app-border bg-app-card py-2.5 pl-9 pr-3 text-sm text-app-text shadow-[var(--shadow-card)] outline-none focus:border-app-border-strong"
          />
        </div>

        <MonthFilterPicker
          value={monthFilter}
          onChange={(next) => {
            const np = new URLSearchParams(searchParams)
            if (next) np.set('mes', next)
            else np.delete('mes')
            setSearchParams(np, { replace: true })
          }}
        />

        {!isSupervisor && (
          <select
            value={setor}
            onChange={(e) => {
              const next = e.target.value as Setor | 'all'
              setSetor(next)
              const np = new URLSearchParams(searchParams)
              if (next === 'all') np.delete('setor')
              else np.set('setor', next)
              setSearchParams(np, { replace: true })
            }}
            className="rounded-xl border border-app-border bg-app-card px-3 py-2.5 text-sm text-app-text shadow-[var(--shadow-card)] outline-none focus:border-app-border-strong"
          >
            <option value="all">Todos os setores</option>
            {SETORES.map((s) => (
              <option key={s} value={s}>
                {setorLabel[s]}
              </option>
            ))}
          </select>
        )}

        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency | 'all')}
          className="rounded-xl border border-app-border bg-app-card px-3 py-2.5 text-sm text-app-text shadow-[var(--shadow-card)] outline-none focus:border-app-border-strong"
        >
          <option value="all">Todas as moedas</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={tribeFilter}
          onChange={(e) => {
            const v = e.target.value as 'all' | TribeClassification
            setTribeFilter(v)
            const np = new URLSearchParams(searchParams)
            if (v === 'all') np.delete('crm')
            else np.set('crm', v)
            setSearchParams(np, { replace: true })
          }}
          title="Filtrar pelo perfil do cliente no CRM (Pipedrive)"
          className="rounded-xl border border-app-border bg-app-card px-3 py-2.5 text-sm text-app-text shadow-[var(--shadow-card)] outline-none focus:border-app-border-strong"
        >
          <option value="all">Todo Perfil CRM</option>
          <option value="premium">{tribeLabel.premium}</option>
          <option value="starter">{tribeLabel.starter}</option>
          <option value="nao_encontrado">{tribeLabel.nao_encontrado}</option>
        </select>

        {canSeePartner && (
          <button
            type="button"
            aria-pressed={outsidePartnerOnly}
            onClick={() => {
              const next = !outsidePartnerOnly
              setOutsidePartnerOnly(next)
              const np = new URLSearchParams(searchParams)
              if (next) np.set('parceria', 'fora')
              else np.delete('parceria')
              setSearchParams(np, { replace: true })
            }}
            title="Mostrar só registros verificados fora das nossas parcerias (90001 / 90002)"
            className={
              outsidePartnerOnly
                ? 'inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/15 px-3 py-2.5 text-sm font-semibold text-rose-700 shadow-[var(--shadow-card)] transition-colors dark:text-rose-300'
                : 'inline-flex items-center gap-1.5 rounded-xl border border-app-border bg-app-card px-3 py-2.5 text-sm text-app-muted shadow-[var(--shadow-card)] transition-colors hover:border-app-border-strong hover:bg-app-elev hover:text-app-text'
            }
          >
            <AlertTriangle size={14} />
            Fora da parceria
          </button>
        )}

        <AdminFiltersInline />

      </div>

      {/* Filtros chip: Status e Ativação em DOIS grupos com label próprio,
          numa linha separada do toolbar superior. Cada chip tem borda visível
          + bg de card pra parecer um botão de verdade; ativo fica preenchido
          no accent. Combinação status × ativação é independente. */}
      <div className="mb-3 grid gap-2 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-x-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-app-subtle">
            Status
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(statusLabels) as StatusFilter[]).map((f) => (
              <FilterChip
                key={f}
                active={statusFilter === f}
                label={statusLabels[f]}
                onClick={() => {
                  setStatusFilter(f)
                  const np = new URLSearchParams(searchParams)
                  if (f === 'all') np.delete('status')
                  else np.set('status', f)
                  np.delete('filter')
                  setSearchParams(np, { replace: true })
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-app-subtle">
            Ativação
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(actLabels) as ActFilter[]).map((f) => (
              <FilterChip
                key={f}
                active={actFilter === f}
                label={actLabels[f]}
                onClick={() => {
                  setActFilter(f)
                  const np = new URLSearchParams(searchParams)
                  if (f === 'all') np.delete('act')
                  else np.set('act', f)
                  np.delete('filter')
                  setSearchParams(np, { replace: true })
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {transacaoFromUrl && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px]">
          <Link
            to="/admin/comissoes-pendentes"
            className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
          >
            <ArrowLeft size={10} />
            Comissões Pendentes
          </Link>
          <span className="font-medium uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
            Visualizando registro:
          </span>
          <span className="rounded bg-app-card px-2 py-0.5 font-mono tabular-nums text-app-text">
            {transacaoFromUrlTarget?.transactionNumber != null
              ? `#${transacaoFromUrlTarget.transactionNumber}`
              : '#-'}
          </span>
          {transacaoFromUrlTarget?.clientName && (
            <span className="truncate text-app-text">
              · {transacaoFromUrlTarget.clientName}
            </span>
          )}
          <button
            type="button"
            onClick={clearTransacaoDeepLink}
            title="Voltar a ver todos os registros"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-semibold text-app-muted transition-colors hover:text-app-text"
          >
            <X size={10} />
            Limpar filtro
          </button>
        </div>
      )}

      {hasDeepLink && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-app-accent/30 bg-app-accent/[0.06] px-3 py-2 text-[11px]">
          <span className="font-medium uppercase tracking-[0.12em] text-app-accent-text">
            Filtro do fechamento:
          </span>
          {monthFilter && (
            <span className="rounded bg-app-card px-2 py-0.5 font-mono tabular-nums text-app-text">
              {monthFilter}
            </span>
          )}
          {agenteFilterName && (
            <span className="rounded bg-app-card px-2 py-0.5 text-app-text">
              {agenteFilterName}
            </span>
          )}
          <button
            type="button"
            onClick={clearDeepLink}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-semibold text-app-muted transition-colors hover:text-app-text"
          >
            <X size={10} />
            Limpar
          </button>
        </div>
      )}

      <TransactionList
        transactions={filtered}
        showAgente
        showSetor
        partnerView={partnerView}
        onEdit={(d) => setEditTargetId(d.id)}
        onDelete={setDeleteTarget}
        onRowClick={(d) => setDetailsTargetId(d.id)}
        highlightId={transacaoFromUrl ?? undefined}
      />

      <Modal
        open={!!editTarget}
        onClose={() => setEditTargetId(null)}
        title="Editar registro"
        subtitle={
          editTarget?.transactionNumber != null
            ? `#${editTarget.transactionNumber} · ${editTarget.clientName}`
            : editTarget?.clientName
        }
        width="2xl"
      >
        {editTarget && (
          <TransactionEditForm
            transaction={editTarget}
            mode="admin"
            onSuccess={() => setEditTargetId(null)}
          />
        )}
      </Modal>

      <Modal
        open={!!detailsTarget}
        onClose={() => setDetailsTargetId(null)}
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
            onClose={() => setDetailsTargetId(null)}
          />
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir registro"
        subtitle={
          deleteTarget?.transactionNumber != null
            ? `#${deleteTarget.transactionNumber} · ${deleteTarget.clientName}`
            : deleteTarget?.clientName
        }
        width="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-app-text">
            Esta ação remove o registro e todos os comprovantes do Storage. Não dá pra desfazer.
          </p>
          {deleteError && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-app-border bg-app-elev px-3 py-2 text-sm text-app-text hover:bg-app-elev/80"
            >
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

/**
 * Picker de mês (YYYY-MM) com navegação ◀/▶ e botão pra limpar.
 * Valor null = sem filtro de mês (todos os meses).
 */
function MonthFilterPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (next: string | null) => void
}) {
  const monthDate = value ? parseMonthString(value) : null
  const label = monthDate
    ? monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : 'Filtrar por mês'

  const shift = (delta: number) => {
    const base = monthDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const next = new Date(base.getFullYear(), base.getMonth() + delta, 1)
    const now = new Date()
    // Não permite navegar pro futuro além do mês atual
    if (
      next.getFullYear() > now.getFullYear() ||
      (next.getFullYear() === now.getFullYear() && next.getMonth() > now.getMonth())
    ) {
      return
    }
    const y = next.getFullYear()
    const m = String(next.getMonth() + 1).padStart(2, '0')
    onChange(`${y}-${m}`)
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-app-border bg-app-card px-1.5 py-1.5 shadow-[var(--shadow-card)]">
      <Calendar size={14} className="ml-1 text-app-subtle" />
      <button
        type="button"
        onClick={() => shift(-1)}
        title="Mês anterior"
        className="flex h-6 w-6 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
      >
        <ChevronLeft size={13} />
      </button>
      <span
        className={`min-w-[110px] text-center text-sm tabular-nums ${
          value ? 'font-semibold text-app-text' : 'text-app-subtle'
        }`}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => shift(1)}
        title="Próximo mês"
        className="flex h-6 w-6 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
      >
        <ChevronRight size={13} />
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Limpar filtro de mês"
          className="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function parseMonthString(s: string): Date | null {
  const [y, m] = s.split('-').map(Number)
  if (!y || !m) return null
  return new Date(y, m - 1, 1)
}

/**
 * Chip de filtro: borda visível, bg de card, parece um botão clicável de
 * verdade. Estado ativo: preenchido no accent + texto invertido. Hover:
 * eleva o bg pra dar feedback.
 */
function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-md border border-app-accent bg-app-accent px-2.5 py-1 text-[11px] font-medium text-app-accent-fg shadow-sm transition-colors'
          : 'rounded-md border border-app-border bg-app-card px-2.5 py-1 text-[11px] font-medium text-app-muted shadow-sm transition-colors hover:border-app-border-strong hover:bg-app-elev hover:text-app-text'
      }
    >
      {label}
    </button>
  )
}
