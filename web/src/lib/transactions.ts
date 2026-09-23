import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import type { Unsubscribe, DocumentData } from 'firebase/firestore'
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { compressImage } from './imageCompress'
import { convertToUsd } from './fxRate'
import { logActivity, type ActivityAction } from './activityLog'
import type {
  ConversationValidation,
  Transaction,
  TransactionInput,
  Setor,
} from '../types'

const COL = 'transactions'
const COUNTER_DOC = ['metadata', 'counters'] as const

interface CreateArgs extends TransactionInput {
  agenteId: string
  agenteName: string
  agenteSetor?: Setor
  /**
   * Idempotency key. Quando passado, vira o docId da transação no Firestore.
   * 2º clique no submit (ou retry após "erro de rede" que na verdade chegou)
   * tenta criar o MESMO doc: Firestore rejeita create em doc existente, então
   * NÃO duplica. Tipicamente um UUID gerado quando o form abre.
   */
  clientNonce?: string
  /**
   * Quando `true`, o doc é marcado com `importedAt: serverTimestamp()`,
   * sinaliza que veio do importador de planilha. Usado pra exibir chip
   * "importado" na lista do gestor por 30 dias e pro banner "X registros
   * sem comprovante". Comprovantes podem entrar vazios; o gestor anexa
   * depois via edição.
   */
  markImported?: boolean
}

/**
 * Limpa imagens órfãs no Storage. Usada quando uma criação falha no meio.
 * Best-effort: ignora erros individuais (item pode já estar deletado).
 */
async function cleanupStorageFolder(
  agenteId: string,
  transactionId: string,
): Promise<void> {
  const folder = ref(storage, `transactions/${agenteId}/${transactionId}`)
  try {
    const all = await listAll(folder)
    await Promise.all(
      all.items.map((item) => deleteObject(item).catch(() => undefined)),
    )
  } catch {
    // pasta pode nem existir
  }
}

/**
 * Cria uma transação de forma **atômica e durável**.
 *
 * Etapas:
 *   1. Comprime imagens + busca FX (paralelo, sem reservar nada).
 *   2. Faz upload das imagens pro Storage no path `transactions/{uid}/{transactionId}`.
 *      Se upload falha, limpa o que subiu e aborta, counter intacto.
 *   3. Transação Firestore ATÔMICA que (a) incrementa `metadata/counters`
 *      em +1 e (b) faz `setDoc` da transação com esse número novo. Ou tudo
 *      commita, ou nada: counter NÃO vaza se o setDoc falhar.
 *   4. Se a transação falha mesmo assim (ex: rule recusou), limpa as imagens
 *      do Storage no catch: não deixa órfã sem doc.
 *
 * O contrário (esquema antigo: reservar número antes dos uploads) causava
 * buracos no contador toda vez que o upload travava (rede ruim, mobile fraco).
 */
