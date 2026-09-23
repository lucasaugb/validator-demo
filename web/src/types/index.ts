import type { Timestamp } from 'firebase/firestore'

export type Role = 'agente' | 'supervisor' | 'admin' | 'super_admin'

/**
 * Helpers de role:
 *  - supervisor: vê transações/fechamento/edições/usuários do PRÓPRIO setor;
 *    edita/exclui transações direto; aprova/rejeita edições; ativa/desativa
 *    agentes do setor. NÃO encerra competência. NÃO cria usuário.
 *  - admin / super_admin: visão global; tudo libre.
 */
export const ADMIN_ROLES: Role[] = ['admin', 'super_admin']
export const SUPERVISOR_OR_ABOVE: Role[] = ['supervisor', 'admin', 'super_admin']

export function isAdminOrAbove(role: Role | undefined): boolean {
  return role === 'admin' || role === 'super_admin'
}

export function isSupervisorOrAbove(role: Role | undefined): boolean {
  return role === 'supervisor' || role === 'admin' || role === 'super_admin'
}

export type Setor =
  | 'premium'
  | 'starter'
  | 'eventos'
  | 'online'
  // Setores VIRTUAIS: exclusivos pra supervisor que cobre DOIS setores.
  // Gestores continuam atribuídos a um setor real individualmente. Quando
  // supervisor.setor é um virtual, o escopo dele engloba ambos os reais pra
  // fins de visualizar/editar transactions e ativar/desativar gestores.
  | 'premium_starter'
  | 'online_eventos'

/** Setores que podem ser atribuídos a GESTORES (sem os virtuais de supervisor). */
export const SETORES: Setor[] = ['premium', 'starter', 'eventos', 'online']

/** Setores que podem ser atribuídos a SUPERVISORES (inclui os virtuais). */
export const SETORES_SUPERVISOR: Setor[] = [
  'premium',
  'starter',
  'eventos',
  'online',
  'premium_starter',
  'online_eventos',
]

/**
 * Métrica de meta/forecast. A estrutura é IDÊNTICA nas duas, muda só a base
 * de cálculo e a formatação:
 *   - 'transacao' → volume validado em USD (soma de `usdAmount`).
 *   - 'ativacao' → nº de ativações validadas (registros com `isActivation`,
 *                  ou seja o PRIMEIRO transação do cliente). Contagem, não $.
 */
export type MetaKind = 'transacao' | 'ativacao'

export const META_KINDS: MetaKind[] = ['transacao', 'ativacao']

/** Rótulo na UI. "Volume" (não "Transação") por causa da nomenclatura unificada. */
export const metaKindLabel: Record<MetaKind, string> = {
  transacao: 'Volume',
  ativacao: 'Ativação',
}

export const setorLabel: Record<Setor, string> = {
  premium: 'Premium',
  starter: 'Starter',
  eventos: 'Eventos',
  online: 'Online',
  premium_starter: 'Premium/Starter',
  online_eventos: 'Online/Eventos',
}

/**
 * Expande o setor (que pode ser virtual) na lista de setores REAIS cobertos.
 * Usado pra filtrar transações/gestores no escopo de quem está logado.
 *
 *   'premium_starter'          → ['premium', 'starter']
 *   'online_eventos' → ['online', 'eventos']
 *   'premium'                 → ['premium']
 *   (etc.)
 */
export function setoresInScope(setor: Setor | undefined | null): Setor[] {
  if (!setor) return []
  if (setor === 'premium_starter') return ['premium', 'starter']
  if (setor === 'online_eventos') return ['online', 'eventos']
  return [setor]
}

export interface Agente {
  uid: string
  email: string
  name: string
  role: Role
  setor?: Setor
  /**
   * ID do membro no Slack (ex: `U07ABC123`). Usado pra mandar o PDF do
   * fechamento de competência via DM. Quando ausente, agente fica fora do
   * envio automático.
   */
  slackUserId?: string
  active: boolean
  /**
   * Quando true, força o usuário a trocar a senha no próximo acesso,
   * gate renderiza a tela `ForcePasswordChange` em vez do dashboard até o
   * usuário definir nova senha. Setado em `createAgente` (qualquer role
   * criada pelo form recebe), limpo quando o próprio usuário roda
   * `changeMyPasswordAndClearFlag`. Doc legado (criado antes da feature)
   * fica sem o campo e cai no fluxo normal.
   */
  mustChangePassword?: boolean
  /**
   * Quando true, o usuário pode DEFINIR/ALTERAR metas (geral, por time e por
   * colaborador) na tela `/admin/metas`. Concedido só pelo super_admin (UI +
   * firestore.rules gateiam). É uma capability independente do papel: um admin
   * (ex.: Gerente operacional) recebe a flag; outro admin de mesmo papel não.
   * Doc sem o campo = false (não edita metas).
   */
  canEditMetas?: boolean
  createdAt: Timestamp
  /**
   * Carimbo do último login do usuário, atualizado pelo AuthContext com
   * throttle de ~10min. Pode ser undefined em docs antigos.
   */
  lastLoginAt?: Timestamp
  /**
   * URL pública da foto de perfil no Firebase Storage. Quando ausente, a UI
   * cai no fallback de iniciais coloridas.
   */
  avatarUrl?: string
}

