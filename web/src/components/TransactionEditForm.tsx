import React, { forwardRef, useRef, useState } from 'react'
import {
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../contexts/AuthContext'
import {
  appendReceipts,
  applyTransactionEditDirect,
  removeReceipt,
  requestTransactionEdit,
  uploadPendingReceipts,
} from '../lib/transactions'
import type { TransactionEditPayload } from '../lib/transactions'
import type { Transaction } from '../types'
import { setoresInScope } from '../types'
import { CountryPhoneInput } from './CountryPhoneInput'
import { parsePhone } from '../lib/countries'

/**
 * Normaliza valor monetário digitado: vírgula vira ponto, qualquer outro
 * caractere não numérico é descartado. Lança erro se sobrar string vazia.
 *
 * Aceita ambas as notações (BR/EN) pra ser tolerante a paste, mas o input em
 * si bloqueia o ponto antes de chegar aqui via `decimalInputProps`.
 */
const monetaryString = (opts: { allowNegative?: boolean; min?: number } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === 'number') return v
      const cleaned = String(v).trim().replace(/\./g, '').replace(/,/g, '.')
      const n = Number(cleaned)
      if (!isFinite(n)) return NaN
      return n
    })
    .refine((n) => !Number.isNaN(n), 'Valor inválido')
    .refine(
      (n) => (opts.allowNegative ? true : n >= 0),
      'Não pode ser negativo',
    )
    .refine((n) => (opts.min !== undefined ? n >= opts.min : true), {
      message: 'Valor fora do permitido',
    })

