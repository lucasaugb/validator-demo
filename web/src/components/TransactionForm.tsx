import React, { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Image as ImageIcon, Upload, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createTransaction } from '../lib/transactions'
import { todayISO } from '../lib/format'
import { CountryPhoneInput } from './CountryPhoneInput'
import {
  deleteDraft,
  generateNonce,
  loadDraft,
  saveDraft,
  type TransactionDraft,
} from '../lib/drafts'

const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * Schema: valores numéricos são preenchidos como STRING com vírgula decimal
 * (padrão BR). Validação:
 *  - normaliza ponto → vírgula (caso passe pelo filtro do input)
 *  - regex força apenas dígitos + uma vírgula opcional pra casa decimal
 *  - transform converte vírgula → ponto e retorna number
 */
const decimalString = (opts: { allowNegative?: boolean; min?: number } = {}) =>
  z
    .string()
    .min(1, 'Obrigatório')
    // Normaliza: substitui ponto por vírgula. O input já bloqueia ponto, mas
    // pra entradas vindas de autocomplete/colagem programática protege aqui.
    .transform((s) => s.replace(/\./g, ','))
    .pipe(
      z
        .string()
        .regex(
          opts.allowNegative ? /^-?\d+(,\d{1,2})?$/ : /^\d+(,\d{1,2})?$/,
          'Use vírgula para casa decimal (ex.: 1500,50)',
        ),
    )
    .transform((s) => Number(s.replace(',', '.')))
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
  amount: decimalString({ min: 0.01 }),
  transactionDate: z.string().min(1, 'Obrigatório'),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