export type Currency = 'USD' | 'EUR' | 'GBP'

export const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP']

export type SystemValidation = 'pending' | 'verified' | 'invalid' | 'duplicate'
export type ConversationValidation = 'pending' | 'approved' | 'rejected'

export interface ValidationChecks {
  id_check?: boolean
  value_check?: boolean
  currency_check?: boolean
  date_check?: boolean
  same_row_check?: boolean
  duplicate_check?: boolean
}

/**
 * Quando o sistema acha uma transação no source com >=2 campos batendo (mas não
 * todos os 4), expõe aqui qual transação foi e quais campos falharam. Permite a
 * UI mostrar "encontrei uma tx com valor=950, mas você preencheu 1000".
 */
export interface BestCandidate {
  sourceTransactionId: string
  matchCount: number
  loginMatch: boolean
  amountMatch: boolean
  currencyMatch: boolean
  dateMatch: boolean
  // Valores que o source tem (pra comparar com o que o agente preencheu)
  sourceAmount?: number
  sourceCurrency?: string
  sourceDate?: string
}

export interface DuplicateAlertAgenteInfo {
  uid: string
  name?: string
  setor?: Setor
}

export interface DuplicateAlert {
  crossAgent: boolean
  agentes: string[]
  linkedTransactionIds?: string[]
  linkedTransactionNumbers?: number[]
  /**
   * Setores únicos envolvidos no grupo de duplicação (inclui o setor do
   * própria transação). Populado pelo backend quando detecta duplicate
   * cross-setor; supervisor usa pra mostrar "duplicando com setor X" mesmo
   * sem ler os docs do outro setor. Opcional, docs antigos não têm.
   */
  setores?: Setor[]
  /**
   * Info detalhada de cada gestor do grupo: uid + nome + setor. Permite a UI
   * mostrar "Lucas (Premium), João (Starter)" mesmo quando o supervisor não tem
   * acesso ao doc do outro setor. Populado pelo backend ao escrever o
   * duplicateAlert; ausente em docs antigos.
   */
  agentesInfo?: DuplicateAlertAgenteInfo[]
}

/**
 * Devolve um label legível pra quantidade de transações num grupo de
 * duplicação. `count` é o total no grupo (incluindo o próprio).
 *   2 → "Duplicado"
 *   3 → "Triplicado"
 *   4 → "Quadruplicado"
 *   5 → "Quintuplicado"
 *   ≥6 → "Replicado Nx"
 */
export function replicationLabel(count: number): string {
  if (count <= 1) return 'Único'
  if (count === 2) return 'Duplicado'
  if (count === 3) return 'Triplicado'
  if (count === 4) return 'Quadruplicado'
  if (count === 5) return 'Quintuplicado'
  return `Replicado ${count}x`
}

/**
 * Total de transações no grupo de duplicação (próprio + linked). Usado pra
 * decidir o label de replicationLabel.
 */
export function replicationCount(transaction: Pick<Transaction, 'duplicateAlert'>): number {
  const linked = transaction.duplicateAlert?.linkedTransactionIds?.length ?? 0
  // +1 pra incluir o própria transação
  return linked + 1
}

export interface PendingEdit {
  submittedAt: Timestamp
  submittedBy: string
  changes: Partial<{
    clientName: string
    clientEmail: string
    clientPhone: string
    clientId: string
    currency: Currency
    amount: number
    transactionDate: string
    /**
     * Imagens propostas pelo gestor pra adicionar à transação. URLs já estão
     * em Storage (path provisório `transactions/<id>/pending/...`). Admin aprova
     * → URLs viram parte do array principal; rejeita → URLs são deletadas.
     */
    addedTransactionReceipts: string[]
    removedTransactionReceipts: string[]
    addedConversationReceipts: string[]
    removedConversationReceipts: string[]
  }>
}