export async function createTransaction(args: CreateArgs): Promise<string> {
  // 1) Compressão + FX em paralelo, nada tocado em Firestore/Storage ainda.
  const [transactionReceipts, conversationReceipts, fx] = await Promise.all([
    Promise.all(args.transactionReceipts.map((f) => compressImage(f))),
    Promise.all(args.conversationReceipts.map((f) => compressImage(f))),
    convertToUsd(args.amount, args.currency, args.transactionDate),
  ])

  // 2) Reserva docId: usa o `clientNonce` quando passado (idempotência:
  //    2º clique tenta criar o MESMO docId e a transação falha; sem erro de
  //    duplicado pro usuário). Sem nonce, auto-id.
  const docRef = args.clientNonce
    ? doc(db, COL, args.clientNonce)
    : doc(collection(db, COL))
  const transactionId = docRef.id

  // 3) Upload. Se falha, tenta limpar o que subiu e aborta sem mexer no counter.
  let transactionReceiptUrls: string[] = []
  let conversationReceiptUrls: string[] = []
  try {
    ;[transactionReceiptUrls, conversationReceiptUrls] = await Promise.all([
      uploadAll(args.agenteId, transactionId, 'transaction', transactionReceipts),
      uploadAll(args.agenteId, transactionId, 'conversation', conversationReceipts),
    ])
  } catch (uploadErr) {
    console.error('[createTransaction] STORAGE upload falhou:', uploadErr, {
      agenteId: args.agenteId,
      transactionId,
    })
    await cleanupStorageFolder(args.agenteId, transactionId)
    throw uploadErr
  }

  // 4) Transação atômica: counter +1 + setDoc da transação. Firestore garante
  //    "tudo ou nada": se setDoc falha, o increment do counter NÃO commita.
  //    Idempotência: se o docId já existe (clientNonce usado em retry/duplo
  //    clique), pula o create e retorna o número que já estava lá.
  try {
    const transactionNumber = await runTransaction(db, async (tx) => {
      if (args.clientNonce) {
        const existing = await tx.get(docRef)
        if (existing.exists()) {
          // Já foi criado antes: não duplica. Retorna o número original.
          return Number(
            (existing.data() as { transactionNumber?: number }).transactionNumber || 0,
          )
        }
      }
      const counterRef = doc(db, ...COUNTER_DOC)
      const snap = await tx.get(counterRef)
      const current =
        (snap.exists() ? (snap.data().transactionsCounter as number) : 0) || 0
      const next = current + 1
      tx.set(counterRef, { transactionsCounter: next }, { merge: true })

      const data: Record<string, unknown> = {
        transactionNumber: next,
        agenteId: args.agenteId,
        agenteName: args.agenteName,
        clientName: args.clientName,
        clientEmail: args.clientEmail,
        clientPhone: args.clientPhone,
        clientId: args.clientId,
        currency: args.currency,
        amount: args.amount,
        transactionDate: args.transactionDate,
        transactionReceiptUrls,
        conversationReceiptUrls,
        systemValidation: 'pending',
        conversationValidation: 'pending',
        isActivation: false,
        // Liga a máscara visual da Identificação no gestor (#{id}{L1}{seq}{L2}).
        // Só pros docs criados a partir desta feature, docs antigos caem no
        // fallback `#{clientId}` sem causar conflito de seq.
        agentMaskedIdEnabled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      if (args.markImported) {
        // Carimba o doc como vindo do importador. Chip "importado" some
        // depois de 30 dias no TransactionList (agent view).
        data.importedAt = serverTimestamp()
      }
      if (args.agenteSetor) data.agenteSetor = args.agenteSetor
      if (fx) {
        data.usdAmount = fx.usdAmount
        data.usdRate = fx.usdRate
        data.usdRateDate = fx.usdRateDate
      } else if (args.currency !== 'USD') {
        // Conversão falhou e moeda não é USD, marca flag pra retry e pra
        // bloquear o /close enquanto não resolver. USD não precisa de FX.
        data.usdConversionPending = true
      }
      tx.set(docRef, data)
      return next
    })

    await logActivity({
      action: 'transaction.create',
      targetType: 'transaction',
      targetId: transactionId,
      targetLabel: `#${transactionNumber} · ${args.clientName}`,
    })

    return transactionId
  } catch (txErr) {
    // Transação falhou: counter NÃO incrementou. Imagens viraram órfãs,
    // limpa pra não pagar storage por nada.
    console.error('[createTransaction] TRANSAÇÃO falhou:', txErr, {
      agenteId: args.agenteId,
      agenteName: args.agenteName,
      agenteSetor: args.agenteSetor,
      transactionId,
      hasFx: !!fx,
      currency: args.currency,
    })
    await cleanupStorageFolder(args.agenteId, transactionId)
    throw txErr
  }
}

/** Constrói label legível "#N · cliente" pra logs de transação. */
function transactionLabel(
  d: Pick<Transaction, 'transactionNumber' | 'clientName'>,
): string {
  return d.transactionNumber != null
    ? `#${d.transactionNumber} · ${d.clientName}`
    : d.clientName || '-'
}

async function uploadAll(
  agenteId: string,
  transactionId: string,
  kind: 'transaction' | 'conversation',
  files: File[],
): Promise<string[]> {
  return Promise.all(
    files.map((f, i) => {
      const ext = f.name.split('.').pop() || 'jpg'
      const r = ref(storage, `transactions/${agenteId}/${transactionId}/${kind}-${i}.${ext}`)
      return uploadBytes(r, f, { contentType: f.type }).then(() => getDownloadURL(r))
    }),
  )
}

/**
 * Anexa comprovantes a um registro IMPORTADO pela planilha. Pula o fluxo de
 * pendingEdit: atualiza `transactionReceiptUrls` / `conversationReceiptUrls`
 * direto. A rule do Firestore libera essa transição enquanto:
 *   - doc tem `importedAt`;
 *   - `systemValidation == 'pending'` (sistema ainda não rodou);
 *   - os arrays só CRESCEM (append-only, não dá pra remover/substituir aqui).
 *
 * Aceita imagens de registro E/OU de conversa, ambas em quantidades arbitrárias.
 * Devolve as URLs novas de cada categoria. Chamadas múltiplas são suportadas
 * (gestor pode anexar mais imagens depois enquanto o sistema não validar).
 */
export async function attachImportedReceipts(
  transaction: Transaction,
  files: { transaction?: File[]; conversation?: File[] },
): Promise<{ transaction: string[]; conversation: string[] }> {
  const depFiles = files.transaction ?? []
  const convFiles = files.conversation ?? []
  if (depFiles.length === 0 && convFiles.length === 0) {
    return { transaction: [], conversation: [] }
  }
  // Comprime ANTES do upload: fotos brutas de celular passam de 10MB e
  // batem no `request.resource.size < 10MB` do storage.rules, falhando o
  // upload silenciosamente (#bug 2026-05-26). compressImage devolve ≤1600px
  // / JPEG 0.82, tipicamente <500KB.
  const [compressedDep, compressedConv] = await Promise.all([
    Promise.all(depFiles.map((f) => compressImage(f))),
    Promise.all(convFiles.map((f) => compressImage(f))),
  ])

  // Faz upload em paralelo, depois grava UMA mutação atômica no Firestore
  // (cobre os dois arrays na mesma update, a rule espera affectedKeys hasOnly
  // entre transactionReceiptUrls + conversationReceiptUrls + updatedAt).
  const stamp = Date.now()
  const uploadKind = async (kind: 'transaction' | 'conversation', list: File[]) => {
    if (list.length === 0) return [] as string[]
    return Promise.all(
      list.map((f, i) => {
        const ext = f.name.split('.').pop() || 'jpg'
        const r = ref(
          storage,
          `transactions/${transaction.agenteId}/${transaction.id}/${kind}-${stamp}-${i}.${ext}`,
        )
        return uploadBytes(r, f, { contentType: f.type }).then(() => getDownloadURL(r))
      }),
    )
  }
  const [newDep, newConv] = await Promise.all([
    uploadKind('transaction', compressedDep),
    uploadKind('conversation', compressedConv),
  ])
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (newDep.length > 0) {
    patch.transactionReceiptUrls = [...(transaction.transactionReceiptUrls ?? []), ...newDep]
  }
  if (newConv.length > 0) {
    patch.conversationReceiptUrls = [
      ...(transaction.conversationReceiptUrls ?? []),
      ...newConv,
    ]
  }
  await updateDoc(doc(db, COL, transaction.id), patch)
  await logActivity({
    action: 'transaction.receipts-add',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    changes: {
      ...(newDep.length > 0 && {
        transactionReceiptUrls: {
          from: (transaction.transactionReceiptUrls ?? []).length,
          to: (transaction.transactionReceiptUrls ?? []).length + newDep.length,
        },
      }),
      ...(newConv.length > 0 && {
        conversationReceiptUrls: {
          from: (transaction.conversationReceiptUrls ?? []).length,
          to: (transaction.conversationReceiptUrls ?? []).length + newConv.length,
        },
      }),
    },
  })
  return { transaction: newDep, conversation: newConv }
}

/**
 * Anexa novas imagens à transação (sem tocar nas já existentes) e atualiza o
 * array correspondente em `transactions/{id}`. Usado na edição. Nomeia os files
 * com timestamp + índice pra evitar colisão com nomes antigos.
 */
export async function appendReceipts(
  transaction: Transaction,
  kind: 'transaction' | 'conversation',
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return []
  const field = kind === 'transaction' ? 'transactionReceiptUrls' : 'conversationReceiptUrls'
  const existing =
    kind === 'transaction' ? transaction.transactionReceiptUrls : transaction.conversationReceiptUrls
  const stamp = Date.now()
  const newUrls = await Promise.all(
    files.map((f, i) => {
      const ext = f.name.split('.').pop() || 'jpg'
      const r = ref(
        storage,
        `transactions/${transaction.agenteId}/${transaction.id}/${kind}-${stamp}-${i}.${ext}`,
      )
      return uploadBytes(r, f, { contentType: f.type }).then(() => getDownloadURL(r))
    }),
  )
  await updateDoc(doc(db, COL, transaction.id), {
    [field]: [...(existing ?? []), ...newUrls],
    updatedAt: serverTimestamp(),
  })
  await logActivity({
    action: 'transaction.receipts-add',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    changes: {
      [field]: {
        from: (existing ?? []).length,
        to: (existing ?? []).length + newUrls.length,
      },
    },
  })
  return newUrls
}

/**
 * Upload de imagens pra um path provisório (`pending/`), usado pelo gestor
 * quando edita imagens via pendingEdit. Quando admin aprova, as URLs viram
 * parte do array principal; quando rejeita, as URLs são deletadas. Os
 * arquivos ficam fisicamente acessíveis o tempo todo (gestor pode revisar).
 */
export async function uploadPendingReceipts(
  transaction: Transaction,
  kind: 'transaction' | 'conversation',
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return []
  const stamp = Date.now()
  return Promise.all(
    files.map((f, i) => {
      const ext = f.name.split('.').pop() || 'jpg'
      const r = ref(
        storage,
        `transactions/${transaction.agenteId}/${transaction.id}/pending/${kind}-${stamp}-${i}.${ext}`,
      )
      return uploadBytes(r, f, { contentType: f.type }).then(() => getDownloadURL(r))
    }),
  )
}

/**
 * Aplica as instruções de imagem (add/remove) de um payload de edição. Não
 * grava no Firestore: devolve um patch com os novos arrays prontos pra
 * mesclar com o resto do update. Também deleta do Storage as URLs removidas
 * (best-effort).
 */
async function applyReceiptChanges(
  transaction: Transaction,
  changes: TransactionEditPayload,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {}
  await applyKind(
    'transaction',
    transaction.transactionReceiptUrls,
    changes.addedTransactionReceipts,
    changes.removedTransactionReceipts,
    'transactionReceiptUrls',
  )
  await applyKind(
    'conversation',
    transaction.conversationReceiptUrls,
    changes.addedConversationReceipts,
    changes.removedConversationReceipts,
    'conversationReceiptUrls',
  )
  return patch

  async function applyKind(
    _kind: 'transaction' | 'conversation',
    current: string[] | undefined,
    added: string[] | undefined,
    removed: string[] | undefined,
    field: 'transactionReceiptUrls' | 'conversationReceiptUrls',
  ) {
    if (!added?.length && !removed?.length) return
    const next = [
      ...((current ?? []).filter((u) => !removed?.includes(u))),
      ...(added ?? []),
    ]
    patch[field] = next
    // Deleta as removidas do storage best-effort
    for (const url of removed ?? []) {
      try {
        await deleteObject(ref(storage, url))
      } catch (err) {
        console.warn('falha ao deletar imagem removida:', err)
      }
    }
  }
}

/**
 * Deleta imagens "added" propostas no pendingEdit, usado quando admin
 * rejeita a edição (pra não deixar lixo em Storage).
 */
async function deletePendingAddedReceipts(transaction: Transaction): Promise<void> {
  const changes = transaction.pendingEdit?.changes
  if (!changes) return
  const urls = [
    ...(changes.addedTransactionReceipts ?? []),
    ...(changes.addedConversationReceipts ?? []),
  ]
  for (const url of urls) {
    try {
      await deleteObject(ref(storage, url))
    } catch (err) {
      console.warn('falha ao deletar imagem rejeitada:', err)
    }
  }
}

/**
 * Remove uma imagem específica (pelo URL) do array da transação e tenta apagar
 * o arquivo do Storage best-effort: se a deleção do Storage falhar (token
 * expirado, etc.), a URL ainda é removida do Firestore.
 */
export async function removeReceipt(
  transaction: Transaction,
  kind: 'transaction' | 'conversation',
  url: string,
): Promise<void> {
  const field = kind === 'transaction' ? 'transactionReceiptUrls' : 'conversationReceiptUrls'
  const existing =
    kind === 'transaction' ? transaction.transactionReceiptUrls : transaction.conversationReceiptUrls
  const next = (existing ?? []).filter((u) => u !== url)
  if (next.length === (existing ?? []).length) return
  try {
    await deleteObject(ref(storage, url))
  } catch (err) {
    console.warn('falha ao apagar imagem do storage (ok, segue removendo do doc):', err)
  }
  await updateDoc(doc(db, COL, transaction.id), {
    [field]: next,
    updatedAt: serverTimestamp(),
  })
  await logActivity({
    action: 'transaction.receipt-remove',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    changes: { [field]: { from: (existing ?? []).length, to: next.length } },
  })
}

function normalize(id: string, raw: DocumentData): Transaction {
  const legacyStatus = (raw as { status?: string }).status
  const conversationValidation =
    (raw.conversationValidation as ConversationValidation | undefined) ??
    (legacyStatus === 'validated'
      ? 'approved'
      : legacyStatus === 'rejected'
        ? 'rejected'
        : 'pending')

  // Compatibilidade com transações antigas que tinham URL única
  const transactionReceiptUrls: string[] =
    raw.transactionReceiptUrls ?? (raw.transactionReceiptUrl ? [raw.transactionReceiptUrl] : [])
  const conversationReceiptUrls: string[] =
    raw.conversationReceiptUrls ?? (raw.conversationReceiptUrl ? [raw.conversationReceiptUrl] : [])

  return {
    id,
    transactionNumber: raw.transactionNumber,
    agenteId: raw.agenteId,
    agenteName: raw.agenteName,
    agenteSetor: raw.agenteSetor,
    clientName: raw.clientName,
    clientEmail: raw.clientEmail,
    clientPhone: raw.clientPhone,
    clientId: raw.clientId,
    currency: raw.currency ?? 'USD',
    amount: raw.amount ?? 0,
    // Campos legados (não coletados hoje); preservados se o doc tem.
    balance: typeof raw.balance === 'number' ? raw.balance : undefined,
    bonus: typeof raw.bonus === 'number' ? raw.bonus : undefined,
    netCapital: typeof raw.netCapital === 'number' ? raw.netCapital : undefined,
    transactionDate: raw.transactionDate,
    transactionReceiptUrls,
    conversationReceiptUrls,
    systemValidation: raw.systemValidation ?? 'pending',
    conversationValidation,
    isActivation: raw.isActivation ?? false,
    conversationNote: raw.conversationNote ?? raw.validationNote ?? undefined,
    validationChecks: raw.validationChecks ?? undefined,
    matchedTransactionId: raw.matchedTransactionId ?? undefined,
    bestCandidate: raw.bestCandidate ?? undefined,
    duplicateAlert: raw.duplicateAlert ?? undefined,
    pendingEdit: raw.pendingEdit ?? undefined,
    editRequestCount:
      typeof raw.editRequestCount === 'number' ? raw.editRequestCount : undefined,
    lastOperationDate: normalizeLastOperationDate(raw.lastOperationDate),
    // País (ISO-2) e parceria do sistema de origem, VISUAIS (mapa geográfico + indicador
    // "Fora da parceria"). `sourcePartnerCode` é tri-state: string (tem parceria) / null
    // (orgânico, sem parceria) / undefined (não consultado), preservar o null.
    sourceCountry: typeof raw.sourceCountry === 'string' ? raw.sourceCountry : undefined,
    sourcePartnerCode:
      typeof raw.sourcePartnerCode === 'string'
        ? raw.sourcePartnerCode
        : raw.sourcePartnerCode === null
          ? null
          : undefined,
    // Classificação Premium/Starter via CRM (Pipedrive). Ver lib/pipedrive.ts.
    pipedriveTribe:
      raw.pipedriveTribe === 'premium' ||
      raw.pipedriveTribe === 'starter' ||
      raw.pipedriveTribe === 'nao_encontrado'
        ? raw.pipedriveTribe
        : undefined,
    pipedriveMatchedBy:
      raw.pipedriveMatchedBy === 'email' || raw.pipedriveMatchedBy === 'phone'
        ? raw.pipedriveMatchedBy
        : undefined,
    pipedriveDealAddTime:
      typeof raw.pipedriveDealAddTime === 'string' ? raw.pipedriveDealAddTime : undefined,
    pipedriveStage: typeof raw.pipedriveStage === 'string' ? raw.pipedriveStage : undefined,
    pipedriveKey: typeof raw.pipedriveKey === 'string' ? raw.pipedriveKey : undefined,
    usdAmount: typeof raw.usdAmount === 'number' ? raw.usdAmount : undefined,
    usdRate: typeof raw.usdRate === 'number' ? raw.usdRate : undefined,
    usdRateDate: typeof raw.usdRateDate === 'string' ? raw.usdRateDate : undefined,
    usdConversionPending:
      typeof raw.usdConversionPending === 'boolean' ? raw.usdConversionPending : undefined,
    agentMaskedIdEnabled:
      typeof raw.agentMaskedIdEnabled === 'boolean'
        ? raw.agentMaskedIdEnabled
        : undefined,
    importedAt: raw.importedAt ?? undefined,
    commissionSettledAt: raw.commissionSettledAt ?? undefined,
    commissionSettledBy:
      typeof raw.commissionSettledBy === 'string' ? raw.commissionSettledBy : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

/**
 * `lastOperationDate` em Firestore vem em uma destas formas:
 *  - undefined / ausente → ainda não consultado (mantém como undefined)
 *  - null → cliente está na source mas nunca operou
 *  - string ISO 'yyyy-mm-dd' → data da última operação
 *  - Timestamp (Firestore) → caso o backend tenha gravado um datetime
 *
 * Aqui normalizamos pra `string | null | undefined`. Frontend só precisa da data.
 */
function normalizeLastOperationDate(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw === 'string') return raw
  // Defensivo: se vier Timestamp Firestore, converte
  if (raw && typeof raw === 'object' && 'toDate' in raw && typeof (raw as { toDate: unknown }).toDate === 'function') {
    try {
      const d = (raw as { toDate: () => Date }).toDate()
      return d.toISOString().slice(0, 10)
    } catch {
      return undefined
    }
  }
  return undefined
}

export function subscribeAgenteTransactions(
  agenteId: string,
  cb: (transactions: Transaction[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, COL),
    where('agenteId', '==', agenteId),
    orderBy('createdAt', 'desc'),
  )
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => normalize(d.id, d.data())))
  })
}