export function TransactionForm({
  onSuccess,
  draftNonce,
}: {
  onSuccess?: () => void
  /**
   * Quando passado, o form abre como continuação de um rascunho salvo no
   * localStorage (recuperado do AgenteHome). Usa esse nonce como docId do
   * transaction ao enviar: idempotente.
   */
  draftNonce?: string
}) {
  const { user, agente } = useAuth()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [transactionFiles, setTransactionFiles] = useState<File[]>([])
  const [conversationFiles, setConversationFiles] = useState<File[]>([])
  const [fileErrors, setFileErrors] = useState<{ transaction?: string; conversation?: string }>({})

  // Nonce do formulário: gerado UMA vez quando o form abre (ou recebido via
  // prop quando o usuário "Continua" um rascunho). Vira o docId do transaction ao
  // enviar: 2º clique no submit tenta criar o MESMO docId, e a transação
  // rejeita duplicado em vez de criar 2 transactions. Persistido no localStorage
  // junto com o draft, então recarregar a página NÃO regenera (e portanto
  // continua idempotente entre recargas).
  const [nonce] = useState<string>(() => draftNonce ?? generateNonce())

  // Recupera draft salvo (se existir pro nonce), usado quando o usuário
  // clicou "continuar rascunho" no AgenteHome.
  const initialDraft = useMemo<TransactionDraft | null>(() => {
    if (!user || !draftNonce) return null
    return loadDraft(user.uid, draftNonce)
  }, [user, draftNonce])

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      transactionDate: initialDraft?.transactionDate ?? todayISO(),
      currency: initialDraft?.currency ?? 'USD',
      clientPhoneDial: initialDraft?.clientPhoneDial ?? '55',
      clientName: initialDraft?.clientName ?? '',
      clientEmail: initialDraft?.clientEmail ?? '',
      clientPhone: initialDraft?.clientPhone ?? '',
      clientId: initialDraft?.clientId ?? '',
      amount: initialDraft?.amount ?? '',
    } as unknown as FormInput,
  })

  // Autosave: persiste o form em localStorage a cada change. Não persiste
  // arquivos (binary). Throttle implícito via debounce de 400ms no watch.
  const watchedValues = watch()
  useEffect(() => {
    if (!user) return
    const handle = setTimeout(() => {
      const v = watchedValues as Record<string, unknown>
      saveDraft(user.uid, {
        nonce,
        clientName: String(v.clientName ?? ''),
        clientEmail: String(v.clientEmail ?? ''),
        clientPhone: String(v.clientPhone ?? ''),
        clientPhoneDial: String(v.clientPhoneDial ?? '55'),
        clientId: String(v.clientId ?? ''),
        currency: (v.currency as 'USD' | 'EUR' | 'GBP') ?? 'USD',
        amount: String(v.amount ?? ''),
        transactionDate: String(v.transactionDate ?? todayISO()),
        updatedAt: Date.now(),
      })
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(watchedValues), user, nonce])

  const appendFiles = (
    kind: 'transaction' | 'conversation',
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const incoming = Array.from(e.target.files ?? [])
    e.target.value = ''
    const valid: File[] = []
    let error: string | undefined
    for (const f of incoming) {
      if (!f.type.startsWith('image/')) {
        error = 'Apenas imagens são aceitas'
        continue
      }
      if (f.size > MAX_FILE_SIZE) {
        error = 'Cada imagem pode ter no máximo 10 MB'
        continue
      }
      valid.push(f)
    }
    if (kind === 'transaction') {
      setTransactionFiles((prev) => [...prev, ...valid])
      setFileErrors((p) => ({ ...p, transaction: error }))
    } else {
      setConversationFiles((prev) => [...prev, ...valid])
      setFileErrors((p) => ({ ...p, conversation: error }))
    }
  }

  const removeFile = (kind: 'transaction' | 'conversation', index: number) => {
    if (kind === 'transaction') {
      setTransactionFiles((prev) => prev.filter((_, i) => i !== index))
    } else {
      setConversationFiles((prev) => prev.filter((_, i) => i !== index))
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null)
    const nextErrors: typeof fileErrors = {}
    if (transactionFiles.length === 0) nextErrors.transaction = 'Adicione ao menos 1 imagem'
    if (conversationFiles.length === 0) nextErrors.conversation = 'Adicione ao menos 1 imagem'
    setFileErrors(nextErrors)
    if (nextErrors.transaction || nextErrors.conversation) return
    if (!user || !agente) return
    try {
      const fullPhone = `+${data.clientPhoneDial} ${data.clientPhone}`.trim()
      const { clientPhoneDial: _omit, ...rest } = data
      void _omit
      await createTransaction({
        agenteId: user.uid,
        agenteName: agente.name,
        agenteSetor: agente.setor,
        ...rest,
        clientPhone: fullPhone,
        transactionReceipts: transactionFiles,
        conversationReceipts: conversationFiles,
        // Idempotência: 2º clique tenta criar o MESMO docId → transação
        // detecta exists() e retorna sem duplicar.
        clientNonce: nonce,
      })
      // Sucesso confirmado: apaga o rascunho local.
      deleteDraft(user.uid, nonce)
      reset({
        transactionDate: todayISO(),
        currency: 'USD',
        clientPhoneDial: '55',
      } as FormInput)
      setTransactionFiles([])
      setConversationFiles([])
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 2400)
      onSuccess?.()
    } catch (err) {
      console.error(err)
      setSubmitError(err instanceof Error ? err.message : 'Falha ao salvar')
    }
  })

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section title="Cliente">
        <Field label="Nome completo" error={errors.clientName?.message}>
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

        <Field label="Identificação" error={errors.clientId?.message}>
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
      </Section>

      <Section title="Registro">
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="Moeda" error={errors.currency?.message}>
            <select {...register('currency')} className={inputCls}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
          <Field label="Volume registrado" error={errors.amount?.message}>
            <DecimalInput {...register('amount')} placeholder="0,00" />
          </Field>
        </div>

        <Field label="Data do registro" error={errors.transactionDate?.message}>
          <input type="date" {...register('transactionDate')} className={inputCls} />
        </Field>
      </Section>

      <Section title="Comprovantes">
        <FilePicker
          label="Comprovante de registro"
          files={transactionFiles}
          onAdd={(e) => appendFiles('transaction', e)}
          onRemove={(i) => removeFile('transaction', i)}
          error={fileErrors.transaction}
        />

        <FilePicker
          label="Comprovante de conversa"
          files={conversationFiles}
          onAdd={(e) => appendFiles('conversation', e)}
          onRemove={(i) => removeFile('conversation', i)}
          error={fileErrors.conversation}
        />
      </Section>

      {submitError && (
        <p className="rounded border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {submitError}
        </p>
      )}
      {submitted && (
        <p className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 size={14} />
          Registro salvo com sucesso.
        </p>
      )}

      <div className="-mx-6 mt-2 flex items-center justify-end gap-2 border-t border-app-border bg-app-elev/30 px-6 py-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-app-text px-5 py-2 text-[13px] font-medium tracking-tight text-app-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando…' : 'Confirmar Registro'}
        </button>
      </div>
    </form>
  )
}