const schema = z.object({
  clientName: z.string().min(1, 'Obrigatório'),
  clientEmail: z.string().email('Email inválido'),
  clientPhoneDial: z.string().min(1, 'Obrigatório'),
  clientPhone: z.string().min(1, 'Obrigatório'),
  clientId: z
    .string()
    .min(1, 'Obrigatório')
    .regex(/^\d+$/, 'Somente dígitos'),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  amount: monetaryString({ min: 0.01 }),
  transactionDate: z.string().min(1, 'Obrigatório'),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

interface Props {
  transaction: Transaction
  /** 'agent' (default): cria pendingEdit pra aprovação. 'admin': aplica direto. */
  mode?: 'agent' | 'admin'
  onSuccess?: () => void
}

export function TransactionEditForm({ transaction, mode = 'agent', onSuccess }: Props) {
  const { user, agente } = useAuth()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  // Gestor não vê nomenclatura de sistema de origem/transação, usa "Registro/Volume/Identificação".
  // Admin/supervisor pra cima mantém os labels originais.
  const isAgent = mode === 'agent'

  // Estado local pra alterações de imagem do GESTOR (mode='agent').
  // Adicionar uma imagem: já faz upload em path pending e empilha a URL em
  // `added`. Remover uma existente: empilha em `removed`. O pendingEdit é
  // criado ao submit junto com os campos texto. Pro mode='admin'/'supervisor',
  // o ReceiptsEditor aplica direto e esses estados ficam vazios.
  const [pendingAdded, setPendingAdded] = useState<{
    transaction: string[]
    conversation: string[]
  }>({ transaction: [], conversation: [] })
  const [pendingRemoved, setPendingRemoved] = useState<{
    transaction: string[]
    conversation: string[]
  }>({ transaction: [], conversation: [] })

  const parsed = parsePhone(transaction.clientPhone)
  const defaults: FormInput = {
    clientName: transaction.clientName,
    clientEmail: transaction.clientEmail,
    clientPhoneDial: parsed.dial,
    clientPhone: parsed.phone,
    clientId: transaction.clientId,
    currency: transaction.currency,
    amount: transaction.amount as unknown as number,
    transactionDate: transaction.transactionDate,
  }

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null)
    if (!user) return
    // Calcula o diff: somente campos que mudaram
    const changes: TransactionEditPayload = {}
    if (data.clientName !== transaction.clientName) changes.clientName = data.clientName
    if (data.clientEmail !== transaction.clientEmail) changes.clientEmail = data.clientEmail
    const newPhone = `+${data.clientPhoneDial} ${data.clientPhone}`.trim()
    if (newPhone !== transaction.clientPhone) changes.clientPhone = newPhone
    if (data.clientId !== transaction.clientId) changes.clientId = data.clientId
    if (data.currency !== transaction.currency) changes.currency = data.currency
    if (Number(data.amount) !== transaction.amount) changes.amount = Number(data.amount)
    if (data.transactionDate !== transaction.transactionDate) changes.transactionDate = data.transactionDate

    // Alterações de imagem (só gestor: admin/supervisor aplica direto).
    if (mode === 'agent') {
      if (pendingAdded.transaction.length > 0)
        changes.addedTransactionReceipts = pendingAdded.transaction
      if (pendingRemoved.transaction.length > 0)
        changes.removedTransactionReceipts = pendingRemoved.transaction
      if (pendingAdded.conversation.length > 0)
        changes.addedConversationReceipts = pendingAdded.conversation
      if (pendingRemoved.conversation.length > 0)
        changes.removedConversationReceipts = pendingRemoved.conversation
    }

    if (Object.keys(changes).length === 0) {
      setSubmitError('Nenhuma alteração detectada.')
      return
    }
    try {
      if (mode === 'admin') {
        // Supervisor: cascata só toca o escopo dele. Admin/super_admin: tudo.
        await applyTransactionEditDirect(transaction, changes, {
          actorSetores:
            agente?.role === 'supervisor' && agente?.setor
              ? setoresInScope(agente.setor)
              : undefined,
        })
      } else {
        await requestTransactionEdit(transaction, user.uid, changes)
      }
      setSubmitted(true)
      setTimeout(() => {
        setSubmitted(false)
        onSuccess?.()
      }, 1400)
    } catch (err) {
      console.error(err)
      setSubmitError(err instanceof Error ? err.message : 'Falha ao enviar edição')
    }
  })

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === 'agent' ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          Sua edição será revisada por um admin. As alterações só entram em vigor após
          a aprovação.
        </p>
      ) : (
        <p className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-200">
          Edição aplicada diretamente. Se mudar valor, conta ou data, a validação
          do sistema é resetada e roda de novo.
        </p>
      )}

      <Field label="Nome do cliente" error={errors.clientName?.message}>
        <input type="text" {...register('clientName')} className={inputCls} />
      </Field>

      <Field label="Email" error={errors.clientEmail?.message}>
        <input type="email" {...register('clientEmail')} className={inputCls} />
      </Field>

      <Field
        label="Telefone"
        error={errors.clientPhoneDial?.message ?? errors.clientPhone?.message}
      >
        <Controller
          control={control}
          name="clientPhoneDial"
          render={({ field: dialField }) => (
            <Controller
              control={control}
              name="clientPhone"
              render={({ field: phoneField }) => (
                <CountryPhoneInput
                  dial={dialField.value ?? ''}
                  phone={phoneField.value ?? ''}
                  onDialChange={dialField.onChange}
                  onPhoneChange={phoneField.onChange}
                />
              )}
            />
          )}
        />
      </Field>

      <Field
        label={isAgent ? 'Identificação' : 'Conta do cliente'}
        error={errors.clientId?.message}
      >
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="Somente números"
          {...register('clientId')}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="Moeda" error={errors.currency?.message}>
          <select {...register('currency')} className={inputCls}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </Field>
        <Field
          label={isAgent ? 'Volume registrado' : 'Volume'}
          error={errors.amount?.message}
        >
          <DecimalCell {...register('amount')} />
        </Field>
      </div>

      <Field
        label={isAgent ? 'Data do registro' : 'Data do registro'}
        error={errors.transactionDate?.message}
      >
        <input type="date" {...register('transactionDate')} className={inputCls} />
      </Field>

      {!isAgent && (
        <p className="text-[11px] leading-snug text-app-subtle">
          Se mudar valor, moeda ou data, a cotação USD do dia do registro é
          consultada de novo automaticamente.
        </p>
      )}

      <ReceiptsEditor
        transaction={transaction}
        mode={mode}
        pendingAdded={pendingAdded}
        pendingRemoved={pendingRemoved}
        onPendingAddedChange={setPendingAdded}
        onPendingRemovedChange={setPendingRemoved}
      />

      {submitError && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {submitError}
        </p>
      )}
      {submitted && (
        <p className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
          {mode === 'admin' ? 'Edição aplicada!' : 'Edição enviada para revisão!'}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-green-500 px-4 py-3 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting
          ? 'Enviando…'
          : mode === 'admin'
            ? 'Salvar alterações'
            : 'Enviar edição para aprovação'}
      </button>
    </form>
  )
}

const inputCls =
  'w-full rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm text-app-text outline-none transition-colors focus:border-green-500 focus:ring-2 focus:ring-green-500/20'

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

/**
 * Input numérico do padrão BR (vírgula decimal). Bloqueia o ponto via
 * onKeyDown e normaliza qualquer ponto que escape (paste/IME) pra vírgula
 * no onChange: o schema Zod aceita ambas e converte pra number.
 */