/**
 * Subscribe global de transactions.
 *
 * Janela temporal (`since`): lê só docs com `createdAt >= since`. Default 180
 * dias: cobre todos os fechamentos correntes + lookbacks comuns. Sem janela,
 * cada admin lia o histórico INTEIRO (centenas/milhares de docs) toda vez que
 * abria a tela.
 *
 * Quando `setores` é informado, filtra no Firestore por `agenteSetor` IN
 * setores: essencial pro role `supervisor`, cujas firestore.rules só
 * permitem `read` dentro do próprio escopo. Suporta lista (não só 1 setor)
 * pra cobrir supervisor 'premium_starter' que enxerga ambos os setores.
 *
 * Admin/super_admin chamam sem `setores` e recebem tudo (dentro da janela).
 */
const DEFAULT_SUBSCRIBE_DAYS = 180

export function subscribeAllTransactions(
  cb: (transactions: Transaction[]) => void,
  setores?: Setor[],
  options: { sinceDays?: number } = {},
): Unsubscribe {
  const sinceDays = options.sinceDays ?? DEFAULT_SUBSCRIBE_DAYS
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - sinceDays)
  sinceDate.setHours(0, 0, 0, 0)

  // Sem setores → admin/super, sem filtro.
  // 1 setor → where ==
  // Múltiplos setores → where in (Firestore aceita até 30 valores).
  const setorConstraint =
    !setores || setores.length === 0
      ? []
      : setores.length === 1
        ? [where('agenteSetor', '==', setores[0])]
        : [where('agenteSetor', 'in', setores)]

  const constraints = [
    where('createdAt', '>=', Timestamp.fromDate(sinceDate)),
    ...setorConstraint,
    orderBy('createdAt', 'desc'),
  ]
  const q = query(collection(db, COL), ...constraints)
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => normalize(d.id, d.data())))
  })
}