/**
 * Input controlado pra valores monetários no padrão BR:
 * - Só aceita dígitos + uma vírgula. Bloqueia o ponto e qualquer caractere não
 *   numérico.
 * - Limita 2 casas decimais.
 * - inputMode="decimal" mostra teclado numérico em mobile.
 */
const DecimalInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { allowNegative?: boolean }
>(function DecimalInput({ allowNegative = false, onChange, className, ...rest }, ref) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Permite teclas de controle/navegação
    if (
      e.key === 'Backspace' ||
      e.key === 'Delete' ||
      e.key === 'Tab' ||
      e.key === 'Enter' ||
      e.key.startsWith('Arrow') ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.ctrlKey ||
      e.metaKey
    ) {
      return
    }
    // Bloqueia ponto e qualquer caractere não permitido
    if (e.key === '.') {
      e.preventDefault()
      return
    }
    if (e.key === ',') {
      // Permite só uma vírgula
      const v = e.currentTarget.value
      if (v.includes(',')) {
        e.preventDefault()
      }
      return
    }
    if (e.key === '-') {
      if (!allowNegative) {
        e.preventDefault()
        return
      }
      // Só permite menos na primeira posição
      const v = e.currentTarget.value
      const ss = e.currentTarget.selectionStart ?? 0
      if (ss !== 0 || v.includes('-')) e.preventDefault()
      return
    }
    if (!/^[0-9]$/.test(e.key)) {
      e.preventDefault()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    // Normaliza: ponto vira vírgula, remove qualquer outro caractere
    let normalized = text.replace(/\./g, ',').replace(/[^0-9,\-]/g, '')
    // Mantém só um sinal negativo no início
    if (allowNegative) {
      normalized = (normalized.startsWith('-') ? '-' : '') + normalized.replace(/-/g, '')
    } else {
      normalized = normalized.replace(/-/g, '')
    }
    // Mantém só uma vírgula
    const firstComma = normalized.indexOf(',')
    if (firstComma >= 0) {
      normalized =
        normalized.slice(0, firstComma + 1) +
        normalized.slice(firstComma + 1).replace(/,/g, '')
    }
    if (normalized !== text) {
      e.preventDefault()
      const input = e.currentTarget
      const start = input.selectionStart ?? 0
      const end = input.selectionEnd ?? 0
      input.value = input.value.slice(0, start) + normalized + input.value.slice(end)
      // Dispara onChange manualmente
      const ev = new Event('input', { bubbles: true })
      input.dispatchEvent(ev)
    }
  }

  // Defensiva final: se um ponto escapou (autocomplete, IME, dispatch programático,
  // etc.), normaliza pra vírgula antes de propagar pro hook-form. Nada de ponto
  // entra no value.
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
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onChange={handleChange}
      className={className ?? inputCls}
      {...rest}
    />
  )
})

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-muted">
          {title}
        </h3>
        <div className="h-px flex-1 bg-app-border" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function FilePicker({
  label,
  files,
  onAdd,
  onRemove,
  error,
}: {
  label: string
  files: File[]
  onAdd: (e: ChangeEvent<HTMLInputElement>) => void
  onRemove: (index: number) => void
  error?: string
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-app-muted">
          {label}
        </label>
        <span className="text-[10px] tabular-nums text-app-subtle">
          {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
        </span>
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-app-border bg-app-input px-3 py-2.5 text-[12px] text-app-muted transition-colors hover:border-app-border-strong hover:bg-app-elev/40">
        <Upload size={13} />
        Selecionar imagens (PNG, JPG, até 10 MB)
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={onAdd}
          className="hidden"
        />
      </label>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex max-w-[220px] items-center gap-1.5 rounded border border-app-border bg-app-elev/60 px-2 py-1 text-[11px] text-app-text"
            >
              <ImageIcon size={10} className="text-app-muted" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ml-0.5 rounded p-0.5 text-app-muted hover:bg-app-elev hover:text-rose-500"
                aria-label="Remover"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded border border-app-border bg-app-input px-3 py-2 text-[13px] text-app-text outline-none transition-colors focus:border-app-border-strong'

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
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-app-muted">
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  )
}