const DecimalCell = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { allowNegative?: boolean }
>(function DecimalCell({ allowNegative = false, onChange, className, ...rest }, ref) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '.') {
      e.preventDefault()
      return
    }
    if (e.key === '-' && !allowNegative) {
      e.preventDefault()
    }
  }
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value.includes('.')) {
      e.target.value = e.target.value.replace(/\./g, ',')
    }
    onChange?.(e)
  }
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      onKeyDown={onKeyDown}
      onChange={handleChange}
      className={className ?? inputCls}
      {...rest}
    />
  )
})

/* -------------------------------------------------------------------------- */
/* Editor de comprovantes (transação + conversa)                                */
/* -------------------------------------------------------------------------- */

type ReceiptState = { transaction: string[]; conversation: string[] }

/**
 * Bloco que permite anexar/remover imagens de comprovante DURANTE a edição.
 *
 * Comportamento por modo:
 * - **'admin'** (admin / supervisor / super_admin): aplica direto no Firestore
 *   sem passar pelo pendingEdit. Supervisor é tratado igual admin aqui, ele
 *   tem ação completa sobre transações do setor.
 * - **'agent'**: faz upload imediato em `transactions/<id>/pending/...`, mas as
 *   alterações ficam num *state local* (added/removed). Só são consolidadas
 *   quando o admin aprovar o pendingEdit. Se o admin rejeitar, as imagens
 *   adicionadas em pending são apagadas do Storage.
 */
function ReceiptsEditor({
  transaction,
  mode,
  pendingAdded,
  pendingRemoved,
  onPendingAddedChange,
  onPendingRemovedChange,
}: {
  transaction: Transaction
  mode: 'agent' | 'admin'
  pendingAdded: ReceiptState
  pendingRemoved: ReceiptState
  onPendingAddedChange: React.Dispatch<React.SetStateAction<ReceiptState>>
  onPendingRemovedChange: React.Dispatch<React.SetStateAction<ReceiptState>>
}) {
  return (
    <div className="space-y-3 rounded-lg border border-app-border bg-app-elev/30 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-app-muted">
          Comprovantes
        </h4>
        <span className="text-[10.5px] text-app-subtle">
          {mode === 'admin'
            ? 'alterações aplicadas imediatamente'
            : 'alterações entram quando admin aprovar a edição'}
        </span>
      </div>
      <ReceiptKind
        transaction={transaction}
        kind="transaction"
        label="Comprovantes de registro"
        tone="green"
        mode={mode}
        pendingAdded={pendingAdded.transaction}
        pendingRemoved={pendingRemoved.transaction}
        onPendingAdd={(urls) =>
          onPendingAddedChange((s) => ({ ...s, transaction: [...s.transaction, ...urls] }))
        }
        onPendingRemove={(url) =>
          onPendingRemovedChange((s) => ({
            ...s,
            transaction: s.transaction.includes(url) ? s.transaction : [...s.transaction, url],
          }))
        }
        onUndoPendingRemove={(url) =>
          onPendingRemovedChange((s) => ({
            ...s,
            transaction: s.transaction.filter((u) => u !== url),
          }))
        }
        onCancelPendingAdd={(url) =>
          onPendingAddedChange((s) => ({
            ...s,
            transaction: s.transaction.filter((u) => u !== url),
          }))
        }
      />
      <ReceiptKind
        transaction={transaction}
        kind="conversation"
        label="Comprovantes de conversa"
        tone="blue"
        mode={mode}
        pendingAdded={pendingAdded.conversation}
        pendingRemoved={pendingRemoved.conversation}
        onPendingAdd={(urls) =>
          onPendingAddedChange((s) => ({
            ...s,
            conversation: [...s.conversation, ...urls],
          }))
        }
        onPendingRemove={(url) =>
          onPendingRemovedChange((s) => ({
            ...s,
            conversation: s.conversation.includes(url)
              ? s.conversation
              : [...s.conversation, url],
          }))
        }
        onUndoPendingRemove={(url) =>
          onPendingRemovedChange((s) => ({
            ...s,
            conversation: s.conversation.filter((u) => u !== url),
          }))
        }
        onCancelPendingAdd={(url) =>
          onPendingAddedChange((s) => ({
            ...s,
            conversation: s.conversation.filter((u) => u !== url),
          }))
        }
      />
    </div>
  )
}