const VALIDATION_RESET_FIELDS = {
  systemValidation: 'pending',
  isActivation: false,
  matchedTransactionId: deleteField(),
  validationChecks: deleteField(),
  duplicateAlert: deleteField(),
}

/**
 * Deleta a transação + **dispara cascata de revalidação no grupo de match**.
 *
 * Validação é contínua: quando uma transação desse grupo (mesmos
 * clientId/amount/currency/transactionDate) some, os outros que ficaram podem
 * deixar de ser `duplicate` e voltar a `verified` (ou virar duplicate
 * cross-agent diferente etc.). A Cloud Function `validate-on-update` só roda
 * no trigger UPDATE: então marcamos os linkados como `pending` + bump em
 * `updatedAt` pra forçar o reprocessamento.
 *
 * Storage é limpo best-effort antes do batch, falha em deletar imagem não
 * bloqueia o delete do doc.
 */
export async function deleteTransaction(
  transaction: Transaction,
  opts: CascadeOptions = {},
): Promise<void> {
  // 1) Identifica TODOS os transactions do grupo de match (mesma "linha" no source),
  //    via query: mais robusto que confiar em duplicateAlert.linkedTransactionIds,
  //    que pode estar desatualizado. Filtra pelo setor do ator (supervisor)
  //    pra não tentar write em transaction alheio (proibido pelas rules).
  const groupMembers = await fetchGroupMembers(
    transaction.clientId,
    transaction.amount,
    transaction.currency,
    transaction.transactionDate,
    transaction.id,
  )
  const reachable = filterReachable(groupMembers, opts.actorSetores)

  // 2) Limpa imagens (best-effort, fora do batch)
  try {
    const folder = ref(storage, `transactions/${transaction.agenteId}/${transaction.id}`)
    const all = await listAll(folder)
    await Promise.all(all.items.map((item) => deleteObject(item)))
  } catch (err) {
    console.warn('falha ao limpar storage do transaction', transaction.id, err)
  }

  // 3) Deleta o doc primeiro (em separado do batch dos linkados). Notei na
  //    prática que combinar delete+update num mesmo batch nem sempre dispara
  //    o trigger UPDATE de Firestore nos linkados de forma confiável, então
  //    dividimos: delete sozinho, depois batch só com updates.
  await deleteDoc(doc(db, COL, transaction.id))

  // 4) Reset cascata dos linkados acessíveis pra forçar revalidação. Cada
  //    update emite um trigger UPDATE → `validate-on-update` revalida contra
  //    o source. Docs cross-setor (filtrados) são corrigidos pelo trigger
  //    quando o seu próprio grupo for re-listado (Cloud Function roda como SA
  //    e tem visão de todos os transactions).
  if (reachable.length > 0) {
    const batch = writeBatch(db)
    for (const m of reachable) {
      batch.update(doc(db, COL, m.id), {
        ...VALIDATION_RESET_FIELDS,
        updatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
  }

  const skipped = groupMembers.length - reachable.length

  // 5) Se o transaction deletado era uma ATIVAÇÃO, dispara revalidação dos outros
  //    transactions da MESMA conta (clientId). O is_activation no backend agora
  //    considera só transactions ativos: então o próximo do cliente precisa ser
  //    re-disparado pra virar a nova ativação. Cobre o caso "mesma conta".
  //    Multi-conta do mesmo cliente final é coberto pelo scheduler (30min).
  if (transaction.isActivation) {
    try {
      const sameClientSnap = await getDocs(
        query(
          collection(db, COL),
          where('clientId', '==', transaction.clientId),
        ),
      )
      const toReset = sameClientSnap.docs
        .filter((d) => d.id !== transaction.id)
        .filter((d) => {
          if (!opts.actorSetores || opts.actorSetores.length === 0) return true
          const setor = (d.data() as { agenteSetor?: Setor }).agenteSetor
          return setor !== undefined && opts.actorSetores.includes(setor)
        })
      if (toReset.length > 0) {
        const batch = writeBatch(db)
        for (const d of toReset) {
          batch.update(d.ref, {
            ...VALIDATION_RESET_FIELDS,
            updatedAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }
    } catch (err) {
      console.warn(
        'falha disparando revalidação de mesma conta após delete de ativação',
        err,
      )
    }
  }

  await logActivity({
    action: 'transaction.delete',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    note:
      reachable.length > 0 || skipped > 0
        ? `${reachable.length} linkado(s) resetado(s)${
            skipped > 0 ? `, ${skipped} cross-setor pulado(s)` : ''
          } pra revalidação${
            transaction.isActivation ? ' · ativação revalidada (mesma conta)' : ''
          }`
        : transaction.isActivation
          ? 'Ativação deletada: outros da mesma conta foram revalidados'
          : undefined,
  })
}

/**
 * Forço re-validação de uma transação específica, admin clica num botão e o doc
 * volta pra `pending`, disparando o trigger `validate-on-update` que reavalia
 * contra o source. Útil como fallback quando a cascata automática não pegou
 * (deploy desatualizado, race com o snapshot do Firestore, etc.).
 */
export async function forceRevalidate(transaction: Transaction): Promise<void> {
  await updateDoc(doc(db, COL, transaction.id), {
    ...VALIDATION_RESET_FIELDS,
    updatedAt: serverTimestamp(),
  })
  await logActivity({
    action: 'transaction.force-revalidate',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
  })
}

export interface TransactionEditPayload {
  clientName?: string
  clientEmail?: string
  clientPhone?: string
  clientId?: string
  currency?: 'USD' | 'EUR' | 'GBP'
  amount?: number
  transactionDate?: string
  /** URLs já uploadadas em path provisório, pra anexar ao array principal. */
  addedTransactionReceipts?: string[]
  /** URLs do array atual marcadas pra remover. */
  removedTransactionReceipts?: string[]
  addedConversationReceipts?: string[]
  removedConversationReceipts?: string[]
}

/**
 * Whitelist DEFINITIVA do que pode ser proposto/aplicado numa edição. NUNCA
 * gravar nada fora dessa lista: sem isso, payload malicioso (via SDK direto)
 * pode injetar `agenteId`/`agenteSetor`/`isActivation`/`systemValidation` em
 * `pendingEdit.changes`, e o admin aprova achando que é só um campo de
 * cliente. Resultado: comissão migra de dono.
 *
 * Campos `balance`, `bonus`, `netCapital` foram removidos do escopo em
 * 2026-05-14: não coletamos mais.
 */
const EDITABLE_FIELDS: Array<keyof TransactionEditPayload> = [
  'clientName',
  'clientEmail',
  'clientPhone',
  'clientId',
  'currency',
  'amount',
  'transactionDate',
  'addedTransactionReceipts',
  'removedTransactionReceipts',
  'addedConversationReceipts',
  'removedConversationReceipts',
]

/** Campos do payload que NÃO são alterações de campo do doc, são instruções
 *  pra mexer nas arrays de URL. Separar pra `update` não tentar gravar como
 *  campo direto. */
const RECEIPT_EDIT_FIELDS: Array<keyof TransactionEditPayload> = [
  'addedTransactionReceipts',
  'removedTransactionReceipts',
  'addedConversationReceipts',
  'removedConversationReceipts',
]

function sanitizeEditPayload(raw: TransactionEditPayload): TransactionEditPayload {
  const out: TransactionEditPayload = {}
  for (const k of EDITABLE_FIELDS) {
    if (k in raw && raw[k] !== undefined) {
      ;(out as Record<string, unknown>)[k] = raw[k]
    }
  }
  return out
}

/** Agente: cria/sobrescreve a proposta de edicao (precisa de aprovacao do admin).
 *
 * Incrementa o `editRequestCount` cumulativo, quando >= 3, dispara alerta no
 * bell do admin/super e badge "abuso" na tela de Edições. Contador NÃO zera
 * em aprovar/rejeitar; é histórico do gestor pra aquele transação. */
export async function requestTransactionEdit(
  transaction: Transaction,
  submittedBy: string,
  changes: TransactionEditPayload,
): Promise<void> {
  const safe = sanitizeEditPayload(changes)
  await updateDoc(doc(db, COL, transaction.id), {
    pendingEdit: {
      submittedAt: serverTimestamp(),
      submittedBy,
      changes: safe,
    },
    editRequestCount: increment(1),
    updatedAt: serverTimestamp(),
  })
  await logActivity({
    action: 'transaction.edit-request',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    changes: buildChangesDiff(transaction, safe),
  })
}

/** Monta um diff `{field: {from, to}}` enxuto pra log. */
function buildChangesDiff(
  transaction: Transaction,
  changes: TransactionEditPayload,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const k of Object.keys(changes) as (keyof TransactionEditPayload)[]) {
    out[k] = {
      from: (transaction as unknown as Record<string, unknown>)[k] ?? null,
      to: changes[k] ?? null,
    }
  }
  return out
}

/**
 * Quando `amount`, `currency` ou `transactionDate` mudam numa edição, recalcula
 * a conversão pra USD e devolve os campos a serem mesclados no update. Se a
 * cotação falhar, retorna `{}`: o documento continua válido mas com USD
 * desatualizado até a próxima edição.
 */
async function buildFxFieldsForEdit(
  transaction: Transaction,
  changes: TransactionEditPayload,
): Promise<Record<string, unknown>> {
  const amountChanged = 'amount' in changes
  const currencyChanged = 'currency' in changes
  const dateChanged = 'transactionDate' in changes
  if (!amountChanged && !currencyChanged && !dateChanged) return {}

  const effAmount = (changes.amount ?? transaction.amount) || 0
  const effCurrency = changes.currency ?? transaction.currency
  const effDate = changes.transactionDate ?? transaction.transactionDate

  // USD: identidade, sem precisar da API; remove flag pendente se havia.
  if (effCurrency === 'USD') {
    return {
      usdAmount: effAmount,
      usdRate: 1,
      usdRateDate: effDate,
      usdConversionPending: deleteField(),
    }
  }

  const fx = await convertToUsd(effAmount, effCurrency, effDate)
  if (!fx) {
    // Falha → marca pendente pra cron retentar (não bloqueia o save).
    return {
      usdConversionPending: true,
    }
  }
  return {
    usdAmount: fx.usdAmount,
    usdRate: fx.usdRate,
    usdRateDate: fx.usdRateDate,
    usdConversionPending: deleteField(),
  }
}

/**
 * Admin: aplica a edicao proposta nos campos reais do transaction.
 *
 * Se mudou alguma chave de match (clientId/amount/currency/transactionDate):
 * - Reset do proprio transaction pra 'pending'
 * - **Tambem reset dos transactions que estavam duplicate-linkados a ele**, eles
 *   precisam ser reavaliados agora que esse transaction saiu do grupo (podem nao ser
 *   mais duplicate). Tudo num batch atomico.
 *
 * Apos commit, o trigger UPDATE da Cloud Function dispara em cada doc resetado
 * e revalida instantaneamente contra source_transactions.
 */
interface GroupMember {
  id: string
  agenteSetor?: Setor
}

/**
 * Opções pra ações que disparam cascata de revalidação. Quando `actorSetores`
 * é setado (caso supervisor), a cascata pelo client SÓ toca transactions cujo
 * `agenteSetor` está na lista: docs cross-setor ficam pra a Cloud Function
 * `validate-on-update` corrigir (ela roda como service account e ignora
 * rules). Admin/super_admin não passa nada: cascata acerta tudo.
 *
 * Pra supervisor com setor virtual 'premium_starter', a lista é ['premium','starter'].
 */
export interface CascadeOptions {
  actorSetores?: Setor[]
}

function filterReachable(
  members: GroupMember[],
  actorSetores: Setor[] | undefined,
): GroupMember[] {
  if (!actorSetores || actorSetores.length === 0) return members
  return members.filter(
    (m) => m.agenteSetor !== undefined && actorSetores.includes(m.agenteSetor),
  )
}

/**
 * Busca outros transactions que casam com (clientId, amount, currency,
 * transactionDate). Usado pra montar cascata de revalidação. Exclui o próprio doc.
 *
 * Retorna `agenteSetor` junto pra o caller poder filtrar quando o ator é
 * supervisor (que só pode escrever em transactions do próprio setor, docs
 * cross-setor são deixados pra Cloud Function corrigir).
 */
async function fetchGroupMembers(
  clientId: string,
  amount: number,
  currency: Transaction['currency'],
  transactionDate: string,
  excludeId: string,
): Promise<GroupMember[]> {
  const snap = await getDocs(
    query(
      collection(db, COL),
      where('clientId', '==', clientId),
      where('amount', '==', amount),
      where('currency', '==', currency),
      where('transactionDate', '==', transactionDate),
    ),
  )
  return snap.docs
    .filter((d) => d.id !== excludeId)
    .map((d) => ({
      id: d.id,
      agenteSetor: (d.data() as { agenteSetor?: Setor }).agenteSetor,
    }))
}

export async function approveTransactionEdit(
  transaction: Transaction,
  opts: CascadeOptions = {},
): Promise<void> {
  const rawChanges = transaction.pendingEdit?.changes
  if (!rawChanges) return
  // Defesa em profundidade: mesmo a rule sendo whitelist no `create` do
  // pendingEdit, sanitizamos no momento de APLICAR pra impedir que um doc
  // legacy ou edição feita via SDK direto consiga injetar agenteId/setor/etc.
  const changes = sanitizeEditPayload(rawChanges)
  const matchKeys = ['clientId', 'amount', 'currency', 'transactionDate'] as const
  const matchChanged = matchKeys.some((k) => k in changes)

  // 1) Se mudou match, identifica o GRUPO ANTIGO (valores atuais) e o GRUPO
  //    NOVO (valores em `changes`). Ambos precisam revalidar:
  //      - antigo: transactions que ficaram sozinhos no grupo podem voltar de
  //        duplicate → verified.
  //      - novo: transactions que já existiam no grupo destino podem virar
  //        duplicate agora que o editado entrou. Sem isso, eles ficam com
  //        `verified` antigo e a cascata da Cloud Function não dispara em
  //        TODOS (a UPDATE só roda no doc editado, e ele pode não pegar todos
  //        os efeitos cross-doc).
  //    Supervisor: cascata pelo client SÓ no próprio setor; Cloud Function
  //    corrige os cross-setor.
  let toReset: GroupMember[] = []
  if (matchChanged) {
    const [oldGroup, newGroup] = await Promise.all([
      fetchGroupMembers(
        transaction.clientId,
        transaction.amount,
        transaction.currency,
        transaction.transactionDate,
        transaction.id,
      ),
      fetchGroupMembers(
        changes.clientId ?? transaction.clientId,
        changes.amount ?? transaction.amount,
        (changes.currency ?? transaction.currency) as Transaction['currency'],
        changes.transactionDate ?? transaction.transactionDate,
        transaction.id,
      ),
    ])
    // Dedup por id: pode haver overlap se a mudança foi parcial.
    const seen = new Set<string>()
    const merged: GroupMember[] = []
    for (const m of [...oldGroup, ...newGroup]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(m)
    }
    toReset = filterReachable(merged, opts.actorSetores)
  }

  const fxFields = await buildFxFieldsForEdit(transaction, changes)
  const receiptPatch = await applyReceiptChanges(transaction, changes)

  const batch = writeBatch(db)

  // 2) atualiza o proprio transaction: campos de instrução de imagem ficam fora
  //    (RECEIPT_EDIT_FIELDS); o `receiptPatch` traz os arrays já consolidados.
  const fieldChanges: Record<string, unknown> = {}
  for (const k of Object.keys(changes) as (keyof TransactionEditPayload)[]) {
    if (RECEIPT_EDIT_FIELDS.includes(k)) continue
    fieldChanges[k] = changes[k]
  }
  const update: Record<string, unknown> = {
    ...fieldChanges,
    ...fxFields,
    ...receiptPatch,
    pendingEdit: deleteField(),
    updatedAt: serverTimestamp(),
  }
  if (matchChanged) Object.assign(update, VALIDATION_RESET_FIELDS)
  batch.update(doc(db, COL, transaction.id), update)

  // 3) reset cascata dos grupos antigo + novo (filtrados por setor do ator)
  for (const m of toReset) {
    batch.update(doc(db, COL, m.id), {
      ...VALIDATION_RESET_FIELDS,
      updatedAt: serverTimestamp(),
    })
  }

  await batch.commit()

  await logActivity({
    action: 'transaction.edit-approve',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    changes: buildChangesDiff(transaction, changes),
  })
}

/**
 * Admin: aplica edicao direto, sem passar por pendingEdit.
 * Mesma logica de reset cascata do approveTransactionEdit, mas opera sobre o `changes`
 * informado em vez de pendingEdit.changes.
 */
export async function applyTransactionEditDirect(
  transaction: Transaction,
  rawChanges: TransactionEditPayload,
  opts: CascadeOptions = {},
): Promise<void> {
  // Sanitização: aplica APENAS campos da whitelist mesmo que o caller mande
  // mais. Sem isso, mudança no fluxo (ex: form admin novo) pode acidentalmente
  // passar algo sensível.
  const changes = sanitizeEditPayload(rawChanges)
  if (Object.keys(changes).length === 0) return
  const matchKeys = ['clientId', 'amount', 'currency', 'transactionDate'] as const
  const matchChanged = matchKeys.some((k) => k in changes)

  let toReset: GroupMember[] = []
  if (matchChanged) {
    // Grupo antigo + grupo novo, mesma motivação do approveTransactionEdit.
    const [oldGroup, newGroup] = await Promise.all([
      fetchGroupMembers(
        transaction.clientId,
        transaction.amount,
        transaction.currency,
        transaction.transactionDate,
        transaction.id,
      ),
      fetchGroupMembers(
        changes.clientId ?? transaction.clientId,
        changes.amount ?? transaction.amount,
        (changes.currency ?? transaction.currency) as Transaction['currency'],
        changes.transactionDate ?? transaction.transactionDate,
        transaction.id,
      ),
    ])
    const seen = new Set<string>()
    const merged: GroupMember[] = []
    for (const m of [...oldGroup, ...newGroup]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(m)
    }
    toReset = filterReachable(merged, opts.actorSetores)
  }

  const fxFields = await buildFxFieldsForEdit(transaction, changes)
  const receiptPatch = await applyReceiptChanges(transaction, changes)

  const fieldChanges: Record<string, unknown> = {}
  for (const k of Object.keys(changes) as (keyof TransactionEditPayload)[]) {
    if (RECEIPT_EDIT_FIELDS.includes(k)) continue
    fieldChanges[k] = changes[k]
  }

  const batch = writeBatch(db)
  const update: Record<string, unknown> = {
    ...fieldChanges,
    ...fxFields,
    ...receiptPatch,
    pendingEdit: deleteField(),
    updatedAt: serverTimestamp(),
  }
  if (matchChanged) Object.assign(update, VALIDATION_RESET_FIELDS)
  batch.update(doc(db, COL, transaction.id), update)

  for (const m of toReset) {
    batch.update(doc(db, COL, m.id), {
      ...VALIDATION_RESET_FIELDS,
      updatedAt: serverTimestamp(),
    })
  }

  await batch.commit()

  await logActivity({
    action: 'transaction.edit-direct',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    changes: buildChangesDiff(transaction, changes),
  })
}

/**
 * Recalcula a conversão pra USD da transação e salva no doc. Útil pra transações
 * onde a cotação falhou na criação (a API estava fora, CORS travou etc.) e o
 * usuário quer puxar a cotação agora. Não toca em nenhum outro campo.
 *
 * Retorna `true` se conseguiu salvar; `false` se a cotação falhou.
 */
export async function recalcUsdConversion(
  transaction: Transaction,
  options: { logManual?: boolean } = {},
): Promise<boolean> {
  if (transaction.currency === 'USD') {
    // USD: identidade: grava os 3 campos pra ficar explícito.
    await updateDoc(doc(db, COL, transaction.id), {
      usdAmount: transaction.amount,
      usdRate: 1,
      usdRateDate: transaction.transactionDate,
      usdConversionPending: deleteField(),
      updatedAt: serverTimestamp(),
    })
    if (options.logManual) {
      await logActivity({
        action: 'transaction.fx-recalc',
        targetType: 'transaction',
        targetId: transaction.id,
        targetLabel: transactionLabel(transaction),
        note: 'cotação USD = 1 (identidade)',
      })
    }
    return true
  }
  const fx = await convertToUsd(transaction.amount, transaction.currency, transaction.transactionDate)
  if (!fx) {
    // Marca pendente (se ainda não estava) pra a UI mostrar o estado e o
    // cron de retry pegar.
    if (!transaction.usdConversionPending) {
      await updateDoc(doc(db, COL, transaction.id), {
        usdConversionPending: true,
        updatedAt: serverTimestamp(),
      })
    }
    return false
  }
  await updateDoc(doc(db, COL, transaction.id), {
    usdAmount: fx.usdAmount,
    usdRate: fx.usdRate,
    usdRateDate: fx.usdRateDate,
    usdConversionPending: deleteField(),
    updatedAt: serverTimestamp(),
  })
  if (options.logManual) {
    await logActivity({
      action: 'transaction.fx-recalc',
      targetType: 'transaction',
      targetId: transaction.id,
      targetLabel: transactionLabel(transaction),
      note: `cotação ${transaction.currency}→USD = ${fx.usdRate.toFixed(4)} (${fx.usdRateDate})`,
    })
  }
  return true
}

/** Admin: rejeita a edicao proposta, mantem os valores atuais. Apaga
 *  imagens "added" do Storage pra não deixar lixo de pending. */
export async function rejectTransactionEdit(transaction: Transaction): Promise<void> {
  await deletePendingAddedReceipts(transaction)
  await updateDoc(doc(db, COL, transaction.id), {
    pendingEdit: deleteField(),
    updatedAt: serverTimestamp(),
  })
  await logActivity({
    action: 'transaction.edit-reject',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
  })
}

/**
 * Marca/desmarca um registro como "pagamento concluído" na tela de Comissões
 * Pendentes: confirma manualmente que o 1% + a ativação ($5) já foram pagos.
 *
 * É só controle operacional: NÃO mexe em validação, comissão ou fechamento.
 * `byName` é gravado pra trilha leve ("marcado por Fulano") na própria linha.
 * Desmarcar limpa os dois campos.
 */
export async function setCommissionSettled(
  transaction: Transaction,
  settled: boolean,
  byName?: string,
): Promise<void> {
  await updateDoc(doc(db, COL, transaction.id), {
    commissionSettledAt: settled ? serverTimestamp() : deleteField(),
    commissionSettledBy: settled ? byName ?? null : deleteField(),
    updatedAt: serverTimestamp(),
  })
  await logActivity({
    action: settled ? 'transaction.commission-settle' : 'transaction.commission-unsettle',
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
  })
}

export async function setConversationValidation(
  transaction: Transaction,
  action: ConversationValidation,
  note?: string,
): Promise<void> {
  await updateDoc(doc(db, COL, transaction.id), {
    conversationValidation: action,
    conversationNote: note ?? null,
    updatedAt: serverTimestamp(),
  })
  const map: Record<ConversationValidation, ActivityAction> = {
    approved: 'transaction.conversation-approve',
    rejected: 'transaction.conversation-reject',
    pending: 'transaction.conversation-pending',
  }
  await logActivity({
    action: map[action],
    targetType: 'transaction',
    targetId: transaction.id,
    targetLabel: transactionLabel(transaction),
    note,
  })
}