export interface Transaction {
  id: string
  transactionNumber?: number
  agenteId: string
  agenteName: string
  agenteSetor?: Setor
  clientName: string
  clientEmail: string
  clientPhone: string
  clientId: string
  currency: Currency
  amount: number
  /**
   * Campos legados: não são mais coletados no registro nem na edição
   * (decidido 2026-05-14). Mantidos como opcionais no tipo pra ler transações
   * antigos sem quebrar. Não mostrar na UI nem usar em métricas novas.
   */
  balance?: number
  bonus?: number
  netCapital?: number
  transactionDate: string
  transactionReceiptUrls: string[]
  conversationReceiptUrls: string[]

  systemValidation: SystemValidation
  conversationValidation: ConversationValidation
  isActivation: boolean
  conversationNote?: string

  validationChecks?: ValidationChecks
  matchedTransactionId?: string
  bestCandidate?: BestCandidate
  duplicateAlert?: DuplicateAlert
  pendingEdit?: PendingEdit
  /**
   * Contador cumulativo de pedidos de edição feitos pelo gestor nesta transação.
   * Incrementa em `requestTransactionEdit`, NÃO decrementa em reject/approve, é
   * histórico, não pendente. Quando >= 3, sobe alerta pra admin/supervisor
   * (notificação no bell + badge na tela de Edições). Doc legado sem o campo
   * é tratado como 0.
   */
  editRequestCount?: number

  /**
   * Última data conhecida de operação do cliente no sistema de origem, `MAX(last_operation_date)`
   * em `origem.source_transactions` filtrado pela `login` (==clientId).
   *
   * - String ISO yyyy-mm-dd quando o cliente já operou
   * - `null` explícito quando o cliente nunca operou (mas tem registro na source)
   * - `undefined` quando ainda não foi consultado (transaction pré-feature ou pending)
   *
   * Usado pra elegibilidade do bônus de 1% em ativações.
   */
  lastOperationDate?: string | null

  /**
   * País do cliente vindo DIRETO do sistema de origem (`country` em
   * `origem.source_transactions`), como código ISO-2 (ex.: "BR", "PT").
   *
   * Gravado pela validação quando a transação casa com uma transação da source
   * (`matchedTransactionId`). Substitui a inferência por DDI do telefone na
   * distribuição geográfica: o DDI continua só como fallback pra transações
   * ainda não casados (pending) ou sem `country` na source.
   *
   * `undefined` em transações pré-feature ou que nunca casaram.
   */
  sourceCountry?: string

  /**
   * Parceria (código do parceiro de indicação) do cliente vindo do sistema de origem, coluna `PartnerCode`
   * em `origem.source_transactions`, normalizado pra string (ex.: "90001") ou
   * `null` quando o cliente veio orgânico (sem parceria).
   *
   * Gravado pela validação junto com `sourceCountry`. É PURAMENTE VISUAL,
   * usado só pra sinalizar "Dentro da parceria / Em outra parceria / Sem parceria" pra
   * admin/super_admin. NÃO participa de validação, ativação ou comissão.
   *
   * - string → tem parceria com esse id
   * - `null` → casou mas não tem parceria (orgânico)
   * - `undefined` → não consultado (pré-feature ou ainda não verificado)
   */
  sourcePartnerCode?: string | null

  /**
   * Classificação do cliente no CRM (Pipedrive), espelhado no BigQuery em
   * `crm-demo-project.Pipedrive_gcf.deals_all_primary`. Batemos `clientEmail` OU
   * `clientPhone` contra `person_email`/`person_phone`; havendo duplicidade,
   * vence o deal de `add_time` mais recente. A coluna `subconta` define:
   * `PRM` → 'premium' (produto mais caro), `STR` → 'starter' (entrada mais barata).
   *
   * - 'premium' | 'starter' → achou no CRM
   * - 'nao_encontrado'   → consultou e não achou (nem por email nem telefone)
   * - `undefined`        → ainda não classificado (doc pré-feature / sem acesso ao CRM)
   *
   * PURAMENTE INFORMATIVO no Passo 1: só exibe uma tag no registro. A nova
   * regra de comissão (Passo 2) vai consumir esse campo.
   */
  pipedriveTribe?: 'premium' | 'starter' | 'nao_encontrado'
  /** Como o match no CRM aconteceu, 'email' ou 'phone'. Ausente quando não achou. */
  pipedriveMatchedBy?: 'email' | 'phone'
  /** `add_time` (ISO) do deal casado no CRM, data em que o cliente comprou. Ausente quando não achou. */
  pipedriveDealAddTime?: string
  /**
   * Etapa do cliente no funil do Pipedrive, coluna `stage_name` (ex.:
   * "Bloqueado", "Cancelado", "Contrato Ok", "Suporte Ok"). Quando `stage_name`
   * está vazia no CRM, cai pra `origem` (ex.: "Primary", "Backup"). Ausente
   * quando não achou no CRM.
   */
  pipedriveStage?: string
  /**
   * Chave interna (`emailNormalizado|sufixoTelefone`) usada pelo backend pra
   * detectar quando reclassificar (email/telefone mudou). Não usar na UI.
   */
  pipedriveKey?: string

