import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Contact,
  ImagePlus,
  Info,
  Loader2,
  Pencil,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react'
import type {
  ConversationValidation,
  Transaction,
  SystemValidation,
} from '../types'
import {
  finalStatus,
  finalStatusForAgent,
  getAgentDisplayId,
  rejectionReasonForAgent,
  replicationCount,
  replicationLabel,
  setorLabel,
} from '../types'
import { formatCurrency, formatDateBR, formatMoney } from '../lib/format'
import {
  TRANSACTION_PCT,
  activationBonusReason,
  commissionForTransaction,
  effectiveUsdAmount,
} from '../lib/commission'
import type { TransactionCommission } from '../lib/commission'
import { isOutsidePartner } from '../lib/partner'
import { tribeLabel, tribeOf } from '../lib/pipedrive'
import { ImageGallery } from './ImageGallery'
import { Modal } from './Modal'
import { SetorBadge } from './SetorBadge'
import { UsdAmountChip } from './UsdAmountChip'

interface Props {
  transactions: Transaction[]
  showAgente?: boolean
  showSetor?: boolean
  /** 'agent' esconde detalhes de validação; 'admin' mostra tudo (default). */
  viewMode?: 'admin' | 'agent'
  /**
   * Visibilidade do indicador de parceria (visual, não afeta validação):
   * - 'none'   → não mostra (supervisor, gestor)
   * - 'status' → mostra só "Fora da parceria" (admin)
   * - 'full'   → mostra "Fora da parceria" + o valor do PartnerCode (super_admin)
   */
  partnerView?: 'none' | 'status' | 'full'
  /** Agente do usuário logado: usado pra liberar edição do próprio. */
  currentAgenteId?: string
  /** Callbacks de ação. Habilita botão se passar. */
  onEdit?: (d: Transaction) => void
  onDelete?: (d: Transaction) => void
  /** Clique na linha (fora dos botões de ação) abre detalhes. */
  onRowClick?: (d: Transaction) => void
  /** Highlight de um transaction específico (ex.: navegando de duplicate). */
  highlightId?: string
  /**
   * Callback de upload direto de comprovantes pra registro IMPORTADO da
   * planilha. Quando passado e a linha bate o critério, aparece um botão
   * "Anexar comprovante" inline que abre modal com 2 áreas (registro +
   * conversa), cada uma aceitando múltiplos arquivos. Pula o pendingEdit
   * (decisão 2026-05-25: importações ficam editáveis direto enquanto o
   * sistema não validar).
   */
  onAttachImportedReceipts?: (
    d: Transaction,
    files: { transaction?: File[]; conversation?: File[] },
  ) => Promise<void>
  /**
   * Map<transactionId, displayString> com as Identificações já mascaradas pro
   * gestor. Quando `viewMode='agent'` e um id está no map, a coluna
   * "Identificação" mostra o valor mascarado (ex.: `#1234R1A`); senão cai
   * em `#{clientId}` cru. O parent (AgenteTransactions) constrói esse map a
   * partir da lista COMPLETA de transactions do gestor, não da lista filtrada
   *: pra que a seq fique estável quando o usuário filtra por mês/moeda.
   */
  agentMaskedIdMap?: Map<string, string>
}

/**
 * Linhas renderizadas por página. 50 mantém a tela leve sem obrigar o usuário
 * a paginar demais: a busca/filtros continuam varrendo a base inteira, só o
 * RENDER é fatiado.
 */
const PAGE_SIZE = 50

/**
 * Janela de páginas do paginador (índices 0-based). Mostra sempre a primeira e
 * a última, mais as vizinhas da atual, com reticências nos buracos, assim a
 * barra não estoura a largura quando a base tem muitas páginas.
 * Ex. (atual=5, total=20) → 1 … 5 6 7 … 20
 */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  const MAX_NUMBERS = 7
  if (total <= MAX_NUMBERS) {
    return Array.from({ length: total }, (_, i) => i)
  }
  const pages = new Set<number>([0, total - 1, current])
  // Vai abrindo o leque em volta da página atual até encher a cota.
  let d = 1
  while (pages.size < MAX_NUMBERS && d < total) {
    if (current - d >= 0) pages.add(current - d)
    if (pages.size < MAX_NUMBERS && current + d <= total - 1) pages.add(current + d)
    d++
  }
  const sorted = [...pages].sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('gap')
    out.push(sorted[i])
  }
  return out
}

