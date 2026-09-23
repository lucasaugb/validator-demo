import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { useAuth } from '../contexts/AuthContext'
import {
  IMPORT_ROW_LIMIT,
  detectColumnMapping,
  importRows,
  parseSpreadsheet,
  validateRows,
} from '../lib/importer'
import type {
  ColumnField,
  ColumnMapping,
  ImportProgress,
  ImportResult,
  ParsedRow,
  RawRow,
} from '../lib/importer'
import { formatCurrency, formatDateBR } from '../lib/format'

/**
 * Tela de importação de planilha: só Gestor (rota /agente/importar).
 *
 * Fluxo da tela:
 *   1. Upload (.xlsx/.xls/.csv).
 *   2. Auto-detect das colunas; usuário pode remapar manualmente.
 *   3. Preview com erros por linha; usuário desmarca linhas indesejadas.
 *   4. Botão "Importar" → progresso → resumo final.
 *
 * Cada linha vira um `createTransaction` normal, passa pela validação automática
 * e ganha máscara de Identificação. Comprovantes ficam vazios; gestor anexa
 * via edição. (Cálculo de comissão acontece em background e NUNCA aparece
 * na UI do gestor: ver `feedback_gestor_nomenclatura`.)
 */

const FIELD_LABELS: Record<ColumnField, string> = {
  clientName: 'Nome do cliente',
  clientEmail: 'Email',
  clientPhone: 'Telefone',
  clientId: 'Identificação',
  currency: 'Moeda',
  amount: 'Volume',
  transactionDate: 'Data',
}

const FIELD_OPTIONAL: Record<ColumnField, boolean> = {
  clientName: false,
  clientEmail: false,
  clientPhone: false,
  clientId: false,
  // Moeda é opcional: se não tiver coluna dedicada, o parser tenta extrair
  // do símbolo no Valor (e cai em USD se nada bater).
  currency: true,
  amount: false,
  transactionDate: false,
}

type Step = 'upload' | 'preview' | 'running' | 'done'

