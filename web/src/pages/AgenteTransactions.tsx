import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { Modal } from '../components/Modal'
import { TransactionForm } from '../components/TransactionForm'
import { TransactionEditForm } from '../components/TransactionEditForm'
import { TransactionList } from '../components/TransactionList'
import { attachImportedReceipts } from '../lib/transactions'
import { useAuth } from '../contexts/AuthContext'
import { CURRENCIES, buildAgentMaskedIdMap } from '../types'
import type { Currency, Transaction } from '../types'

interface Props {
  transactions: Transaction[]
}

export function AgenteTransactions({ transactions }: Props) {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Transaction | null>(null)
  // Filtro de mês: YYYY-MM ou null (todos os meses)
  const [monthFilter, setMonthFilter] = useState<string | null>(null)
  const [currency, setCurrency] = useState<Currency | 'all'>('all')
  // Busca livre por nome / e-mail / telefone (ou #número).
  const [search, setSearch] = useState('')

  // Deep-link `?transacao=<id>` (vindo de Comissões Pendentes), destaca a linha.
  // Limpa o filtro de mês pra garantir que a transação apareça.
  const transacaoFromUrl = searchParams.get('transacao')
  useEffect(() => {
    if (!transacaoFromUrl) return
    const target = transactions.find((d) => d.id === transacaoFromUrl)
    if (!target) return
    // Garante que a transação esteja visível: zera filtros estreitos.
    setMonthFilter(null)
    setCurrency('all')
  }, [transacaoFromUrl, transactions])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    // Dígitos do termo: usado pra casar telefone ignorando máscara/DDI.
    const termDigits = term.replace(/\D/g, '')
    return transactions.filter((d) => {
      // Deep-link: ?transacao=ID → mostra só a transação apontada.
      if (transacaoFromUrl) return d.id === transacaoFromUrl
      if (monthFilter) {
        if (!d.transactionDate || !d.transactionDate.startsWith(monthFilter)) return false
      }
      if (currency !== 'all' && d.currency !== currency) return false
      if (term) {
        const name = (d.clientName || '').toLowerCase()
        const email = (d.clientEmail || '').toLowerCase()
        const phoneDigits = (d.clientPhone || '').replace(/\D/g, '')
        // Busca por #número (ex.: "#123" ou "123").
        const num = term.replace(/^#/, '')
        const byNumber =
          d.transactionNumber != null && /^\d+$/.test(num) && String(d.transactionNumber) === num
        const byPhone =
          termDigits.length >= 3 && phoneDigits.includes(termDigits)
        if (
          !name.includes(term) &&
          !email.includes(term) &&
          !byPhone &&
          !byNumber
        )
          return false
      }
      return true
    })
  }, [transactions, monthFilter, currency, transacaoFromUrl, search])

  const transacaoTarget = useMemo(() => {
    if (!transacaoFromUrl) return null
    return transactions.find((d) => d.id === transacaoFromUrl) ?? null
  }, [transactions, transacaoFromUrl])

  // Map de Identificação mascarada pro gestor, construído a partir da lista
  // COMPLETA (não filtrada) pra que a seq seja estável mesmo quando o usuário
  // filtra por mês ou moeda. Veja `buildAgentMaskedIdMap` em types/index.ts.
  const agentMaskedIdMap = useMemo(
    () => buildAgentMaskedIdMap(transactions),
    [transactions],
  )

  const clearTransacaoDeepLink = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('transacao')
    setSearchParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Meus registros"
        subtitle={
          search.trim()
            ? `${filtered.length} resultado${filtered.length === 1 ? '' : 's'} para "${search.trim()}"`
            : monthFilter
              ? `Filtrado por ${formatMonthLabel(monthFilter)}`
              : 'Histórico completo dos seus registros'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, e-mail ou telefone"
                className="w-64 rounded-xl border border-app-border bg-app-card py-2 pl-9 pr-8 text-sm text-app-text shadow-[var(--shadow-card)] outline-none placeholder:text-app-subtle focus:border-app-border-strong"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  title="Limpar busca"
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <MonthFilterPicker value={monthFilter} onChange={setMonthFilter} />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency | 'all')}
              className="rounded-xl border border-app-border bg-app-card px-3 py-2 text-sm text-app-text shadow-[var(--shadow-card)] outline-none focus:border-app-border-strong"
            >
              <option value="all">Todas as moedas</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400"
            >
              <Plus size={16} strokeWidth={2.5} />
              Incluir Registro
            </button>
          </div>
        }
      />

      {transacaoFromUrl && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px]">
          <Link
            to="/agente"
            className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
          >
            <ArrowLeft size={10} />
            Voltar
          </Link>
          <span className="font-medium uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
            Visualizando registro:
          </span>
          <span className="rounded bg-app-card px-2 py-0.5 font-mono tabular-nums text-app-text">
            {transacaoTarget?.transactionNumber != null
              ? `#${transacaoTarget.transactionNumber}`
              : '#-'}
          </span>
          {transacaoTarget?.clientName && (
            <span className="truncate text-app-text">
              · {transacaoTarget.clientName}
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

      <TransactionList
        transactions={filtered}
        viewMode="agent"
        showSetor
        currentAgenteId={user?.uid}
        onEdit={setEditTarget}
        highlightId={transacaoFromUrl ?? undefined}
        agentMaskedIdMap={agentMaskedIdMap}
        onAttachImportedReceipts={async (d, files) => {
          await attachImportedReceipts(d, files)
        }}
        // Note: assinatura igual em transactions.ts: passa direto.
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Incluir Registro"
        subtitle="Adicione um novo registro"
      >
        <TransactionForm onSuccess={() => setModalOpen(false)} />
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Editar Registro"
        subtitle={
          editTarget?.transactionNumber != null
            ? `#${editTarget.transactionNumber} · ${editTarget.clientName}`
            : editTarget?.clientName
        }
      >
        {editTarget && (
          <TransactionEditForm transaction={editTarget} onSuccess={() => setEditTarget(null)} />
        )}
      </Modal>
    </>
  )
}

/**
 * Picker de mês (YYYY-MM) com navegação ◀/▶ e botão pra limpar.
 * Mesma UX do MonthFilterPicker em /admin/transacoes.
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
          title="Limpar filtro"
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

function formatMonthLabel(yyyymm: string): string {
  const d = parseMonthString(yyyymm)
  if (!d) return yyyymm
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