export function TransactionList({
  transactions,
  showAgente = false,
  showSetor = false,
  viewMode = 'admin',
  partnerView = 'none',
  currentAgenteId,
  onEdit,
  onDelete,
  onRowClick,
  highlightId,
  agentMaskedIdMap,
  onAttachImportedReceipts,
}: Props) {
  const [gallery, setGallery] = useState<{ urls: string[]; initial: number } | null>(null)

  // ── Paginação ────────────────────────────────────────────────────────────
  // A tabela renderizava TODAS as linhas do período assinado (até 180 dias de
  // dados = milhares de registros), e cada linha é cara: miniaturas de
  // comprovante, badges e cálculo de comissão por registro. Era o que deixava
  // a tela de Registros lenta. Renderizando só uma página por vez o custo
  // passa a ser constante, independente do tamanho da base.
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  // Busca/filtro mudou (ou chegou registro novo) → volta pra primeira página,
  // senão o usuário ficaria numa página que não existe mais no novo recorte.
  useEffect(() => {
    setPage(0)
  }, [transactions.length])
  // Clamp defensivo: protege o render caso `page` fique além do total entre
  // o snapshot novo e o efeito acima rodar.
  const safePage = Math.min(page, totalPages - 1)
  const visible = useMemo(
    () => transactions.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [transactions, safePage],
  )

  const isAgentView = viewMode === 'agent'
  // Gestor não vê coluna de comissão (decisão 2026-05-18). Admin/supervisor mantém.
  const showCommissionCol = !isAgentView
  // Gestor NÃO vê comprovantes (decisão 2026-05-20). Só envia/edita, supervisor+ visualiza.
  const showReceiptsCol = !isAgentView
  // colunas: # + (comprovantes?) + (agente?) + (setor?) + cliente + id + valor + data + status... + (comissão?) + (acoes?)
  const fixedColumns = 5 // #, cliente, id, valor, data
  const validationCols = isAgentView ? 1 : 3 // status OR sistema + conversa + ativação
  const showActions = !!onEdit || !!onDelete
  const columnCount =
    fixedColumns +
    (showReceiptsCol ? 1 : 0) +
    (showAgente ? 1 : 0) +
    (showSetor ? 1 : 0) +
    validationCols +
    (showCommissionCol ? 1 : 0) +
    (showActions ? 1 : 0)

  return (
    <div className="rounded-2xl border border-app-border bg-app-card shadow-[var(--shadow-card)]">
      {/* Strip com contagem de registros. Reflete a lista atual já filtrada;
          deletados estão fora do array (sumiram do snapshot) então o número
          é "presentes agora", não "max(transactionNumber)", que teria buracos. */}
      <div className="flex items-center justify-between border-b border-app-border px-4 py-2 text-[11px]">
        <span className="tabular-nums text-app-muted">
          <span className="font-semibold text-app-text">{transactions.length}</span>{' '}
          {transactions.length === 1 ? 'registro' : 'registros'}
        </span>
        {totalPages > 1 && (
          <span className="tabular-nums text-app-subtle">
            exibindo {safePage * PAGE_SIZE + 1}-
            {Math.min((safePage + 1) * PAGE_SIZE, transactions.length)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-app-border bg-app-elev/60">
            <Th>#</Th>
            {showReceiptsCol && <Th>Comprovantes</Th>}
            {showAgente && <Th>Gestor</Th>}
            {showSetor && <Th>Setor</Th>}
            <Th>Cliente</Th>
            <Th>{isAgentView ? 'Identificação' : 'Conta'}</Th>
            <Th className="text-right">Volume</Th>
            <Th>Data</Th>
            {isAgentView ? (
              <Th>Status</Th>
            ) : (
              <>
                <Th>Sistema</Th>
                <Th>Conversa</Th>
                <Th>Ativação</Th>
              </>
            )}
            {showCommissionCol && <Th className="min-w-[200px]">Comissão</Th>}
            {showActions && <Th>Ações</Th>}
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="py-12 text-center text-sm text-app-subtle">
                {isAgentView ? 'Nenhum registro ainda.' : 'Nenhum registro encontrado.'}
              </td>
            </tr>
          ) : (
            visible.map((d) => {
              // Registro importado sem comprovante: destaque amber + atalho de
              // upload direto. Visível só pro gestor dono (que vai cumprir o
              // pendente). Quando admin/super olha, vê o chip "importado" mas
              // sem o destaque amber.
              const needsReceipt =
                isAgentView &&
                !!d.importedAt &&
                (d.transactionReceiptUrls?.length ?? 0) === 0
              return (
              <tr
                key={d.id}
                id={`transaction-${d.id}`}
                onClick={onRowClick ? () => onRowClick(d) : undefined}
                className={`border-b border-app-border/60 transition-colors last:border-0 hover:bg-app-elev/40 ${
                  onRowClick ? 'cursor-pointer' : ''
                } ${highlightId === d.id ? 'bg-amber-500/10' : needsReceipt ? 'bg-amber-500/[0.05]' : ''}`}
              >
                <Td>
                  <span className="font-mono text-[11px] text-app-muted">
                    {d.transactionNumber != null ? `#${d.transactionNumber}` : '-'}
                  </span>
                  {d.pendingEdit && (
                    <div className="mt-0.5 text-[9px] uppercase tracking-wider text-amber-600 dark:text-amber-300">
                      Edição
                    </div>
                  )}
                  {needsReceipt ? (
                    <div
                      title="Importado pela planilha: falta anexar o comprovante."
                      className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
                    >
                      <AlertTriangle size={9} strokeWidth={2.4} />
                      Pendente comprovante
                    </div>
                  ) : (
                    isAgentView &&
                    isRecentImport(d.importedAt) && (
                      <div
                        title="Veio do importador de planilha."
                        className="mt-0.5 inline-flex items-center rounded bg-sky-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300"
                      >
                        importado
                      </div>
                    )
                  )}
                </Td>
                {showReceiptsCol && (
                  <Td onClick={(e) => e.stopPropagation()} className="min-w-[84px]">
                    <div className="flex shrink-0 gap-1.5">
                      <ThumbStack
                        urls={d.transactionReceiptUrls}
                        tone="green"
                        title="Comprovantes de registro"
                        onOpen={(i) => setGallery({ urls: d.transactionReceiptUrls, initial: i })}
                      />
                      <ThumbStack
                        urls={d.conversationReceiptUrls}
                        tone="blue"
                        title="Comprovantes de conversa"
                        onOpen={(i) =>
                          setGallery({ urls: d.conversationReceiptUrls, initial: i })
                        }
                      />
                    </div>
                  </Td>
                )}
                {showAgente && (
                  <Td>
                    <div
                      className="max-w-[120px] truncate font-medium text-app-text"
                      title={d.agenteName}
                    >
                      {d.agenteName}
                    </div>
                  </Td>
                )}
                {showSetor && (
                  <Td>
                    {d.agenteSetor ? (
                      <SetorBadge setor={d.agenteSetor} size="xs" />
                    ) : (
                      <span className="text-[11px] text-app-subtle">-</span>
                    )}
                  </Td>
                )}
                <Td>
                  <div className="flex items-center gap-2">
                    <ClientAvatar name={d.clientName} seed={d.clientId} />
                    <div className="min-w-0">
                      <div
                        className="max-w-[140px] truncate font-medium text-app-text"
                        title={d.clientName}
                      >
                        {d.clientName}
                      </div>
                      <div
                        className="max-w-[140px] truncate text-[10px] text-app-subtle"
                        title={d.clientEmail}
                      >
                        {d.clientEmail}
                      </div>
                      {/* Perfil CRM (Premium/Starter) é só supervisor pra cima,
                          gestor (viewMode='agent') não vê. */}
                      {!isAgentView && <TribeBadge transaction={d} />}
                    </div>
                  </div>
                </Td>
                <Td>
                  <span
                    className="block max-w-[130px] truncate font-mono text-[11px] text-app-muted"
                    title={isAgentView ? undefined : d.clientId}
                  >
                    {isAgentView
                      ? getAgentDisplayId(d, agentMaskedIdMap)
                      : d.clientId}
                  </span>
                </Td>
                <Td className="text-right">
                  <span className="font-semibold text-app-text">
                    {formatCurrency(d.amount, d.currency)}
                  </span>
                  <UsdAmountChip transaction={d} />
                </Td>
                <Td>
                  <div className="whitespace-nowrap text-[11px] text-app-text">
                    {formatDateBR(d.transactionDate)}
                  </div>
                  <FutureDateWarning transactionDate={d.transactionDate} />
                  <CreatedAtLine ts={d.createdAt} />
                </Td>
                {isAgentView ? (
                  <Td>
                    <AgenteStatusBadge transaction={d} />
                  </Td>
                ) : (
                  <>
                    <Td>
                      <SystemBadge
                        status={d.systemValidation}
                        duplicateLabel={
                          d.systemValidation === 'duplicate'
                            ? replicationLabel(replicationCount(d))
                            : undefined
                        }
                      />
                      {d.systemValidation === 'duplicate' && d.duplicateAlert && (
                        <DuplicateInfo transaction={d} />
                      )}
                      <PartnerBadge transaction={d} partnerView={partnerView} />
                    </Td>
                    <Td>
                      <ConversationBadge status={d.conversationValidation} />
                    </Td>
                    <Td>
                      <ActivationCell transaction={d} />
                    </Td>
                  </>
                )}
                {showCommissionCol && (
                  <Td className="min-w-[200px]">
                    <CommissionCell transaction={d} />
                  </Td>
                )}
                {showActions && (
                  <Td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      {needsReceipt && onAttachImportedReceipts && (
                        <AttachReceiptButton
                          transaction={d}
                          onAttach={onAttachImportedReceipts}
                        />
                      )}
                      {onEdit && (!isAgentView || d.agenteId === currentAgenteId) && !d.pendingEdit && (
                        <button
                          onClick={() => onEdit(d)}
                          title="Editar"
                          className="rounded border border-app-border bg-app-elev p-1 text-app-muted hover:bg-app-elev/80 hover:text-app-text"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(d)}
                          title="Excluir"
                          className="rounded border border-red-500/30 bg-red-500/10 p-1 text-red-600 hover:bg-red-500/20 dark:text-red-300"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </Td>
                )}
              </tr>
              )
            })
          )}
        </tbody>
      </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-app-border px-4 py-2.5 text-[11px]">
          <span className="tabular-nums text-app-muted">
            Página <span className="font-semibold text-app-text">{safePage + 1}</span>{' '}
            de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 0}
              aria-label="Página anterior"
              className="flex h-7 items-center rounded-md border border-app-border bg-app-card px-2 font-medium text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            {pageWindow(safePage, totalPages).map((p, i) =>
              p === 'gap' ? (
                <span
                  key={`gap-${i}`}
                  className="px-1 text-app-subtle"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === safePage ? 'page' : undefined}
                  aria-label={`Página ${p + 1}`}
                  className={`flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 font-mono tabular-nums transition-colors ${
                    p === safePage
                      ? 'bg-app-accent font-semibold text-app-accent-fg'
                      : 'border border-app-border bg-app-card text-app-muted hover:bg-app-elev hover:text-app-text'
                  }`}
                >
                  {p + 1}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages - 1}
              aria-label="Próxima página"
              className="flex h-7 items-center rounded-md border border-app-border bg-app-card px-2 font-medium text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      )}

      {gallery && (
        <ImageGallery
          urls={gallery.urls}
          initial={gallery.initial}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  )
}

function ThumbStack({
  urls,
  tone,
  title,
  onOpen,
}: {
  urls: string[]
  tone: 'green' | 'blue'
  title: string
  onOpen: (initial: number) => void
}) {
  const ring = tone === 'green' ? 'ring-green-500/40' : 'ring-blue-500/40'
  if (urls.length === 0) {
    return (
      <div
        title={`${title} (sem imagens)`}
        className={`flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-app-border text-[10px] text-app-subtle ring-1 ${ring}`}
      >
,
      </div>
    )
  }
  return (
    <button
      onClick={() => onOpen(0)}
      title={`${title}${urls.length > 1 ? ` (${urls.length})` : ''}`}
      className="relative block shrink-0 overflow-hidden rounded-md"
      style={{ width: 36, height: 36 }}
    >
      <img
        src={urls[0]}
        alt=""
        className={`h-9 w-9 rounded-md border border-app-border object-cover ring-1 transition-opacity hover:opacity-90 ${ring}`}
      />
      {urls.length > 1 && (
        <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-app-text px-1 text-[9px] font-semibold leading-tight text-app-bg ring-1 ring-app-card/40">
          +{urls.length - 1}
        </span>
      )}
    </button>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap px-1 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-app-muted ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void
}) {
  return (
    <td
      onClick={onClick}
      className={`whitespace-nowrap px-1.5 py-2.5 align-middle text-app-text ${className ?? ''}`}
    >
      {children}
    </td>
  )
}

/** Avatar circular pequeno com iniciais: usa hash do seed pra escolher cor. */
function ClientAvatar({ name, seed }: { name: string; seed: string }) {
  const initials =
    (name || '?')
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '-'
  const palette = [
    'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  ]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const cls = palette[h % palette.length]
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${cls}`}
    >
      {initials}
    </div>
  )
}

const sysMap: Record<SystemValidation, { label: string; cls: string }> = {
  pending: {
    label: 'Aguardando',
    cls: 'bg-app-elev text-app-muted border-app-border',
  },
  verified: {
    label: 'Verificado',
    cls: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  },
  invalid: {
    label: 'Inválido',
    cls: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  },
  duplicate: {
    label: 'Duplicado',
    cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  },
}

const convMap: Record<ConversationValidation, { label: string; cls: string }> = {
  pending: {
    label: 'Aguardando',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  approved: {
    label: 'Aprovada',
    cls: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  },
  rejected: {
    label: 'Rejeitada',
    cls: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  },
}

function SystemBadge({
  status,
  duplicateLabel,
}: {
  status: SystemValidation
  duplicateLabel?: string
}) {
  const { label: defaultLabel, cls } = sysMap[status]
  const label = status === 'duplicate' && duplicateLabel ? duplicateLabel : defaultLabel
  return (
    <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

/**
 * Indicador visual de parceria embaixo do status "Verificado". Só aparece quando o
 * transação é verified e está FORA da nossa parceria. `partnerView` controla o que
 * mostra: 'status' (só "Fora da parceria", pra admin) ou 'full' (+ o valor do
 * PartnerCode, pra super_admin). NÃO afeta validação/comissão, é só sinalização.
 */
function PartnerBadge({
  transaction,
  partnerView,
}: {
  transaction: Transaction
  partnerView: 'none' | 'status' | 'full'
}) {
  if (partnerView === 'none') return null
  if (!isOutsidePartner(transaction)) return null
  const showValue = partnerView === 'full' && !!transaction.sourcePartnerCode
  return (
    <div
      title="Cliente fora das nossas parcerias (90001 / 90002)"
      className="mt-1 inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300"
    >
      <AlertTriangle size={9} strokeWidth={2.4} />
      Fora da parceria
      {showValue && (
        <span className="font-mono font-semibold normal-case tracking-normal opacity-90">
          · {transaction.sourcePartnerCode}
        </span>
      )}
    </div>
  )
}

/**
 * Tag Premium/Starter/Não encontrado: classificação do CLIENTE no CRM
 * (Pipedrive), gravada em `pipedriveTribe`. Aparece embaixo do email na coluna
 * Cliente, em TODAS as visões (gestor/supervisor/admin). Some quando o registro
 * ainda não foi classificado (`pipedriveTribe` undefined) pra não confundir
 * "não consultado" com "não encontrado".
 *
 * Cores DISTINTAS do SetorBadge de propósito (aqui é PRODUTO do cliente, não
 * setor do gestor): Premium=violeta, Starter=ciano, Não encontrado=neutro.
 */
function TribeBadge({ transaction }: { transaction: Transaction }) {
  const t = tribeOf(transaction)
  if (!t) return null
  const cls =
    t === 'premium'
      ? 'bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300'
      : t === 'starter'
        ? 'bg-cyan-500/15 text-cyan-700 ring-cyan-500/30 dark:text-cyan-300'
        : 'bg-app-elev text-app-subtle ring-app-border'
  const found = t === 'premium' || t === 'starter'
  const addTime = transaction.pipedriveDealAddTime
  const addTimeStr =
    typeof addTime === 'string' ? formatDateBR(addTime.slice(0, 10)) : null
  const title = found
    ? `CRM (Pipedrive): ${tribeLabel[t]}` +
      (addTimeStr ? ` · entrou ${addTimeStr}` : '') +
      (transaction.pipedriveStage ? ` · etapa: ${transaction.pipedriveStage}` : '')
    : 'Classificação do cliente no CRM (Pipedrive)'
  return (
    <div className="mt-1 flex flex-col items-start gap-0.5">
      {/* Prefixo "CRM" de propósito: o selo de SETOR na mesma linha também diz
          "Premium"/"Starter" e os dois viviam se confundindo. Ícone + prefixo
          deixam claro que este é o perfil do cliente no Pipedrive. */}
      <span
        title={title}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${cls}`}
      >
        <Contact size={9} strokeWidth={2.6} className="shrink-0" />
        {found ? (
          <>
            <span className="opacity-60">CRM</span>
            {tribeLabel[t]}
          </>
        ) : (
          'Sem CRM'
        )}
      </span>
      {found && (transaction.pipedriveStage || addTimeStr) && (
        <span className="max-w-[150px] truncate text-[9px] leading-tight text-app-subtle" title={title}>
          {transaction.pipedriveStage}
          {transaction.pipedriveStage && addTimeStr ? ' · ' : ''}
          {addTimeStr}
        </span>
      )}
    </div>
  )
}

function ConversationBadge({ status }: { status: ConversationValidation }) {
  const { label, cls } = convMap[status]
  return (
    <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

function DuplicateInfo({ transaction }: { transaction: Transaction }) {
  const linked = transaction.duplicateAlert?.linkedTransactionNumbers ?? []
  const linkedIds = transaction.duplicateAlert?.linkedTransactionIds ?? []
  const crossAgent = transaction.duplicateAlert?.crossAgent
  const count = replicationCount(transaction)
  const baseLabel = replicationLabel(count)
  const tone = crossAgent ? 'text-amber-600 dark:text-amber-300' : 'text-app-muted'
  const label = crossAgent
    ? `${baseLabel} entre gestores diferentes`
    : `${baseLabel} pelo mesmo gestor`

  // Lista de gestores envolvidos (excluindo o atual). Usa `agentesInfo` do
  // backend; pra docs antigos sem isso, fica vazio.
  const others = (transaction.duplicateAlert?.agentesInfo ?? []).filter(
    (a) => a.uid !== transaction.agenteId,
  )

  return (
    // max-w impede que a lista de badges de gestores / números vinculados
    // estoure a largura da coluna "Sistema", sem isso, no modo "Todos os
    // gestores" os duplicados cross-agent alargavam a tabela e forçavam scroll
    // horizontal. Capado, o all-gestores fica igual ao filtrado.
    <div className="mt-1 max-w-[230px] space-y-0.5 text-[11px]">
      <div className={tone}>{label}</div>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10.5px] text-amber-700 dark:text-amber-300">
          <span className="text-app-muted">
            com {others.length === 1 ? 'gestor' : 'gestores'}:
          </span>
          {others.map((a) => (
            <span
              key={a.uid}
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium"
            >
              {a.name ?? 'gestor'}
              {a.setor && (
                <span className="ml-1 text-[9.5px] text-amber-700/80 dark:text-amber-300/80">
                  · {setorLabel[a.setor]}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {linked.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {linked.map((n, i) => {
            const id = linkedIds[i]
            return (
              <a
                key={`${n}-${id ?? i}`}
                href={id ? `#transaction-${id}` : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!id) return
                  e.preventDefault()
                  const el = document.getElementById(`transaction-${id}`)
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
                className="rounded border border-app-border bg-app-elev px-1.5 py-0.5 font-mono text-app-text hover:bg-app-elev/80"
              >
                #{n}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActivationCell({ transaction }: { transaction: Transaction }) {
  if (transaction.systemValidation === 'verified' && transaction.isActivation) {
    return (
      <span
        title="Primeiro registro deste cliente no sistema de origem"
        className="inline-flex items-center gap-1 rounded border border-app-border bg-app-elev px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-app-text"
      >
        <UserPlus size={10} strokeWidth={2} className="text-app-muted" /> Ativação
      </span>
    )
  }
  return <span className="text-xs text-app-subtle">-</span>
}

/**
 * Célula de comissão detalhada: exibe somente para transações `validated`
 * (verified + approved). Layout de extrato/statement:
 *   - Header: tipo + status da operação (pra ativações)
 *   - Itens: fixo + 1% sobre transação, com tom indicando status
 *   - Total: a pagar
 */
/**
 * Detalhamento da comissão de um registro pra um tooltip (title), a tabela é
 * apertada, então o "porquê" do valor mora aqui: tipo, bônus (com a razão do
 * valor pelos dias na Premium/Starter), 1% e total, conforme as regras.
 */
function commissionTitle(d: Transaction, c: TransactionCommission): string {
  if (finalStatus(d) !== 'validated') {
    return 'Comissão liberada só após a validação (Verificado + conversa aprovada).'
  }
  const pctFull = formatMoney(effectiveUsdAmount(d) * TRANSACTION_PCT)
  if (!d.isActivation) {
    return `Registro comum: 1% sobre o volume = ${pctFull}. Sem bônus de ativação.`
  }
  const bonus = formatMoney(c.fixedUsd)
  const bonusLine = `• Bônus de ativação ${bonus}, ${activationBonusReason(d)}`
  let pctLine: string
  if (c.status === 'eligible') {
    pctLine = `• 1% sobre o volume = ${formatMoney(c.percentage)} (liberado, operou após o registro)`
  } else if (c.status === 'pending_operation') {
    pctLine = `• 1% sobre o volume = ${pctFull} (retido, aguardando 1ª operação do cliente)`
  } else {
    pctLine = `• 1% sobre o volume = ${pctFull} (perdido, cliente não operou após o registro)`
  }
  const total = c.status === 'eligible' ? formatMoney(c.fixedUsd + c.percentage) : bonus
  return `Ativação\n${bonusLine}\n${pctLine}\n= Total a pagar: ${total}`
}

function CommissionInfo({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="inline-flex cursor-help text-app-subtle transition-colors hover:text-app-muted"
    >
      <Info size={12} strokeWidth={2} />
    </span>
  )
}

function CommissionCell({ transaction }: { transaction: Transaction }) {
  if (finalStatus(transaction) !== 'validated') {
    return <span className="text-[11px] text-app-subtle">-</span>
  }

  const c = commissionForTransaction(transaction)
  const isActivation = transaction.isActivation
  const isForeign = transaction.currency !== 'USD'

  // c.percentage já vem em USD quando elegible (effectiveUsdAmount × 0.01);
  // quando não elegível, é 0: mas a gente quer mostrar quanto SERIA pago, pra
  // dar noção da perda. Calculamos o "would-be" sempre.
  const pctUsd = c.percentage
  const pctUsdFmt = formatMoney(pctUsd)
  const wouldBePctUsd = effectiveUsdAmount(transaction) * 0.01
  const wouldBePctUsdFmt = formatMoney(wouldBePctUsd)
  // Valor original da transação na moeda do cadastro, usado pra mostrar
  // "1% × €200" quando moeda != USD, ou "1% × $200" pra USD.
  const amountFmt = formatCurrency(transaction.amount || 0, transaction.currency)
  // Valor equivalente em USD: só é mostrado quando moeda != USD pra deixar
  // claro de onde sai o pct.
  const usdEquivFmt = formatMoney(effectiveUsdAmount(transaction))
  // Bônus de ativação escalonado por dias na Premium/Starter, usa o valor
  // calculado pra ESTE registro (c.fixedUsd), não uma constante.
  const fixedFmt = formatMoney(c.fixedUsd)

  // ----- Transação comum (1% sempre) -----
  if (!isActivation) {
    return (
      <div className="space-y-2 leading-tight">
        <div className="flex items-center gap-1.5">
          <TypeBadge kind="comum" />
          <CommissionInfo title={commissionTitle(transaction, c)} />
        </div>
        {isForeign && <FxRateLine transaction={transaction} />}
        <StatementLine
          label={
            isForeign
              ? `1% × ${amountFmt} ≈ ${usdEquivFmt}`
              : `1% × ${amountFmt}`
          }
          value={pctUsdFmt}
          tone="paid"
        />
        <Divider />
        <TotalLine value={pctUsdFmt} />
      </div>
    )
  }

  // ----- Ativação -----
  // Total sempre em USD (fixo já é USD; pct foi convertido).
  const totalValue =
    c.status === 'eligible'
      ? formatMoney(c.fixedUsd + pctUsd)
      : fixedFmt

  return (
    <div className="space-y-2 leading-tight">
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge kind="ativacao" />
        <CommissionInfo title={commissionTitle(transaction, c)} />
        <ActivationOpLabel transaction={transaction} status={c.status} />
      </div>

      {isForeign && <FxRateLine transaction={transaction} />}

      <StatementLine label="Fixo" value={fixedFmt} tone="paid" />

      {c.status === 'eligible' && (
        <StatementLine
          label={
            isForeign
              ? `1% × ${amountFmt} ≈ ${usdEquivFmt}`
              : `1% × ${amountFmt}`
          }
          value={pctUsdFmt}
          tone="paid"
        />
      )}
      {c.status === 'pending_operation' && (
        <StatementLine
          label={
            isForeign ? `1% × ${amountFmt} ≈ ${usdEquivFmt} (retido)` : '1% retido'
          }
          value={`${wouldBePctUsdFmt} aguardando`}
          tone="pending"
        />
      )}
      {c.status === 'not_eligible' && (
        <StatementLine
          label={
            isForeign
              ? `1% × ${amountFmt} ≈ ${usdEquivFmt} (perdido)`
              : `1% × ${amountFmt} (perdido)`
          }
          value={wouldBePctUsdFmt}
          tone="lost"
        />
      )}

      <Divider />
      <TotalLine value={totalValue} />
    </div>
  )
}

/**
 * Linha pequena exibindo a cotação BCE usada pra converter a transação pra USD
 * no momento do cálculo da comissão. Some quando moeda já é USD (sem
 * conversão) ou quando o doc ainda não foi auto-recalculado (auto-recalc
 * deve resolver em segundos).
 */
function FxRateLine({ transaction }: { transaction: Transaction }) {
  if (transaction.currency === 'USD') return null
  if (typeof transaction.usdRate !== 'number') {
    return (
      <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
        <span aria-hidden>↻</span>
        <span>cotação carregando…</span>
      </div>
    )
  }
  const rateDate = transaction.usdRateDate ?? transaction.transactionDate
  return (
    <div className="font-mono text-[10px] tabular-nums leading-tight text-app-subtle">
      <span>1 {transaction.currency} = </span>
      <span className="text-app-muted">{transaction.usdRate.toFixed(4)} USD</span>
      <span> · {formatDateBR(rateDate)}</span>
    </div>
  )
}

function TypeBadge({ kind }: { kind: 'ativacao' | 'comum' }) {
  return (
    <span className="inline-flex items-center rounded border border-app-border bg-app-card px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-app-muted">
      {kind === 'ativacao' ? 'Ativação' : 'Comum'}
    </span>
  )
}

function StatementLine({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'paid' | 'pending' | 'lost'
}) {
  const labelCls =
    tone === 'lost' ? 'text-app-subtle' : 'text-app-muted'
  const valueCls =
    tone === 'paid'
      ? 'text-app-text'
      : tone === 'pending'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-app-subtle line-through'
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px] tabular-nums">
      <span className={`truncate ${labelCls}`}>{label}</span>
      <span className={`shrink-0 ${valueCls}`}>{value}</span>
    </div>
  )
}

function TotalLine({ value }: { value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-app-subtle">
        Total
      </span>
      <span className="text-[13px] font-medium tabular-nums tracking-[-0.01em] text-app-text">
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-app-border" />
}

function ActivationOpLabel({
  transaction,
  status,
}: {
  transaction: Transaction
  status: string
}) {
  const lod = transaction.lastOperationDate

  if (status === 'eligible') {
    const opStr = typeof lod === 'string' ? formatDateBR(String(lod).slice(0, 10)) : ''
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={10} strokeWidth={2.25} />
        Operou {opStr ? `em ${opStr}` : 'após registro'}
      </span>
    )
  }
  if (status === 'pending_operation') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
        <Clock size={10} strokeWidth={2.25} />
        Aguardando operação
      </span>
    )
  }
  if (lod == null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
        <XCircle size={10} strokeWidth={2.25} />
        Cliente não operou
      </span>
    )
  }
  const opStr = formatDateBR(String(lod).slice(0, 10))
  // Mesmo dia agora vira `eligible` (regra 2026-05-20), esse fallback só
  // é alcançado quando opDate < transactionDate.
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400">
      <XCircle size={10} strokeWidth={2.25} />
      Operou antes em {opStr}
    </span>
  )
}

function AgenteStatusBadge({ transaction }: { transaction: Transaction }) {
  const status = finalStatusForAgent(transaction)
  if (status === 'validated') {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
          Verificado
        </span>
        {transaction.isActivation && (
          <span
            title="Primeiro registro deste cliente"
            className="inline-flex items-center gap-1 rounded border border-app-border bg-app-elev px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-app-text"
          >
            <UserPlus size={10} strokeWidth={2} className="text-app-muted" /> Ativação
          </span>
        )}
      </div>
    )
  }
  if (status === 'rejected') {
    const reason = rejectionReasonForAgent(transaction)
    return (
      <div className="flex max-w-[240px] flex-col gap-1">
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          <XCircle size={10} strokeWidth={2.25} />
          Inválido
        </span>
        {reason && <AgenteRejectionDetail reason={reason} />}
      </div>
    )
  }
  return (
    <span className="rounded-full border border-app-border bg-app-elev px-2 py-0.5 text-xs font-medium text-app-muted">
      Pendente
    </span>
  )
}

function AgenteRejectionDetail({
  reason,
}: {
  reason: NonNullable<ReturnType<typeof rejectionReasonForAgent>>
}) {
  // Gestor não vê "sistema/conversa" como entidades distintas, só "inválido"
  // com a observação textual quando houver. Mantém o motivo objetivo sem
  // expor o motor de validação. Display reforçado pra observação ficar
  // visível sem precisar abrir o registro (feedback 2026-05-28).
  if (!reason.conversationNote) return null
  return (
    <div
      className="max-w-[260px] rounded-md border border-rose-500/40 bg-rose-500/[0.08] px-2 py-1.5"
      title={reason.conversationNote}
    >
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-rose-700 dark:text-rose-300">
        Observação do admin
      </div>
      <div className="mt-0.5 whitespace-pre-line break-words text-[11px] leading-snug text-app-text">
        {reason.conversationNote}
      </div>
    </div>
  )
}

/**
 * Botão inline pra anexar comprovantes em registro importado da planilha.
 * Abre um modal pequeno com 2 áreas (Registro / Conversa), cada uma aceita
 * múltiplos arquivos. Pula o pendingEdit (rule liberada enquanto sistema
 * não validou).
 */
function AttachReceiptButton({
  transaction,
  onAttach,
}: {
  transaction: Transaction
  onAttach: (
    d: Transaction,
    files: { transaction?: File[]; conversation?: File[] },
  ) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [depFiles, setDepFiles] = useState<File[]>([])
  const [convFiles, setConvFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeModal = () => {
    if (uploading) return
    setOpen(false)
    setDepFiles([])
    setConvFiles([])
    setError(null)
  }
  const handleSubmit = async () => {
    if (depFiles.length === 0 && convFiles.length === 0) {
      setError('Selecione pelo menos uma imagem.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      await onAttach(transaction, { transaction: depFiles, conversation: convFiles })
      setOpen(false)
      setDepFiles([])
      setConvFiles([])
    } catch (err) {
      console.error('falha ao anexar comprovantes:', err)
      // Erros mais comuns aqui:
      //   - permission-denied (firestore.rules rejeitou, sistema mudou de status)
      //   - storage/unauthorized (storage.rules rejeitou, arquivo > 10MB)
      // Mostra mensagem específica em vez do code críptico do Firebase.
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : ''
      let friendly = 'Falha ao anexar comprovantes. Tente de novo.'
      if (code === 'permission-denied') {
        friendly =
          'Sem permissão pra anexar agora. Recarregue a página e tente de novo.'
      } else if (code.startsWith('storage/')) {
        friendly = 'Falha no upload da imagem (arquivo muito grande?). Tente de novo.'
      } else if (err instanceof Error && err.message) {
        friendly = err.message
      }
      setError(friendly)
    } finally {
      setUploading(false)
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Anexar comprovantes"
        className="rounded border border-amber-500/40 bg-amber-500/15 p-1 text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
      >
        <ImagePlus size={11} />
      </button>

      <Modal
        open={open}
        onClose={closeModal}
        title="Anexar comprovantes"
        subtitle={
          transaction.transactionNumber != null
            ? `#${transaction.transactionNumber} · ${transaction.clientName}`
            : transaction.clientName
        }
        width="lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-app-muted">
            Esse registro veio da planilha. Anexe os comprovantes, pode
            selecionar várias imagens em cada área.
          </p>

          <FilePicker
            label="Comprovantes de registro"
            tone="green"
            files={depFiles}
            onChange={setDepFiles}
          />
          <FilePicker
            label="Comprovantes de conversa"
            tone="blue"
            files={convFiles}
            onChange={setConvFiles}
          />

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeModal}
              disabled={uploading}
              className="rounded-lg border border-app-border bg-app-elev px-3 py-2 text-sm text-app-text transition-colors hover:bg-app-elev/80 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                uploading || (depFiles.length === 0 && convFiles.length === 0)
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Enviando…
                </>
              ) : (
                <>
                  <ImagePlus size={13} />
                  Anexar {depFiles.length + convFiles.length > 0 && `(${depFiles.length + convFiles.length})`}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

/**
 * Seletor de arquivos com lista visual dos selecionados, usado no modal de
 * anexo de comprovantes em registros importados.
 */
function FilePicker({
  label,
  tone,
  files,
  onChange,
}: {
  label: string
  tone: 'green' | 'blue'
  files: File[]
  onChange: (next: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const borderCls =
    tone === 'green' ? 'border-green-500/40' : 'border-blue-500/40'
  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    onChange([...files, ...picked])
  }
  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx))
  }
  return (
    <div className={`rounded-lg border ${borderCls} bg-app-elev/30 p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-app-muted">
          {label}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 rounded border border-app-border bg-app-card px-2 py-1 text-[11px] font-semibold text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
        >
          <ImagePlus size={11} />
          Adicionar imagens
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePick}
        className="hidden"
      />
      {files.length === 0 ? (
        <p className="text-[11px] text-app-subtle">Nenhuma imagem selecionada.</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded bg-app-card px-2 py-1 text-[11.5px]"
            >
              <span className="truncate text-app-text">{f.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remover"
                className="shrink-0 rounded p-0.5 text-app-subtle hover:bg-app-elev hover:text-app-text"
              >
                <XCircle size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Verdadeiro se `importedAt` aconteceu nos últimos 30 dias, chip "importado"
 * é só lembrete pro gestor anexar comprovantes, some sozinho depois.
 */
function isRecentImport(ts: Transaction['importedAt']): boolean {
  if (!ts) return false
  const t = (ts as { toMillis?: () => number }).toMillis?.()
  if (typeof t !== 'number') return false
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  return Date.now() - t < THIRTY_DAYS_MS
}

/**
 * Chip amber abaixo da data quando `transactionDate > hoje`. Transação é evento
 * histórico: data no futuro indica que a planilha foi importada com Excel
 * US-locale invertendo dd/mm (ex: "05/12/2026" virou Dec 5 em vez de May
 * 12). O importador atual já barra isso, mas docs criados antes do fix
 * passaram e precisam de marcação visual pra o gestor identificar e editar.
 * #bug 2026-05-26
 */
function FutureDateWarning({ transactionDate }: { transactionDate: string }) {
  if (!isFuture(transactionDate)) return null
  return (
    <div
      title="Data no futuro: provável inversão dd/mm na planilha de origem. Edite o registro pra corrigir."
      className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle size={9} strokeWidth={2.4} />
      Data inválida
    </div>
  )
}

function isFuture(isoYmd: string): boolean {
  const m = isoYmd?.match?.(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return target.getTime() > today.getTime()
}

/**
 * Linha bem discreta com a data/hora de preenchimento (createdAt do Firestore).
 * Renderiza só "dd/mm HH:mm": formato curto pra não competir com a transactionDate.
 * Quando o timestamp não vem (legado), some.
 */
function CreatedAtLine({ ts }: { ts: Transaction['createdAt'] }) {
  if (!ts) return null
  let date: Date | null = null
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    try {
      date = (ts as { toDate: () => Date }).toDate()
    } catch {
      return null
    }
  }
  if (!date) return null
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return (
    <div
      className="mt-0.5 whitespace-nowrap font-mono text-[9px] tabular-nums text-app-subtle"
      title={`Registrado em ${date.toLocaleString('pt-BR')}`}
    >
      reg. {dd}/{mm} {hh}:{mi}
    </div>
  )
}