export function AgenteImport() {
  const { agente } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const parsedRows = useMemo(
    () => validateRows(rawRows, mapping),
    [rawRows, mapping],
  )

  // Estatísticas pro footer do preview
  const stats = useMemo(() => {
    let valid = 0
    let invalid = 0
    for (const r of parsedRows) {
      if (skipped.has(r.rowNumber)) continue
      if (r.valid) valid += 1
      else invalid += 1
    }
    return { valid, invalid, skipped: skipped.size, total: parsedRows.length }
  }, [parsedRows, skipped])

  const handleFile = async (file: File) => {
    setParseError(null)
    setProgress(null)
    setResult(null)
    setFileName(file.name)
    try {
      const raws = await parseSpreadsheet(file)
      if (raws.length === 0) {
        setParseError(
          'Arquivo vazio ou sem aba de dados. Confira a planilha e tente de novo.',
        )
        return
      }
      const detectedHeaders = Object.keys(raws[0].data)
      setHeaders(detectedHeaders)
      setRawRows(raws)
      const { mapping: auto } = detectColumnMapping(detectedHeaders)
      setMapping(auto)
      setSkipped(new Set())
      setStep('preview')
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Não consegui ler esse arquivo. Tente exportar como .xlsx novamente.',
      )
    }
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const toggleSkip = (rowNumber: number) => {
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

  const onRunImport = async () => {
    if (!agente) return
    const toImport = parsedRows.filter(
      (r) => r.valid && !skipped.has(r.rowNumber),
    )
    if (toImport.length === 0) return
    setStep('running')
    setProgress({ done: 0, total: toImport.length, failed: 0, duplicated: 0 })
    const res = await importRows(toImport, agente, setProgress)
    setResult(res)
    setStep('done')
  }

  const reset = () => {
    setStep('upload')
    setFileName(null)
    setHeaders([])
    setRawRows([])
    setMapping({})
    setSkipped(new Set())
    setProgress(null)
    setResult(null)
    setParseError(null)
  }

  return (
    <>
      <PageHeader
        title="Importar planilha"
        subtitle="Suba os registros antigos da sua planilha de uma vez"
      />

      {step === 'upload' && (
        <UploadStep
          onPickFile={onPickFile}
          onDrop={onDrop}
          fileRef={fileRef}
          parseError={parseError}
        />
      )}

      {step === 'preview' && (
        <PreviewStep
          fileName={fileName}
          headers={headers}
          mapping={mapping}
          onMappingChange={setMapping}
          rows={parsedRows}
          skipped={skipped}
          onToggleSkip={toggleSkip}
          stats={stats}
          onCancel={reset}
          onRun={onRunImport}
          rowLimit={IMPORT_ROW_LIMIT}
        />
      )}

      {step === 'running' && progress && (
        <RunningStep progress={progress} />
      )}

      {step === 'done' && result && (
        <DoneStep
          result={result}
          onReset={reset}
          onGoToList={() => navigate('/agente/registros')}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Step: Upload                                                                */
/* -------------------------------------------------------------------------- */

function UploadStep({
  onPickFile,
  onDrop,
  fileRef,
  parseError,
}: {
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void
  fileRef: React.RefObject<HTMLInputElement | null>
  parseError: string | null
}) {
  return (
    <div className="panel mx-auto max-w-2xl overflow-hidden">
      <div className="panel-head">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
          Selecionar arquivo
        </h3>
        <span className="text-[10px] text-app-subtle">
          .xlsx · .xls · .csv · até {IMPORT_ROW_LIMIT} linhas
        </span>
      </div>
      <div className="px-6 py-5">
        <label
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-app-border bg-app-elev/30 px-6 py-12 text-center transition-colors hover:border-app-border-strong hover:bg-app-elev/50"
        >
          <Upload size={24} className="text-app-muted" strokeWidth={1.6} />
          <div>
            <div className="text-[13px] font-medium text-app-text">
              Clique pra escolher ou arraste a planilha aqui
            </div>
            <div className="mt-1 text-[11px] text-app-subtle">
              A primeira linha precisa ser o cabeçalho. Os nomes das colunas
              eu reconheço automaticamente.
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={onPickFile}
            className="hidden"
          />
        </label>
        {parseError && (
          <div className="mt-3 flex items-start gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-app-border bg-app-elev/30 px-4 py-3 text-[11.5px] text-app-muted">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-app-subtle">
            Colunas esperadas
          </div>
          <ul className="space-y-0.5 leading-snug">
            <li>
              <span className="text-app-text">Nome do cliente</span> ·{' '}
              <span className="text-app-text">Email</span> ·{' '}
              <span className="text-app-text">Telefone</span> (com DDI, ex:
              +55 11 98765-4321)
            </li>
            <li>
              <span className="text-app-text">Identificação</span> ·{' '}
              <span className="text-app-text">Volume</span> (com símbolo $/€/£
              ou coluna "Moeda" separada)
            </li>
            <li>
              <span className="text-app-text">Data</span> (DD/MM/AAAA ou
              formato Data do Excel)
            </li>
          </ul>
          <div className="mt-2 text-[10.5px] text-app-subtle">
            Comprovantes não entram pela planilha: vão precisar ser anexados
            depois em cada registro (botão de editar).
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Step: Preview                                                               */
/* -------------------------------------------------------------------------- */

function PreviewStep({
  fileName,
  headers,
  mapping,
  onMappingChange,
  rows,
  skipped,
  onToggleSkip,
  stats,
  onCancel,
  onRun,
  rowLimit,
}: {
  fileName: string | null
  headers: string[]
  mapping: ColumnMapping
  onMappingChange: (m: ColumnMapping) => void
  rows: ParsedRow[]
  skipped: Set<number>
  onToggleSkip: (n: number) => void
  stats: { valid: number; invalid: number; skipped: number; total: number }
  onCancel: () => void
  onRun: () => void
  rowLimit: number
}) {
  // Campos obrigatórios sem mapping → bloqueia o botão de importar
  const requiredMissing = (Object.keys(FIELD_LABELS) as ColumnField[]).filter(
    (f) => !FIELD_OPTIONAL[f] && !mapping[f],
  )

  return (
    <div className="space-y-3">
      <div className="panel overflow-hidden">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={13} className="text-app-muted" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              {fileName ?? 'Planilha'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded text-[10.5px] text-app-muted transition-colors hover:text-app-text"
          >
            <X size={11} /> Trocar arquivo
          </button>
        </div>

        {/* Mapping de colunas */}
        <div className="border-b border-app-border bg-app-elev/30 px-5 py-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-app-subtle">
            Mapeamento de colunas
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(FIELD_LABELS) as ColumnField[]).map((field) => (
              <div key={field} className="flex items-center gap-2">
                <label className="w-[120px] shrink-0 text-[11px] font-medium text-app-text">
                  {FIELD_LABELS[field]}
                  {!FIELD_OPTIONAL[field] && (
                    <span className="ml-0.5 text-rose-500">*</span>
                  )}
                </label>
                <select
                  value={mapping[field] ?? ''}
                  onChange={(e) =>
                    onMappingChange({
                      ...mapping,
                      [field]: e.target.value || undefined,
                    })
                  }
                  className="flex-1 rounded border border-app-border bg-app-input px-2 py-1 text-[11.5px] text-app-text outline-none focus:border-app-border-strong"
                >
                  <option value="">- ignorar -</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {requiredMissing.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
              <AlertCircle size={12} />
              Sem mapeamento pra:{' '}
              {requiredMissing.map((f) => FIELD_LABELS[f]).join(', ')}
            </div>
          )}
        </div>

        {/* Tabela de preview */}
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-app-card shadow-[0_1px_0_var(--app-border)]">
              <tr className="text-app-subtle">
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Linha
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Status
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Cliente
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Email
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Telefone
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Conta
                </th>
                <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
                  Volume
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Data
                </th>
                <th className="px-2 py-2 text-left font-semibold uppercase tracking-[0.1em]">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border/60">
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-app-subtle"
                  >
                    Nenhuma linha encontrada na planilha.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const isSkipped = skipped.has(r.rowNumber)
                return (
                  <tr
                    key={r.rowNumber}
                    className={`transition-colors ${
                      isSkipped
                        ? 'bg-app-elev/40 opacity-50'
                        : r.valid
                          ? 'hover:bg-app-elev/30'
                          : 'bg-rose-500/[0.04] hover:bg-rose-500/[0.08]'
                    }`}
                  >
                    <td className="px-2 py-1.5 font-mono text-[10px] text-app-subtle">
                      {r.rowNumber}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusChip
                        valid={r.valid}
                        errors={r.errors}
                        skipped={isSkipped}
                      />
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1.5 text-app-text">
                      {r.parsed.clientName ?? '-'}
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1.5 text-app-muted">
                      {r.parsed.clientEmail ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-app-muted">
                      {r.parsed.clientPhoneDial
                        ? `+${r.parsed.clientPhoneDial} ${r.parsed.clientPhone}`
                        : '-'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-app-muted">
                      {r.parsed.clientId ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold text-app-text">
                      {r.parsed.amount != null && r.parsed.currency
                        ? formatCurrency(r.parsed.amount, r.parsed.currency)
                        : '-'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-app-muted">
                      {r.parsed.transactionDate
                        ? formatDateBR(r.parsed.transactionDate)
                        : '-'}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleSkip(r.rowNumber)}
                        title={isSkipped ? 'Incluir linha' : 'Pular linha'}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-app-muted hover:bg-app-elev hover:text-app-text"
                      >
                        {isSkipped ? (
                          <CheckCircle2 size={11} />
                        ) : (
                          <X size={11} />
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer: stats + action */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border bg-app-elev/40 px-5 py-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11.5px] tabular-nums">
            <span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {stats.valid}
              </span>{' '}
              <span className="text-app-muted">prontas</span>
            </span>
            {stats.invalid > 0 && (
              <span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  {stats.invalid}
                </span>{' '}
                <span className="text-app-muted">com erro</span>
              </span>
            )}
            {stats.skipped > 0 && (
              <span>
                <span className="font-semibold text-app-muted">
                  {stats.skipped}
                </span>{' '}
                <span className="text-app-subtle">puladas</span>
              </span>
            )}
            <span className="text-app-subtle">
              de {stats.total} linha{stats.total === 1 ? '' : 's'}
              {stats.total >= rowLimit && ` (limite ${rowLimit})`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-app-border bg-app-card px-3 py-1.5 text-[11.5px] text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={stats.valid === 0 || requiredMissing.length > 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Upload size={12} />
              Importar {stats.valid} registro{stats.valid === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusChip({
  valid,
  errors,
  skipped,
}: {
  valid: boolean
  errors: string[]
  skipped: boolean
}) {
  if (skipped) {
    return (
      <span className="rounded border border-app-border bg-app-card px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-app-subtle">
        pulada
      </span>
    )
  }
  if (valid) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 size={9} /> pronta
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-rose-700 dark:text-rose-300"
      title={errors.join(' · ')}
    >
      <AlertCircle size={9} /> {errors[0]}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Step: Running                                                               */
/* -------------------------------------------------------------------------- */

function RunningStep({ progress }: { progress: ImportProgress }) {
  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0
  return (
    <div className="panel mx-auto max-w-xl overflow-hidden">
      <div className="px-6 py-8 text-center">
        <Loader2
          size={28}
          className="mx-auto mb-3 animate-spin text-app-accent-text"
          strokeWidth={1.8}
        />
        <div className="text-[14px] font-semibold text-app-text">
          Importando registros…
        </div>
        <div className="mt-1 text-[11.5px] text-app-muted">
          Aguarde: cada linha passa pela validação automática.
        </div>
        <div className="mt-5 flex items-baseline justify-center gap-2 font-mono text-[13px] tabular-nums">
          <span className="text-[20px] font-semibold text-app-text">
            {progress.done}
          </span>
          <span className="text-app-subtle">/ {progress.total}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-app-elev">
          <div
            className="h-full bg-app-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.failed > 0 && (
          <div className="mt-3 text-[11px] text-rose-600 dark:text-rose-400">
            {progress.failed} linha{progress.failed === 1 ? '' : 's'} com falha
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Step: Done                                                                  */
/* -------------------------------------------------------------------------- */

function DoneStep({
  result,
  onReset,
  onGoToList,
}: {
  result: ImportResult
  onReset: () => void
  onGoToList: () => void
}) {
  const hasErrors = result.failed > 0
  return (
    <div className="panel mx-auto max-w-2xl overflow-hidden">
      <div className="px-6 py-8 text-center">
        <CheckCircle2
          size={28}
          className="mx-auto mb-3 text-emerald-500"
          strokeWidth={1.8}
        />
        <div className="text-[14px] font-semibold text-app-text">
          Importação concluída
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 font-mono text-[12px] tabular-nums">
          <span>
            <span className="text-[18px] font-semibold text-emerald-600 dark:text-emerald-400">
              {result.imported}
            </span>{' '}
            <span className="text-app-muted">importados</span>
          </span>
          {result.duplicated > 0 && (
            <span>
              <span className="text-[18px] font-semibold text-app-muted">
                {result.duplicated}
              </span>{' '}
              <span className="text-app-muted">já existiam</span>
            </span>
          )}
          {result.failed > 0 && (
            <span>
              <span className="text-[18px] font-semibold text-rose-600 dark:text-rose-400">
                {result.failed}
              </span>{' '}
              <span className="text-app-muted">com falha</span>
            </span>
          )}
        </div>
        <div className="mt-2 text-[11px] text-app-muted">
          Comprovantes precisam ser anexados em cada registro pelo botão de
          editar.
        </div>
        {hasErrors && (
          <div className="mt-4 max-h-40 overflow-auto rounded border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-left text-[11px] text-rose-700 dark:text-rose-300">
            {result.errors.map((e) => (
              <div key={e.rowNumber}>
                Linha {e.rowNumber}: {e.reason}
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-app-border bg-app-card px-3 py-1.5 text-[11.5px] text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
          >
            Importar outra planilha
          </button>
          <button
            type="button"
            onClick={onGoToList}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-950 transition-colors hover:bg-emerald-400"
          >
            Ver registros
          </button>
        </div>
      </div>
    </div>
  )
}