  /**
   * Conversão pra USD com a cotação comercial do dia da transação.
   *
   * - `usdAmount`: valor já convertido (amount × usdRate). Em USD-USD é igual a `amount`.
   * - `usdRate`: taxa usada (1 unidade da moeda original = `usdRate` USD).
   * - `usdRateDate`: data efetiva da cotação retornada pela API (último dia útil
   *   se a transação caiu em fim de semana/feriado).
   *
   * Todos opcionais: transações antigas (pré-feature) não têm. Quando ausente
   * em transação não-USD, a UI mostra "conversão pendente" e a comissão cai
   * pro valor face-value como fallback.
   */
  usdAmount?: number
  usdRate?: number
  usdRateDate?: string
  /**
   * Sinaliza que a conversão pra USD falhou (API frankfurter fora) e o
   * cálculo de comissão deve cair em fallback face-value até que retry tenha
   * sucesso. Ficar `true` aqui é considerado "estado degradado" e BLOQUEIA
   * o encerramento de competência (igual `pending_operation`).
   */
  usdConversionPending?: boolean

  /**
   * Quando `true`, a UI do Gestor mostra `clientId` com máscara visual
   * `#{id}{1ª letra do nome}{seq}{2ª letra do nome}` (ex.: cliente Rafael
   * com id 1234 vira `#1234R1A`). Só visual, o `clientId` no banco continua
   * sendo a string crua usada pela validação automática.
   *
   * Setado em todos os transactions CRIADOS a partir de 2026-05-20. Docs antigos
   * ficam sem o campo e a UI do gestor cai no fallback `#{clientId}`.
   * Supervisor/admin/super_admin sempre veem o `clientId` cru.
   */
  agentMaskedIdEnabled?: boolean

  /**
   * Carimbo de quando o doc foi criado VIA importador de planilha (decisão
   * 2026-05-20). Usado pra:
   *  - Chip "importado" na lista do gestor por 30 dias (lembrete pra anexar
   *    comprovante).
   *  - Banner "X registros sem comprovante" na Visão Geral.
   * Docs criados manualmente pelo form OU antigos não têm o campo.
   */
  importedAt?: Timestamp

