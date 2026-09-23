import { useState } from 'react'
import {
  AlertOctagon,
  Bot,
  CheckCircle2,
  Clock,
  DollarSign,
  Hourglass,
  Loader2,
  RefreshCw,
  Save,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { ImageGallery } from './ImageGallery'
import {
  forceRevalidate,
  recalcUsdConversion,
  setConversationValidation,
} from '../lib/transactions'
import { useAuth } from '../contexts/AuthContext'
import { partnerStatusLabel, partnerStatusOf } from '../lib/partner'
import { tribeLabel, tribeOf } from '../lib/pipedrive'
import { formatCurrency, formatDateBR, formatMoney } from '../lib/format'
import { finalStatus, isSupervisorOrAbove, replicationCount, replicationLabel, setorLabel } from '../types'
import {
  TRANSACTION_PCT,
  activationBonusForTransaction,
  activationBonusReason,
  commissionForTransaction,
  effectiveUsdAmount,
} from '../lib/commission'
import type {
  BestCandidate,
  ConversationValidation,
  Transaction,
  SystemValidation,
  ValidationChecks,
} from '../types'

interface Props {
  transaction: Transaction
  onClose: () => void
}

export function TransactionDetails({ transaction, onClose }: Props) {
  const { agente } = useAuth()
  const isAdmin = agente?.role === 'admin' || agente?.role === 'super_admin'
  const isSuperAdmin = agente?.role === 'super_admin'
  const [gallery, setGallery] = useState<{ urls: string[]; initial: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState(transaction.conversationNote ?? '')
  const [savedFlash, setSavedFlash] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  const [revalidateFlash, setRevalidateFlash] = useState<'ok' | 'err' | null>(null)

  const handleRevalidate = async () => {
    setRevalidating(true)
    setRevalidateFlash(null)
    try {
      await forceRevalidate(transaction)
      setRevalidateFlash('ok')
      setTimeout(() => setRevalidateFlash(null), 2500)
    } catch (err) {
      console.error('forceRevalidate falhou:', err)
      setRevalidateFlash('err')
      setTimeout(() => setRevalidateFlash(null), 3500)
    } finally {
      setRevalidating(false)
    }
  }

  const handleAction = async (action: ConversationValidation) => {
    setSubmitting(true)
    try {
      await setConversationValidation(transaction, action, note.trim() || undefined)
      if (action === 'pending') {
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
      } else {
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveNote = async () => {
    setSubmitting(true)
    try {
      await setConversationValidation(
        transaction,
        transaction.conversationValidation,
        note.trim() || undefined,
      )
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } finally {
      setSubmitting(false)
    }
  }

  const isPendingConversa = transaction.conversationValidation === 'pending'
  const noteChanged = (note.trim() || '') !== (transaction.conversationNote?.trim() ?? '')
  const fieldStatus = computeFieldStatus(transaction)

  return (
    <>
      <div className="space-y-5">
        <header className="border-b border-app-border pb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-app-text">{transaction.clientName}</h2>
            {transaction.systemValidation === 'verified' && transaction.isActivation && (
              <span className="inline-flex items-center gap-1 rounded border border-app-border bg-app-elev px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-app-text">
                <UserPlus size={11} strokeWidth={2} className="text-app-muted" /> Ativação
              </span>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-app-muted">
            {transaction.transactionNumber != null && (
              <span className="font-mono text-app-text">#{transaction.transactionNumber}</span>
            )}
            <span>·</span>
            <span>
              Registrado por <span className="text-app-text">{transaction.agenteName}</span>
              {transaction.agenteSetor && (
                <span className="text-app-subtle"> · {setorLabel[transaction.agenteSetor]}</span>
              )}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {formatDateBR(transaction.transactionDate)}
            </span>
          </p>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRevalidate}
                disabled={revalidating}
                className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-card px-2.5 py-1 text-[11px] font-medium text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:opacity-60"
                title="Volta o status pra pending e re-roda a validação contra o source"
              >
                {revalidating ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                {revalidating ? 'Revalidando…' : 'Re-validar agora'}
              </button>
              {revalidateFlash === 'ok' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={11} /> reset disparado, aguarde alguns segundos
                </span>
              )}
              {revalidateFlash === 'err' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                  <XCircle size={11} /> falha: veja o console
                </span>
              )}
            </div>
          )}
        </header>

        <SystemStatusCard status={transaction.systemValidation} transaction={transaction} />

        {isAdmin && <PartnerStatusCard transaction={transaction} showValue={isSuperAdmin} />}

        {(transaction.systemValidation === 'invalid' ||
          transaction.systemValidation === 'duplicate') && (
          <FailureBreakdown
            transaction={transaction}
            checks={transaction.validationChecks}
            isDuplicate={transaction.systemValidation === 'duplicate'}
          />
        )}

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
          <Field
            label="Conta do cliente"
            value={transaction.clientId}
            status={fieldStatus.login}
          />
          <Field label="Email" value={transaction.clientEmail} />
          <Field label="Telefone" value={transaction.clientPhone} />
          {/* Perfil CRM (Premium/Starter): só supervisor pra cima. */}
          {isSupervisorOrAbove(agente?.role) && <TribeField transaction={transaction} />}
          <Field
            label={`Volume (${transaction.currency})`}
            value={formatCurrency(transaction.amount, transaction.currency)}
            highlight
            status={fieldStatus.amount}
          />
          <Field
            label="Moeda"
            value={transaction.currency}
            status={fieldStatus.currency}
          />
          <Field
            label="Data"
            value={formatDateBR(transaction.transactionDate)}
            status={fieldStatus.date}
          />
        </div>

        {transaction.currency !== 'USD' && finalStatus(transaction) === 'validated' && (
          <UsdConversionNote transaction={transaction} />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <ReceiptStack
            label="Comprovantes de registro"
            urls={transaction.transactionReceiptUrls}
            tone="green"
            onOpen={(i) => setGallery({ urls: transaction.transactionReceiptUrls, initial: i })}
          />
          <ReceiptStack
            label="Comprovantes de conversa"
            urls={transaction.conversationReceiptUrls}
            tone="blue"
            onOpen={(i) =>
              setGallery({ urls: transaction.conversationReceiptUrls, initial: i })
            }
          />
        </div>

        <ConversationStatusCard status={transaction.conversationValidation} />

        <CommissionDetailCard transaction={transaction} />

        <div className="space-y-3 rounded-lg border border-app-border bg-app-elev/30 p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-app-muted">
              Observação do admin
            </label>
            {savedFlash && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-300">
                <CheckCircle2 size={11} /> Salvo
              </span>
            )}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex: Cliente da conversa não confere com a conta informada"
            className="w-full resize-none rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm text-app-text outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
          />

          <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
            {isPendingConversa ? (
              <>
                <button
                  onClick={() => handleAction('approved')}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Aprovar conversa
                </button>
                <button
                  onClick={() => handleAction('rejected')}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                  Rejeitar conversa
                </button>
              </>
            ) : (
              <button
                onClick={() => handleAction('pending')}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-elev px-3 py-2 text-xs font-medium text-app-text hover:bg-app-elev/80"
              >
                Reabrir validação de conversa
              </button>
            )}
            <button
              onClick={handleSaveNote}
              disabled={submitting || !noteChanged}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-elev px-3 py-2 text-xs font-medium text-app-text transition-colors hover:bg-app-elev/80 disabled:opacity-40"
              title={noteChanged ? 'Salvar observação' : 'Sem mudanças'}
            >
              <Save size={12} /> Salvar observação
            </button>
          </div>
        </div>
      </div>

      {gallery && (
        <ImageGallery
          urls={gallery.urls}
          initial={gallery.initial}
          onClose={() => setGallery(null)}
        />
      )}
    </>
  )
}

function ReceiptStack({
  label,
  urls,
  tone,
  onOpen,
}: {
  label: string
  urls: string[]
  tone: 'green' | 'blue'
  onOpen: (initial: number) => void
}) {
  const ringColor = tone === 'green' ? 'ring-green-500/30' : 'ring-blue-500/30'
  return (
    <div className={`overflow-hidden rounded-lg border border-app-border bg-app-elev/40 ring-1 ${ringColor}`}>
      <div className="px-4 py-2 text-left">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-app-text">{label}</span>
          <span className="text-[11px] text-app-subtle">
            {urls.length} {urls.length === 1 ? 'imagem' : 'imagens'}
          </span>
        </div>
      </div>
      {urls.length === 0 ? (
        <div className="px-4 pb-4 text-xs text-app-subtle">Sem imagens.</div>
      ) : (
        <div className="grid grid-cols-3 gap-1 p-2">
          {urls.map((url, i) => (
            <button
              key={url}
              onClick={() => onOpen(i)}
              className="aspect-square overflow-hidden rounded border border-app-border bg-app-bg transition-transform hover:scale-[1.02]"
            >
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FailureBreakdown({
  transaction,
  checks,
  isDuplicate,
}: {
  transaction: Transaction
  checks?: ValidationChecks
  isDuplicate: boolean
}) {
  const crossAgent = transaction.duplicateAlert?.crossAgent
  const linkedNumbers = transaction.duplicateAlert?.linkedTransactionNumbers ?? []
  const best = transaction.bestCandidate
  const count = replicationCount(transaction)
  const baseLabel = replicationLabel(count)
  const headline = isDuplicate
    ? crossAgent
      ? `${baseLabel} entre gestores diferentes`
      : `${baseLabel} pelo mesmo gestor`
    : 'Por que esse registro não foi validado'

  // Gestores envolvidos no grupo (excluindo o próprio), vem do backend.
  // Supervisor depende disso pra saber quem/qual setor está duplicando, mesmo
  // sem acesso ao doc do outro setor.
  const otherAgentes = (transaction.duplicateAlert?.agentesInfo ?? []).filter(
    (a) => a.uid !== transaction.agenteId,
  )
  // Setores ainda úteis como fallback se backend antigo só populou setores.
  const setoresEnvolvidos = transaction.duplicateAlert?.setores ?? []
  const otherSetores = setoresEnvolvidos.filter((s) => s !== transaction.agenteSetor)

  return (
    <div className="overflow-hidden rounded-lg border-2 border-red-500/50 bg-red-500/10 shadow-sm">
      <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/20 px-4 py-2.5 text-sm font-bold text-red-700 dark:text-red-300">
        <AlertOctagon size={16} />
        {headline}
      </div>
      <div className="p-4">
        {isDuplicate && otherAgentes.length > 0 && (
          <div className="mb-3 space-y-1.5 text-xs">
            <div className="text-app-muted">
              Duplicando com {otherAgentes.length === 1 ? 'o gestor' : 'os gestores'}:
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {otherAgentes.map((a) => (
                <li
                  key={a.uid}
                  className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300"
                >
                  {a.name ?? a.uid.slice(0, 6)}
                  {a.setor && (
                    <span className="ml-1.5 text-[10.5px] font-medium text-amber-700/80 dark:text-amber-300/80">
                      · {setorLabel[a.setor]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isDuplicate && otherAgentes.length === 0 && otherSetores.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-app-muted">
              Duplicando com {otherSetores.length === 1 ? 'o setor' : 'os setores'}:
            </span>
            {otherSetores.map((s) => (
              <span
                key={s}
                className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300"
              >
                {setorLabel[s]}
              </span>
            ))}
          </div>
        )}

        {isDuplicate && linkedNumbers.length > 0 && (
          <div className="mb-3 text-xs text-app-text">
            Mesmo (conta · valor · moeda · data) que{' '}
            {linkedNumbers.map((n, i) => (
              <span key={n}>
                <span className="font-semibold">#{n}</span>
                {i < linkedNumbers.length - 1 ? ', ' : ''}
              </span>
            ))}
            .
          </div>
        )}

        {!isDuplicate && best ? (
          <BestCandidateBreakdown transaction={transaction} best={best} />
        ) : (
          <SoloChecks transaction={transaction} checks={checks} isDuplicate={isDuplicate} />
        )}
      </div>
    </div>
  )
}

/**
 * Status (ok | fail | undefined) para cada um dos 4 campos validados pelo sistema.
 * - verified → tudo ok
 * - invalid c/ bestCandidate → usa os matches do bestCandidate
 * - invalid sem bestCandidate → usa os checks isolados (login=id_check, etc.)
 * - duplicate → tudo ok (a tx bate, só foi consumida por outro)
 * - pending → tudo neutro
 */
function computeFieldStatus(transaction: Transaction): {
  login?: 'ok' | 'fail'
  amount?: 'ok' | 'fail'
  currency?: 'ok' | 'fail'
  date?: 'ok' | 'fail'
} {
  const sv = transaction.systemValidation
  if (sv === 'verified' || sv === 'duplicate') {
    return { login: 'ok', amount: 'ok', currency: 'ok', date: 'ok' }
  }
  if (sv === 'invalid') {
    const best = transaction.bestCandidate
    if (best) {
      return {
        login: best.loginMatch ? 'ok' : 'fail',
        amount: best.amountMatch ? 'ok' : 'fail',
        currency: best.currencyMatch ? 'ok' : 'fail',
        date: best.dateMatch ? 'ok' : 'fail',
      }
    }
    const c = transaction.validationChecks ?? {}
    // Sem bestCandidate E sem id_check: a conta do cliente não foi
    // encontrada. Os demais campos ficam neutros (undefined) porque dependem
    // da conta: não faz sentido marcar valor/moeda/data como "fail". O único
    // fail real é a conta. #decisao 2026-05-26
    if (!c.id_check) {
      return { login: 'fail' }
    }
    return {
      login: c.id_check ? 'ok' : 'fail',
      amount: c.value_check ? 'ok' : 'fail',
      currency: c.currency_check ? 'ok' : 'fail',
      date: c.date_check ? 'ok' : 'fail',
    }
  }
  return {}
}

/**
 * Mostra os erros quando o sistema achou UMA transação no source com 2+ campos
 * batendo: assume que era essa a tx referenciada e lista esperado vs encontrado.
 */
function BestCandidateBreakdown({
  transaction,
  best,
}: {
  transaction: Transaction
  best: BestCandidate
}) {
  type Row = { label: string; ok: boolean; expected: string; got: string }
  const rows: Row[] = [
    {
      label: 'Conta do cliente',
      ok: best.loginMatch,
      expected: transaction.clientId,
      got: best.loginMatch ? transaction.clientId : '(outra conta)',
    },
    {
      label: 'Valor',
      ok: best.amountMatch,
      expected: formatCurrency(transaction.amount, transaction.currency),
      got:
        best.sourceAmount != null
          ? formatCurrency(best.sourceAmount, (best.sourceCurrency as 'USD' | 'EUR' | 'GBP') ?? transaction.currency)
          : '-',
    },
    {
      label: 'Moeda',
      ok: best.currencyMatch,
      expected: transaction.currency,
      got: best.sourceCurrency ?? '-',
    },
    {
      label: 'Data',
      ok: best.dateMatch,
      expected: formatDateBR(transaction.transactionDate),
      got: best.sourceDate ? formatDateBR(best.sourceDate) : '-',
    },
  ]
  const wrongs = rows.filter((r) => !r.ok)
  return (
    <div className="space-y-3 text-xs">
      <p className="text-app-text">
        Encontramos a transação <span className="font-mono font-semibold">#{best.sourceTransactionId}</span> do sistema de origem batendo em <span className="font-semibold">{best.matchCount} de 4</span> campos. Provavelmente é ela, mas há divergência em:
      </p>
      <ul className="space-y-2">
        {wrongs.map((r) => (
          <li
            key={r.label}
            className="rounded-md border border-red-500/20 bg-app-card px-3 py-2"
          >
            <div className="mb-1 flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
              <XCircle size={12} /> {r.label} não bate
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div className="text-app-muted">Registrado</div>
                <div className="text-app-text">{r.expected}</div>
              </div>
              <div>
                <div className="text-app-muted">No sistema de origem</div>
                <div className="text-app-text">{r.got}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <details className="text-[11px] text-app-muted">
        <summary className="cursor-pointer hover:text-app-text">Ver campos que bateram</summary>
        <ul className="mt-2 space-y-1">
          {rows
            .filter((r) => r.ok)
            .map((r) => (
              <li key={r.label} className="flex items-center gap-2">
                <CheckCircle2 size={11} className="text-green-500" />
                {r.label}: {r.expected}
              </li>
            ))}
        </ul>
      </details>
    </div>
  )
}

/**
 * Fallback quando o sistema NÃO achou nenhuma tx com >=2 campos batendo. Lista
 * os checks "soltos" (qualquer linha do source com login=X, qualquer com
 * amount=Y, etc.): útil pra dizer "a conta existe no sistema de origem mas nada bate
 * com valor/data/moeda" ou "essa conta não existe".
 */
function SoloChecks({
  transaction,
  checks,
  isDuplicate,
}: {
  transaction: Transaction
  checks?: ValidationChecks
  isDuplicate: boolean
}) {
  const c = checks ?? {}
  // Se a `login` não existe no sistema de origem (`id_check=false`), os demais checks
  // são todos derivados ("registro DE essa conta com X"), mostrar tudo só
  // amplifica ruído quando o problema é UM: a conta não existe. Decisão
  // 2026-05-26: nesse caso, exibe APENAS a linha da conta do cliente.
  // A conta é o start da validação; sem ela, nada mais faz sentido apontar.
  const items: { label: string; ok: boolean }[] = !c.id_check
    ? [
        {
          label: `Conta ${transaction.clientId} não encontrada no sistema de origem`,
          ok: false,
        },
      ]
    : [
        { label: `Conta ${transaction.clientId} existe no sistema de origem`, ok: !!c.id_check },
        {
          label: `Algum registro de ${formatCurrency(transaction.amount, transaction.currency)} dessa conta`,
          ok: !!c.value_check,
        },
        {
          label: `Moeda ${transaction.currency} usada por essa conta`,
          ok: !!c.currency_check,
        },
        {
          label: `Algum registro dessa conta em ${formatDateBR(transaction.transactionDate)}`,
          ok: !!c.date_check,
        },
      ]
  return (
    <ul className="space-y-1 text-xs">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          {it.ok ? (
            <CheckCircle2 size={12} className="text-green-500" />
          ) : (
            <XCircle size={12} className="text-red-500" />
          )}
          <span className={it.ok ? 'text-app-text' : 'text-app-muted'}>
            {it.label}
          </span>
        </li>
      ))}
      {isDuplicate && (
        <li className="flex items-center gap-2">
          <XCircle size={12} className="text-red-500" />
          <span className="text-app-muted">
            Transação já consumida por outro registro
          </span>
        </li>
      )}
    </ul>
  )
}

function SystemStatusCard({
  status,
  transaction,
}: {
  status: SystemValidation
  transaction?: Transaction
}) {
  const styles: Record<SystemValidation, { color: string; label: string; description: string }> = {
    pending: {
      color: 'border-app-border bg-app-elev/40 text-app-muted',
      label: 'Aguardando validação automática',
      description:
        'Cruzamento com transações do sistema de origem roda em até 12h após a data do registro.',
    },
    verified: {
      color: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
      label: 'Verificado pelo sistema',
      description: 'Os dados batem com a base transacional da origem.',
    },
    invalid: {
      color: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
      label: 'Inválido',
      description: 'Não foi encontrada uma transação correspondente.',
    },
    duplicate: {
      color: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
      label: 'Duplicado',
      description: 'Outro registro já consumiu essa transação.',
    },
  }
  const s = styles[status]
  // Sobrescreve label/descrição em duplicate com a contagem real.
  if (status === 'duplicate' && transaction) {
    const count = replicationCount(transaction)
    s.label = replicationLabel(count)
    s.description =
      count > 2
        ? `${count} registros do mesmo (conta · valor · moeda · data). Só o primeiro entra na comissão.`
        : 'Outro registro já consumiu essa transação.'
  }
  return (
    <div className={`rounded-lg border px-4 py-3 text-xs ${s.color}`}>
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <Bot size={12} /> {s.label}
      </div>
      <p>{s.description}</p>
    </div>
  )
}

/**
 * Card do status de parceria no expand, visual, só pra admin/super_admin. Mostra a
 * classificação (Dentro da parceria / Em outra parceria / Sem parceria). `showValue`
 * (super_admin) adiciona o valor cru do PartnerCode. Some quando a transação não
 * é verified ou a parceria ainda não foi consultado.
 */
function PartnerStatusCard({
  transaction,
  showValue,
}: {
  transaction: Transaction
  showValue: boolean
}) {
  const status = partnerStatusOf(transaction)
  if (!status) return null
  const cls =
    status === 'dentro'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : status === 'outro'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  const Icon = status === 'dentro' ? CheckCircle2 : AlertOctagon
  return (
    <div className={`rounded-lg border px-4 py-3 text-xs ${cls}`}>
      <div className="flex items-center gap-1.5 font-medium">
        <Icon size={12} /> {partnerStatusLabel[status]}
        {showValue && transaction.sourcePartnerCode && (
          <span className="ml-1 font-mono font-semibold tabular-nums opacity-90">
            · PartnerCode {transaction.sourcePartnerCode}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Célula "Perfil CRM" no grid de dados do cliente, mostra a classificação
 * Premium/Starter/Não encontrado (Pipedrive), gravada em `pipedriveTribe`. Visível
 * a todos os papéis. Quando ainda não classificado (undefined), mostra "-".
 *
 * ⚠️ PRODUTO do cliente, não SETOR do gestor. Cores distintas do SetorBadge.
 */
function TribeField({ transaction }: { transaction: Transaction }) {
  const t = tribeOf(transaction)
  const cls =
    t === 'premium'
      ? 'text-violet-700 dark:text-violet-300'
      : t === 'starter'
        ? 'text-cyan-700 dark:text-cyan-300'
        : 'text-app-muted'
  const by =
    transaction.pipedriveMatchedBy === 'email'
      ? 'por email'
      : transaction.pipedriveMatchedBy === 'phone'
        ? 'por telefone'
        : null
  const found = t === 'premium' || t === 'starter'
  const addTime = transaction.pipedriveDealAddTime
  const addTimeStr =
    typeof addTime === 'string' ? formatDateBR(addTime.slice(0, 10)) : null
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-app-muted">
        Perfil CRM
      </div>
      <div className={`mt-0.5 font-medium ${cls}`}>
        {t ? tribeLabel[t] : '-'}
        {found && by && (
          <span className="ml-1 text-[10px] font-normal text-app-subtle">({by})</span>
        )}
      </div>
      {found && (addTimeStr || transaction.pipedriveStage) && (
        <div className="mt-0.5 space-y-0.5 text-[10.5px] leading-snug text-app-subtle">
          {addTimeStr && <div>Entrou em {addTimeStr}</div>}
          {transaction.pipedriveStage && (
            <div>
              Etapa: <span className="text-app-muted">{transaction.pipedriveStage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConversationStatusCard({ status }: { status: ConversationValidation }) {
  const styles: Record<ConversationValidation, { color: string; label: string }> = {
    pending: {
      color: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      label: 'Conversa aguardando revisão',
    },
    approved: {
      color: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
      label: 'Conversa aprovada',
    },
    rejected: {
      color: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
      label: 'Conversa rejeitada',
    },
  }
  const s = styles[status]
  return (
    <div className={`rounded-lg border px-4 py-3 text-xs font-medium ${s.color}`}>
      {s.label}
    </div>
  )
}

function Field({
  label,
  value,
  highlight,
  status,
}: {
  label: string
  value: string
  highlight?: boolean
  /** Quando setado, pinta o campo de verde (ok) ou vermelho (fail) com ícone. */
  status?: 'ok' | 'fail'
}) {
  const wrapperCls =
    status === 'ok'
      ? 'rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1.5'
      : status === 'fail'
        ? 'rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5'
        : ''
  const labelCls =
    status === 'ok'
      ? 'text-green-700 dark:text-green-300'
      : status === 'fail'
        ? 'text-red-700 dark:text-red-300'
        : 'text-app-muted'
  const valueCls = highlight
    ? status === 'fail'
      ? 'text-base font-semibold text-red-700 dark:text-red-300'
      : status === 'ok'
        ? 'text-base font-semibold text-green-700 dark:text-green-300'
        : 'text-base font-semibold text-green-600 dark:text-green-400'
    : status === 'fail'
      ? 'text-red-700 dark:text-red-300 font-medium'
      : status === 'ok'
        ? 'text-green-700 dark:text-green-300 font-medium'
        : 'text-app-text'
  return (
    <div className={wrapperCls}>
      <div className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider ${labelCls}`}>
        {status === 'ok' && <CheckCircle2 size={10} />}
        {status === 'fail' && <XCircle size={10} />}
        {label}
      </div>
      <div className={`mt-0.5 ${valueCls}`}>{value}</div>
    </div>
  )
}

/**
 * Chip explicativo da conversão pra USD que vai pra comissão. Mostra valor
 * convertido + cotação utilizada + data efetiva da cotação. Se `usdAmount`
 * estiver ausente (cotação falhou na criação), oferece botão pra puxar a
 * cotação agora.
 */
function UsdConversionNote({ transaction }: { transaction: Transaction }) {
  const original = formatCurrency(transaction.amount, transaction.currency)
  const hasConversion =
    typeof transaction.usdAmount === 'number' && typeof transaction.usdRate === 'number'
  const [recalcing, setRecalcing] = useState(false)
  const [recalcError, setRecalcError] = useState<string | null>(null)

  const onRecalc = async () => {
    setRecalcing(true)
    setRecalcError(null)
    try {
      const ok = await recalcUsdConversion(transaction, { logManual: true })
      if (!ok) {
        setRecalcError(
          'Não foi possível consultar a cotação (verifique sua conexão).',
        )
      }
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : 'Erro ao recalcular')
    } finally {
      setRecalcing(false)
    }
  }

  if (!hasConversion) {
    return (
      <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-700 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <AlertOctagon size={12} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            Conversão pra USD pendente. Comissão está usando face-value (
            {original}) até puxar a cotação do dia ({formatDateBR(transaction.transactionDate)}).
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onRecalc}
            disabled={recalcing}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-800 transition-colors hover:bg-amber-500/25 disabled:opacity-60 dark:text-amber-100"
          >
            {recalcing ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Bot size={11} />
            )}
            {recalcing ? 'Consultando…' : 'Puxar cotação do BCE'}
          </button>
          {recalcError && (
            <span className="text-[10px] text-rose-600 dark:text-rose-300">
              {recalcError}
            </span>
          )}
        </div>
      </div>
    )
  }
  const converted = formatMoney(transaction.usdAmount!)
  const rate = transaction.usdRate!
  const rateDate = transaction.usdRateDate ?? transaction.transactionDate
  return (
    <div className="mt-1 flex items-start gap-2 rounded-md border border-app-border bg-app-elev/40 px-3 py-2 text-[11px] text-app-muted">
      <Bot size={12} className="mt-0.5 shrink-0 text-app-subtle" />
      <div className="space-y-0.5">
        <div>
          <span className="text-app-text">{original}</span>{' '}
          <span className="text-app-subtle">≈</span>{' '}
          <span className="font-mono font-semibold tabular-nums text-app-text">
            {converted}
          </span>{' '}
          <span className="text-app-subtle">
           , convertido para comissão.
          </span>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-app-subtle">
          Cotação BCE: 1 {transaction.currency} = {rate.toFixed(4)} USD em{' '}
          {formatDateBR(rateDate)}
        </div>
      </div>
    </div>
  )
}

const MONTH_LABELS_LONG = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function monthLabelLong(yearMonth?: string): string {
  if (!yearMonth) return '-'
  const [y, m] = yearMonth.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return yearMonth
  return `${MONTH_LABELS_LONG[m - 1]} de ${y}`
}

/**
 * Painel comissional da transação: explica o que vai ser pago, em qual mês,
 * e o que ainda bloqueia o pagamento (sistema/conversa pendente, ativação
 * sem operação, etc.). Reusa `commissionForTransaction` da mesma lib que alimenta
 * fechamento e tela de Comissões Pendentes pra garantir consistência.
 */
function CommissionDetailCard({ transaction }: { transaction: Transaction }) {
  const c = commissionForTransaction(transaction)
  const final = finalStatus(transaction)
  const usdAmt = effectiveUsdAmount(transaction)
  const pctEstimate = usdAmt * TRANSACTION_PCT
  // Bônus de ativação escalonado por dias na Premium/Starter (CRM).
  const activationBonus = activationBonusForTransaction(transaction)
  const tierHint = activationBonusReason(transaction)

  // Cabeçalho do card varia conforme o estado.
  let headerTone: 'green' | 'amber' | 'rose'
  let headerLabel: string
  let headerDesc: string

  if (final === 'pending') {
    headerTone = 'amber'
    headerLabel = 'Comissão pendente da validação'
    if (transaction.systemValidation === 'pending' && transaction.conversationValidation === 'pending') {
      headerDesc = 'Aguardando o cruzamento automático do sistema e a aprovação da conversa.'
    } else if (transaction.systemValidation === 'pending') {
      headerDesc = 'Aguardando o cruzamento automático com o sistema de origem (até 12h após o registro).'
    } else {
      headerDesc = 'Aguardando aprovação da conversa.'
    }
  } else if (final === 'rejected') {
    headerTone = 'rose'
    headerLabel = 'Comissão não se aplica'
    const sysBad =
      transaction.systemValidation === 'invalid' || transaction.systemValidation === 'duplicate'
    const convBad = transaction.conversationValidation === 'rejected'
    if (sysBad && convBad) {
      headerDesc = 'Sistema invalidou e conversa rejeitou esse registro.'
    } else if (sysBad) {
      headerDesc =
        transaction.systemValidation === 'duplicate'
          ? 'Sistema marcou como duplicata: outra entrada já consumiu essa transação.'
          : 'Sistema invalidou esse registro: sem comissão.'
    } else {
      headerDesc = 'Conversa rejeitou esse registro, sem comissão.'
    }
  } else if (c.status === 'pending_operation') {
    headerTone = 'amber'
    headerLabel = 'Comissão parcial: aguardando 1ª operação do cliente'
    headerDesc =
      'O bônus fixo já está garantido; o 1% só será creditado quando o cliente abrir a primeira operação.'
  } else if (c.status === 'not_eligible') {
    headerTone = 'rose'
    headerLabel = 'Comissão parcial: 1% perdido'
    headerDesc =
      'O bônus fixo foi pago, mas o 1% não se aplica porque o cliente operou antes do registro ou nunca operou.'
  } else {
    headerTone = 'green'
    headerLabel = 'Comissão validada'
    headerDesc = 'Todos os componentes desse registro estão liberados para pagamento.'
  }

  const headerCls: Record<typeof headerTone, string> = {
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  }

  return (
    <section className="overflow-hidden rounded-lg border border-app-border bg-app-card">
      <div className={`border-b px-4 py-3 text-xs ${headerCls[headerTone]}`}>
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <DollarSign size={12} /> {headerLabel}
        </div>
        <p>{headerDesc}</p>
      </div>

      <dl className="divide-y divide-app-border/60">
        <CommissionRow
          label="Tipo do registro"
          value={
            transaction.isActivation ? (
              <span className="inline-flex items-center gap-1 rounded border border-app-border bg-app-elev px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-app-text">
                <UserPlus size={9} /> ativação
              </span>
            ) : (
              <span className="text-[11px] text-app-muted">registro comum</span>
            )
          }
        />

        {transaction.isActivation && (
          <CommissionRow
            label={`Bônus de ativação (US$ ${activationBonus})`}
            hint={
              (final === 'validated'
                ? `Creditado em ${monthLabelLong(c.fixedPayoutMonth)}`
                : final === 'rejected'
                  ? 'Não será pago'
                  : 'Será creditado no mês do registro quando validado') +
              ` · ${tierHint}`
            }
            value={
              final === 'validated'
                ? <PaidTag amount={formatMoney(c.fixedUsd)} tone="paid" />
                : final === 'rejected'
                  ? <PaidTag amount="-" tone="lost" />
                  : <PaidTag amount={formatMoney(activationBonus)} tone="pending" />
            }
          />
        )}

        <CommissionRow
          label={`1% sobre o volume`}
          hint={
            final === 'validated' && c.status === 'eligible'
              ? `Creditado em ${monthLabelLong(c.percentagePayoutMonth)}`
              : final === 'validated' && c.status === 'pending_operation'
                ? 'Será creditado no mês da 1ª operação do cliente'
                : final === 'validated' && c.status === 'not_eligible'
                  ? 'Não se aplica: cliente operou antes do registro ou nunca operou'
                  : final === 'rejected'
                    ? 'Não será pago'
                    : 'Estimativa: vai depender da validação'
          }
          value={
            final === 'validated' && c.status === 'eligible' ? (
              <PaidTag amount={formatMoney(c.percentage)} tone="paid" />
            ) : final === 'validated' && c.status === 'pending_operation' ? (
              <PaidTag amount={formatMoney(pctEstimate)} tone="pending" />
            ) : final === 'validated' && c.status === 'not_eligible' ? (
              <PaidTag amount={formatMoney(pctEstimate)} tone="lost" />
            ) : final === 'rejected' ? (
              <PaidTag amount="-" tone="lost" />
            ) : (
              <PaidTag amount={formatMoney(pctEstimate)} tone="pending" hint="estimado" />
            )
          }
        />

        {transaction.isActivation && (
          <CommissionRow
            label="Operação posterior do cliente"
            value={
              <LastOperationLine transaction={transaction} />
            }
          />
        )}

        <CommissionRow
          label="Total a pagar nesse registro"
          value={
            <span
              className={`font-mono text-[14px] font-semibold tabular-nums ${
                final === 'validated' ? 'text-app-text' : 'text-app-subtle'
              }`}
            >
              {final === 'validated'
                ? formatMoney(c.fixedUsd + c.percentage)
                : final === 'rejected'
                  ? '-'
                  : formatMoney((transaction.isActivation ? activationBonus : 0) + pctEstimate)}
            </span>
          }
          hint={
            final === 'validated'
              ? 'Bruto, em USD'
              : final === 'rejected'
                ? 'Registro invalidado'
                : 'Estimativa até a validação finalizar'
          }
          bold
        />
      </dl>
    </section>
  )
}

function CommissionRow({
  label,
  value,
  hint,
  bold,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <dt
          className={`text-[10.5px] font-medium uppercase tracking-[0.12em] ${bold ? 'text-app-text' : 'text-app-muted'}`}
        >
          {label}
        </dt>
        {hint && (
          <dd className="mt-0.5 text-[10.5px] leading-snug text-app-subtle">
            {hint}
          </dd>
        )}
      </div>
      <dd className="shrink-0 text-right">{value}</dd>
    </div>
  )
}

function PaidTag({
  amount,
  tone,
  hint,
}: {
  amount: string
  tone: 'paid' | 'pending' | 'lost'
  hint?: string
}) {
  const cls =
    tone === 'paid'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'pending'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-app-subtle line-through'
  return (
    <div className="flex flex-col items-end">
      <div className={`font-mono text-[12.5px] font-semibold tabular-nums ${cls}`}>
        {amount}
      </div>
      {hint && <div className="text-[9.5px] text-app-subtle">{hint}</div>}
    </div>
  )
}

function LastOperationLine({ transaction }: { transaction: Transaction }) {
  const lod = transaction.lastOperationDate
  if (lod === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
        <Hourglass size={10} /> Sem dado do sistema de origem ainda
      </span>
    )
  }
  if (lod === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
        <XCircle size={10} /> Cliente nunca operou
      </span>
    )
  }
  const opIso = String(lod).slice(0, 10)
  // Regra 2026-05-20: operar no MESMO DIA conta como elegível (`>=`).
  const onOrAfterTransaction = opIso >= transaction.transactionDate
  const sameDay = opIso === transaction.transactionDate
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${
        onOrAfterTransaction
          ? 'text-emerald-700 dark:text-emerald-300'
          : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {onOrAfterTransaction ? (
        <CheckCircle2 size={10} />
      ) : (
        <XCircle size={10} />
      )}
      {onOrAfterTransaction
        ? sameDay
          ? `Operou no mesmo dia (${formatDateBR(opIso)})`
          : `Operou em ${formatDateBR(opIso)}`
        : `Operou antes em ${formatDateBR(opIso)}`}
    </span>
  )
}