function ReceiptKind({
  transaction,
  kind,
  label,
  tone,
  mode,
  pendingAdded,
  pendingRemoved,
  onPendingAdd,
  onPendingRemove,
  onUndoPendingRemove,
  onCancelPendingAdd,
}: {
  transaction: Transaction
  kind: 'transaction' | 'conversation'
  label: string
  tone: 'green' | 'blue'
  mode: 'agent' | 'admin'
  pendingAdded: string[]
  pendingRemoved: string[]
  onPendingAdd: (urls: string[]) => void
  onPendingRemove: (url: string) => void
  onUndoPendingRemove: (url: string) => void
  onCancelPendingAdd: (url: string) => void
}) {
  const urls =
    kind === 'transaction'
      ? transaction.transactionReceiptUrls ?? []
      : transaction.conversationReceiptUrls ?? []
  const [busyUrl, setBusyUrl] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const ring = tone === 'green' ? 'ring-green-500/30' : 'ring-blue-500/30'
  const isAgent = mode === 'agent'

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    const files = Array.from(list)
    setError(null)
    setAdding(true)
    try {
      if (isAgent) {
        // Gestor: upload provisório → URLs entram no state local. O pendingEdit
        // só é criado ao submit do form.
        const newUrls = await uploadPendingReceipts(transaction, kind, files)
        onPendingAdd(newUrls)
      } else {
        // Admin/supervisor: aplica direto.
        await appendReceipts(transaction, kind, files)
      }
    } catch (err) {
      console.error('upload receipts falhou:', err)
      setError(err instanceof Error ? err.message : 'Falha ao enviar')
    } finally {
      setAdding(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onRemove = async (url: string) => {
    setError(null)
    if (isAgent) {
      // Gestor: marca pra remover ao submeter. Storage não é tocado agora.
      onPendingRemove(url)
      return
    }
    setBusyUrl(url)
    try {
      await removeReceipt(transaction, kind, url)
    } catch (err) {
      console.error('removeReceipt falhou:', err)
      setError(err instanceof Error ? err.message : 'Falha ao remover')
    } finally {
      setBusyUrl(null)
    }
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-app-border bg-app-card ring-1 ${ring}`}>
      <div className="flex items-center justify-between px-3 py-2 text-[11px]">
        <span className="font-medium text-app-text">{label}</span>
        <span className="text-app-subtle">
          {urls.length} {urls.length === 1 ? 'imagem' : 'imagens'}
          {isAgent && pendingAdded.length > 0 && (
            <span className="ml-1 text-amber-600 dark:text-amber-300">
              · +{pendingAdded.length} pendente{pendingAdded.length === 1 ? '' : 's'}
            </span>
          )}
          {!isAgent && (pendingAdded.length > 0 || pendingRemoved.length > 0) && (
            <span className="ml-1 text-amber-600 dark:text-amber-300">
              · pendente: +{pendingAdded.length} / -{pendingRemoved.length}
            </span>
          )}
        </span>
      </div>
      {isAgent ? (
        // Gestor: não vê preview, mas vê slots numerados com botão de remover
        // (decisão 2026-05-22). Pode marcar imagens 2+ pra remoção; precisa
        // manter pelo menos 1 imagem original do conjunto. Pending added = pode
        // cancelar sempre. Supervisor+ visualiza thumbnails normais.
        <AgentReceiptSlots
          urls={urls}
          pendingAdded={pendingAdded}
          pendingRemoved={pendingRemoved}
          onPendingRemove={onPendingRemove}
          onUndoPendingRemove={onUndoPendingRemove}
          onCancelPendingAdd={onCancelPendingAdd}
        />
      ) : urls.length === 0 && pendingAdded.length === 0 ? (
        <div className="px-3 pb-2 text-[10.5px] text-app-subtle">
          Sem imagens ainda. Use o botão abaixo pra anexar.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1 px-2 pb-2">
          {urls.map((u) => {
            const marked = pendingRemoved.includes(u)
            return (
              <div
                key={u}
                className={`group relative aspect-square overflow-hidden rounded border bg-app-bg ${
                  marked
                    ? 'border-rose-500/60 ring-2 ring-rose-500/40'
                    : 'border-app-border'
                }`}
              >
                <img
                  src={u}
                  alt=""
                  className={`h-full w-full object-cover ${marked ? 'opacity-40' : ''}`}
                />
                {marked && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-rose-500/30">
                    <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
                      remover
                    </span>
                  </div>
                )}
                {marked && isAgent ? (
                  <button
                    type="button"
                    onClick={() => onUndoPendingRemove(u)}
                    title="Desfazer remoção"
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-app-border bg-app-card text-app-muted opacity-0 transition-opacity hover:text-app-text group-hover:opacity-100"
                  >
                    <RotateCcw size={11} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRemove(u)}
                    disabled={busyUrl === u}
                    title={isAgent ? 'Marcar pra remover na edição' : 'Remover imagem'}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-500/40 bg-rose-500/80 text-white opacity-0 transition-opacity hover:bg-rose-500 group-hover:opacity-100 disabled:opacity-100"
                  >
                    {busyUrl === u ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                )}
              </div>
            )
          })}
          {/* Imagens adicionadas no state local do gestor, ainda aguardando admin */}
          {isAgent &&
            pendingAdded.map((u) => (
              <div
                key={u}
                className="group relative aspect-square overflow-hidden rounded border border-emerald-500/60 bg-app-bg ring-2 ring-emerald-500/40"
              >
                <img src={u} alt="" className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
                  <span className="mt-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
                    nova
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onCancelPendingAdd(u)}
                  title="Cancelar adição"
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-app-border bg-app-card text-app-muted opacity-0 transition-opacity hover:text-app-text group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-app-border bg-app-elev/30 px-3 py-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPickFiles}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-card px-2.5 py-1 text-[11px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:opacity-60"
        >
          {adding ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <ImagePlus size={11} />
          )}
          {adding ? 'Enviando…' : 'Adicionar imagens'}
        </button>
        {error && (
          <span className="truncate text-[10px] text-rose-600 dark:text-rose-400">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * UI de comprovantes pro Gestor: slots numerados sem preview de imagem.
 *
 * Cada slot mostra "Imagem #N" + ícone genérico + botão de remover. Qualquer
 * slot pode ser removido (decisão 2026-05-22, ajustada): o gestor não pode
 * VER os comprovantes, mas pode incluir e excluir à vontade.
 *
 * Imagens já adicionadas no state local do gestor durante esta edição
 * (pendingAdded) aparecem como "Nova imagem #N" e podem ser canceladas.
 *
 * Como o gestor não pode ver os comprovantes (decisão de privacidade), a
 * remoção é "às cegas". O slot mostra um índice estável (1, 2, 3...) pra que
 * ao menos haja uma referência se o supervisor depois questionar qual foi.
 */
function AgentReceiptSlots({
  urls,
  pendingAdded,
  pendingRemoved,
  onPendingRemove,
  onUndoPendingRemove,
  onCancelPendingAdd,
}: {
  urls: string[]
  pendingAdded: string[]
  pendingRemoved: string[]
  onPendingRemove: (url: string) => void
  onUndoPendingRemove: (url: string) => void
  onCancelPendingAdd: (url: string) => void
}) {
  const isEmpty = urls.length === 0 && pendingAdded.length === 0

  if (isEmpty) {
    return (
      <div className="px-3 pb-2 text-[10.5px] text-app-subtle">
        Sem imagens ainda. Use o botão abaixo pra anexar.
      </div>
    )
  }

  return (
    <ul className="space-y-1 px-3 pb-2">
      {urls.map((u, i) => {
        const marked = pendingRemoved.includes(u)

        return (
          <li
            key={u}
            className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-[11px] ${
              marked
                ? 'border-rose-500/40 bg-rose-500/[0.06]'
                : 'border-app-border bg-app-card'
            }`}
          >
            <span
              className={`inline-flex items-center gap-1.5 ${
                marked ? 'text-rose-700 line-through dark:text-rose-300' : 'text-app-text'
              }`}
            >
              <ImageIcon
                size={11}
                className={marked ? 'opacity-50' : 'text-app-muted'}
              />
              <span className="font-medium">
                Imagem {String(i + 1).padStart(2, '0')}
              </span>
              {marked && (
                <span className="ml-1 rounded bg-rose-600 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
                  remover
                </span>
              )}
            </span>
            {marked ? (
              <button
                type="button"
                onClick={() => onUndoPendingRemove(u)}
                title="Desfazer remoção"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-app-muted hover:bg-app-elev hover:text-app-text"
              >
                <RotateCcw size={10} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPendingRemove(u)}
                title="Marcar pra remover na edição"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-300"
              >
                <Trash2 size={10} />
              </button>
            )}
          </li>
        )
      })}
      {pendingAdded.map((u, i) => (
        <li
          key={u}
          className="flex items-center justify-between gap-2 rounded border border-emerald-500/40 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300"
        >
          <span className="inline-flex items-center gap-1.5">
            <ImageIcon size={11} />
            <span className="font-medium">
              Nova imagem {String(i + 1).padStart(2, '0')}
            </span>
            <span className="ml-1 rounded bg-emerald-600 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
              a anexar
            </span>
          </span>
          <button
            type="button"
            onClick={() => onCancelPendingAdd(u)}
            title="Cancelar adição"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
          >
            <Trash2 size={10} />
          </button>
        </li>
      ))}
    </ul>
  )
}

