import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Pencil,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { AdminFiltersInline } from '../components/AdminFiltersInline'
import { Modal } from '../components/Modal'
import { TransactionDetails } from '../components/TransactionDetails'
import { SetorBadge } from '../components/SetorBadge'
import { approveTransactionEdit, rejectTransactionEdit } from '../lib/transactions'
import { formatCurrency, formatDateBR } from '../lib/format'
import type { Transaction, PendingEdit, Setor } from '../types'
import { setorLabel, setoresInScope } from '../types'
import { useAuth } from '../contexts/AuthContext'

/**
 * Quantas edições do MESMO gestor no MESMO transação disparam alerta visual
 * (e notificação no bell pra admin/super). Decidido em 2026-05-16: 3.
 */
const EDIT_ABUSE_THRESHOLD = 3

interface Props {
  transactions: Transaction[]
}

export function AdminEdits({ transactions }: Props) {
  const { agente } = useAuth()
  const isSupervisor = agente?.role === 'supervisor'
  // Filtro de setor: admin/super veem todos os SETORES; supervisor premium_starter
  // só faz sentido oferecer filtro se cobre 2 setores (escopo > 1). Supervisor
  // de setor único já vê apenas o próprio, não precisa.
  const filterableSetores = useMemo<Setor[]>(() => {
    if (isSupervisor) {
      const scope = agente?.setor ? setoresInScope(agente.setor) : []
      return scope.length > 1 ? scope : []
    }
    return ['premium', 'starter', 'eventos', 'online']
  }, [isSupervisor, agente?.setor])
  const showSetorFilter = filterableSetores.length > 0
  const [setorFilter, setSetorFilter] = useState<Setor | 'all'>('all')

  const pending = useMemo(
    () =>
      transactions
        .filter((d) => {
          if (!d.pendingEdit) return false
          if (setorFilter !== 'all' && d.agenteSetor !== setorFilter) return false
          return true
        })
        // Mais recentes primeiro pela data em que o gestor solicitou a edição.
        .sort((a, b) => submittedAtMs(b) - submittedAtMs(a)),
    [transactions, setorFilter],
  )
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewTarget = useMemo(
    () => transactions.find((d) => d.id === previewId) ?? null,
    [transactions, previewId],
  )

  const handle = async (
    transaction: Transaction,
    action: 'approve' | 'reject',
  ) => {
    setSubmittingId(transaction.id)
    try {
      if (action === 'approve') {
        await approveTransactionEdit(transaction, {
          actorSetores:
            isSupervisor && agente?.setor
              ? setoresInScope(agente.setor)
              : undefined,
        })
      } else {
        await rejectTransactionEdit(transaction)
      }
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Edições pendentes"
        subtitle={`${pending.length} ${pending.length === 1 ? 'registro' : 'registros'} aguardando revisão`}
        actions={<AdminFiltersInline />}
      />

      {showSetorFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
            Setor
          </span>
          <button
            type="button"
            onClick={() => setSetorFilter('all')}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
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
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
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

      {pending.length === 0 ? (
        <div className="rounded-xl border border-dashed border-app-border bg-app-card px-6 py-16 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-green-500" />
          <h3 className="text-base font-semibold text-app-text">Tudo em dia</h3>
          <p className="mt-1 text-sm text-app-muted">
            Nenhum gestor solicitou edição.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((d) => {
            // Quando o gestor já solicitou 3+ edições no MESMO transação,
            // muda a borda do card pra vermelho e mostra badge de alerta.
            // Threshold de 3 é arbitrário (decisão do produto em 2026-05-16);
            // ajustável editando EDIT_ABUSE_THRESHOLD.
            const editCount = d.editRequestCount ?? 0
            const isAbuse = editCount >= EDIT_ABUSE_THRESHOLD
            return (
            <article
              key={d.id}
              className={`rounded-xl border bg-app-card p-5 shadow-sm ${
                isAbuse
                  ? 'border-red-500/40 ring-1 ring-red-500/20'
                  : 'border-amber-500/30'
              }`}
            >
              <header className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-app-border pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pencil size={14} className="text-amber-600 dark:text-amber-300" />
                    <span className="font-mono text-sm font-semibold text-app-text">
                      {d.transactionNumber != null ? `#${d.transactionNumber}` : d.id.slice(0, 6)}
                    </span>
                    <span className="text-sm text-app-muted">·</span>
                    <span className="text-sm text-app-text">{d.clientName}</span>
                    {isAbuse && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300"
                        title={`Este registro teve ${editCount} solicitações de edição. Investigar antes de aprovar.`}
                      >
                        <AlertTriangle size={11} />
                        {editCount} edições
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-app-subtle">
                    <span>Solicitado por {d.agenteName}</span>
                    {d.agenteSetor && <SetorBadge setor={d.agenteSetor} size="xs" />}
                    {d.pendingEdit?.submittedAt && (
                      <>
                        <span>·</span>
                        <SubmittedAt edit={d.pendingEdit} />
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPreviewId(d.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-card px-3 py-1.5 text-sm font-medium text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
                    title="Abrir detalhes do registro original"
                  >
                    <ExternalLink size={13} />
                    Ver registro
                  </button>
                  <button
                    onClick={() => handle(d, 'reject')}
                    disabled={submittingId === d.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
                  >
                    {submittingId === d.id ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                    Rejeitar
                  </button>
                  <button
                    onClick={() => handle(d, 'approve')}
                    disabled={submittingId === d.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-3 py-1.5 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400 disabled:opacity-60"
                  >
                    {submittingId === d.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Aprovar
                  </button>
                </div>
              </header>

              <DiffTable transaction={d} />

              {isAbuse && (
                <p className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  Esse gestor já pediu edição neste mesmo registro {editCount}{' '}
                  vezes. Vale checar histórico e conferir com o gestor antes de aprovar.
                </p>
              )}

              {(d.pendingEdit?.changes.clientId !== undefined ||
                d.pendingEdit?.changes.amount !== undefined ||
                d.pendingEdit?.changes.currency !== undefined ||
                d.pendingEdit?.changes.transactionDate !== undefined) && (
                <p className="mt-3 flex items-start gap-2 text-xs text-app-muted">
                  <Clock size={12} className="mt-0.5" />
                  Esses campos afetam a validação. Ao aprovar, o sistema vai reprocessar
                  contra o BigQuery.
                </p>
              )}
            </article>
            )
          })}
        </div>
      )}

      <Modal
        open={!!previewTarget}
        onClose={() => setPreviewId(null)}
        title="Detalhes do registro"
        subtitle={
          previewTarget?.transactionNumber != null
            ? `#${previewTarget.transactionNumber} · ${previewTarget.clientName}`
            : previewTarget?.clientName
        }
        width="3xl"
      >
        {previewTarget && (
          <TransactionDetails
            transaction={previewTarget}
            onClose={() => setPreviewId(null)}
          />
        )}
      </Modal>
    </>
  )
}

function SubmittedAt({ edit }: { edit: PendingEdit }) {
  const ts = edit.submittedAt
  // Timestamp do Firestore tem toDate()
  const d = (ts as unknown as { toDate?: () => Date })?.toDate?.() ?? null
  if (!d) return null
  return <span>{d.toLocaleString('pt-BR')}</span>
}

/** ms do `pendingEdit.submittedAt` (Firestore Timestamp); 0 quando ausente. */
function submittedAtMs(transaction: Transaction): number {
  const ts = transaction.pendingEdit?.submittedAt
  if (!ts) return 0
  const date = (ts as unknown as { toDate?: () => Date })?.toDate?.()
  return date ? date.getTime() : 0
}

function DiffTable({ transaction }: { transaction: Transaction }) {
  const changes = transaction.pendingEdit?.changes ?? {}
  // Campos texto (excluindo arrays de receipt, esses vão em ReceiptDiff)
  type TextFieldKey =
    | 'clientName'
    | 'clientEmail'
    | 'clientPhone'
    | 'clientId'
    | 'currency'
    | 'amount'
    | 'transactionDate'
  const labels: Record<string, string> = {
    clientName: 'Nome do cliente',
    clientEmail: 'Email',
    clientPhone: 'Telefone',
    clientId: 'Conta do cliente',
    currency: 'Moeda',
    amount: 'Volume',
    transactionDate: 'Data',
  }
  const textKeys: TextFieldKey[] = [
    'clientName',
    'clientEmail',
    'clientPhone',
    'clientId',
    'currency',
    'amount',
    'transactionDate',
  ]
  const presentKeys = textKeys.filter((k) => k in changes)

  const formatValue = (key: TextFieldKey, val: unknown): string => {
    if (val == null) return '-'
    if (key === 'amount') {
      const cur = (changes.currency ?? transaction.currency) as 'USD' | 'EUR' | 'GBP'
      return formatCurrency(Number(val), cur)
    }
    if (key === 'transactionDate') return formatDateBR(String(val))
    return String(val)
  }

  const addedDep = changes.addedTransactionReceipts ?? []
  const removedDep = changes.removedTransactionReceipts ?? []
  const addedConv = changes.addedConversationReceipts ?? []
  const removedConv = changes.removedConversationReceipts ?? []
  const hasReceiptChanges =
    addedDep.length > 0 ||
    removedDep.length > 0 ||
    addedConv.length > 0 ||
    removedConv.length > 0

  return (
    <div className="space-y-3">
      {presentKeys.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-app-border">
          <table className="w-full text-sm">
            <thead className="bg-app-elev/40 text-[11px] uppercase tracking-wider text-app-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Campo</th>
                <th className="px-3 py-2 text-left font-semibold">Antes</th>
                <th className="w-8 px-2 py-2" aria-hidden />
                <th className="px-3 py-2 text-left font-semibold">Depois</th>
              </tr>
            </thead>
            <tbody>
              {presentKeys.map((k) => (
                <tr key={k} className="border-t border-app-border/60">
                  <td className="px-3 py-2 text-app-muted">{labels[k] ?? k}</td>
                  <td className="px-3 py-2 text-app-muted line-through decoration-app-subtle/60">
                    {formatValue(k, (transaction as unknown as Record<string, unknown>)[k])}
                  </td>
                  <td className="w-8 px-1 py-2 text-app-subtle" aria-hidden>
                    <ArrowRight size={14} strokeWidth={2} className="mx-auto" />
                  </td>
                  <td className="px-3 py-2 font-semibold text-green-700 dark:text-green-300">
                    {formatValue(k, changes[k])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasReceiptChanges && (
        <ReceiptDiff
          label="Comprovantes de registro"
          added={addedDep}
          removed={removedDep}
        />
      )}
      {(addedConv.length > 0 || removedConv.length > 0) && (
        <ReceiptDiff
          label="Comprovantes de conversa"
          added={addedConv}
          removed={removedConv}
        />
      )}
    </div>
  )
}

function ReceiptDiff({
  label,
  added,
  removed,
}: {
  label: string
  added: string[]
  removed: string[]
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-app-border bg-app-card">
      <header className="flex items-center justify-between border-b border-app-border bg-app-elev/40 px-3 py-2 text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-app-muted">
          {label}
        </span>
        <span className="font-mono tabular-nums text-app-subtle">
          +{added.length} / −{removed.length}
        </span>
      </header>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400">
            Adicionar ({added.length})
          </div>
          {added.length === 0 ? (
            <div className="text-[10.5px] text-app-subtle">-</div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {added.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square overflow-hidden rounded border border-emerald-500/50 bg-app-bg ring-1 ring-emerald-500/30"
                  title="Abrir imagem"
                >
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-400">
            Remover ({removed.length})
          </div>
          {removed.length === 0 ? (
            <div className="text-[10.5px] text-app-subtle">-</div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {removed.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square overflow-hidden rounded border border-rose-500/50 bg-app-bg ring-1 ring-rose-500/30"
                  title="Abrir imagem"
                >
                  <img
                    src={u}
                    alt=""
                    className="h-full w-full object-cover opacity-60"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
                      remover
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