  /**
   * Marcação MANUAL de "pagamento concluído" na tela Comissões Pendentes,
   * o admin/supervisor confirma que o 1% + a ativação ($5) daquele registro
   * já foram pagos. Apenas controle visual/operacional (não interfere no
   * cálculo de comissão nem no fechamento). Quando setado, a linha aparece
   * riscada e cai no filtro "Concluídos".
   */
  commissionSettledAt?: Timestamp
  /** Nome de quem marcou como concluído (audit trail leve na própria linha). */
  commissionSettledBy?: string

  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface TransactionInput {
  clientName: string
  clientEmail: string
  clientPhone: string
  clientId: string
  currency: Currency
  amount: number
  transactionDate: string
  transactionReceipts: File[]
  conversationReceipts: File[]
}

export type FinalStatus = 'pending' | 'validated' | 'rejected'

export function finalStatus(d: Pick<Transaction, 'systemValidation' | 'conversationValidation'>): FinalStatus {
  if (
    d.systemValidation === 'invalid' ||
    d.systemValidation === 'duplicate' ||
    d.conversationValidation === 'rejected'
  ) return 'rejected'
  if (d.systemValidation === 'verified' && d.conversationValidation === 'approved') return 'validated'
  return 'pending'
}

// Visão do agente (revisão 2026-05-18):
//  - `validated`: ambos sistema=verified + conversa=approved.
//  - `rejected`: pelo menos um dos dois deu veredicto negativo
//    (sistema invalid/duplicate ou conversa rejected). Nesse caso já entrega
//    o resultado pro gestor: o outro lado não pode mais salvar.
//  - `pending`: nenhum lado deu negativo ainda e algum ainda está pending.
//
// Antes essa função escondia rejected como pending pra evitar gaming, mas
// virou ruído operacional: agente esperava decisão que já saiu. Agora bate
// 1:1 com `finalStatus`.
export type AgenteVisibleStatus = FinalStatus

export const finalStatusForAgent = finalStatus

/**
 * Detalha o motivo de rejeição visível pro gestor, usado pra montar a UI
 * "por que foi reprovado". Quando o status final NÃO é rejected, retorna
 * null. Inclui a observação do admin sempre que houver, mesmo se a conversa
 * tiver sido aprovada (caso comum: sistema invalidou por valor errado mas o
 * supervisor aprovou a conversa e deixou uma observação pro gestor).
 */
export interface AgentRejectionReason {
  systemReason?: 'invalid' | 'duplicate'
  conversationRejected?: boolean
  conversationNote?: string
}

export function rejectionReasonForAgent(
  d: Pick<Transaction, 'systemValidation' | 'conversationValidation' | 'conversationNote'>,
): AgentRejectionReason | null {
  if (finalStatus(d) !== 'rejected') return null
  const out: AgentRejectionReason = {}
  if (d.systemValidation === 'invalid') out.systemReason = 'invalid'
  else if (d.systemValidation === 'duplicate') out.systemReason = 'duplicate'
  if (d.conversationValidation === 'rejected') out.conversationRejected = true
  // Observação do admin agora vale pro gestor em qualquer rejeição, não só
  // quando a conversa rejeitou. Quando o registro está validado, a nota fica
  // oculta da linha (só aparece se o gestor abrir o registro).
  if (d.conversationNote) out.conversationNote = d.conversationNote
  return out
}

/**
 * Constrói um Map<id, displayString> com a ID mascarada que o GESTOR vê.
 *
 * Regra (decisão 2026-05-20):
 *   `#{clientId}{1ª letra do nome}{seq}{2ª letra do nome}`
 *
 * Onde `seq` é a posição cronológica desta transação entre os do MESMO gestor
 * pra MESMO `clientId`, contando só os que têm `agentMaskedIdEnabled=true`
 * (i.e., os criados a partir desta feature). Transações legados (sem a flag)
 * NÃO entram no count e ficam com o fallback `#{clientId}` original.
 *
 * Recebe a lista COMPLETA de transactions do gestor pra que a seq seja estável
 * mesmo quando a UI tá filtrada por mês/moeda.
 */
export function buildAgentMaskedIdMap(
  allAgentTransactions: Pick<
    Transaction,
    'id' | 'clientId' | 'clientName' | 'agentMaskedIdEnabled' | 'createdAt'
  >[],
): Map<string, string> {
  const out = new Map<string, string>()

  // Agrupa por clientId, apenas os com flag ligada.
  const byClient = new Map<string, typeof allAgentTransactions>()
  for (const d of allAgentTransactions) {
    if (!d.agentMaskedIdEnabled) continue
    const arr = byClient.get(d.clientId) ?? []
    arr.push(d)
    byClient.set(d.clientId, arr)
  }

  for (const [clientId, group] of byClient) {
    // ordenado por createdAt asc (mais antigo = seq 1). Quando o servidor
    // ainda não carimbou o timestamp (criação otimista), usa Number.MAX como
    // tiebreaker pra empurrar pro final: sem ficar "1" temporariamente.
    const sorted = [...group].sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
      const tb = b.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
      if (ta !== tb) return ta - tb
      return a.id.localeCompare(b.id)
    })
    sorted.forEach((d, idx) => {
      const name = (d.clientName || '').trim()
      const first = (name[0] || '?').toUpperCase()
      const second = (name[1] || '?').toUpperCase()
      const seq = idx + 1
      out.set(d.id, `#${clientId}${first}${seq}${second}`)
    })
    void clientId
  }
  return out
}

/**
 * Helper de UI: dado um transaction + map, devolve a string que o gestor deve
 * ver na coluna "Identificação". Cai no `#{clientId}` quando a flag não tá
 * ligada (transaction antigo / supervisor view).
 */
export function getAgentDisplayId(
  d: Pick<Transaction, 'id' | 'clientId' | 'agentMaskedIdEnabled'>,
  map: Map<string, string> | undefined,
): string {
  if (d.agentMaskedIdEnabled && map?.has(d.id)) {
    return map.get(d.id)!
  }
  return `#${d.clientId}`
}
