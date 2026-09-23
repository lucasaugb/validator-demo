/**
 * Gera a base FICTÍCIA do demo. Determinística (PRNG com semente fixa), mas
 * ancorada na data de hoje: o demo sempre parece "vivo", com registros até
 * o dia atual. Nenhum dado aqui é real.
 */
import { Timestamp, type DemoUser, type DocData } from './store'

export const DEMO_PASSWORD = 'demo123'

/* --------------------------------- PRNG -------------------------------- */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260923)
const chance = (p: number) => rand() < p
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))

function weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [v, w] of items) {
    r -= w
    if (r <= 0) return v
  }
  return items[items.length - 1][0]
}

/* ------------------------------- Datas --------------------------------- */

const DAY = 86_400_000
const HISTORY_DAYS = 150

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

/* ------------------------------ Pessoas -------------------------------- */

type Role = 'agente' | 'supervisor' | 'admin' | 'super_admin'
type Setor = 'premium' | 'starter' | 'online' | 'eventos' | 'premium_starter' | 'online_eventos'

interface SeedUser {
  uid: string
  name: string
  email: string
  role: Role
  setor?: Setor
  active?: boolean
  canEditMetas?: boolean
  slack?: boolean
  /** Registros por dia útil (só gestores). */
  rate?: number
  /** Escala do ticket médio (só gestores). */
  ticket?: number
}

const USERS: SeedUser[] = [
  { uid: 'u_admin', name: 'Marina Costa', email: 'admin@validator.demo', role: 'super_admin', canEditMetas: true, slack: true },
  { uid: 'u_ops', name: 'Rafael Lima', email: 'rafael.lima@validator.demo', role: 'admin', canEditMetas: true, slack: true },
  { uid: 'u_sup1', name: 'Carla Mendes', email: 'supervisor@validator.demo', role: 'supervisor', setor: 'premium_starter', slack: true },
  { uid: 'u_sup2', name: 'Diego Rocha', email: 'diego.rocha@validator.demo', role: 'supervisor', setor: 'online_eventos', slack: true },
  { uid: 'u_g01', name: 'Lucas Ferreira', email: 'gestor@validator.demo', role: 'agente', setor: 'premium', slack: true, rate: 3.6, ticket: 1.25 },
  { uid: 'u_g02', name: 'Beatriz Alves', email: 'beatriz.alves@validator.demo', role: 'agente', setor: 'premium', slack: true, rate: 3.2, ticket: 1.35 },
  { uid: 'u_g03', name: 'Thiago Nunes', email: 'thiago.nunes@validator.demo', role: 'agente', setor: 'premium', slack: false, rate: 2.7, ticket: 1.15 },
  { uid: 'u_g04', name: 'Juliana Prado', email: 'juliana.prado@validator.demo', role: 'agente', setor: 'starter', slack: true, rate: 2.2, ticket: 0.7 },
  { uid: 'u_g05', name: 'Pedro Martins', email: 'pedro.martins@validator.demo', role: 'agente', setor: 'starter', slack: true, rate: 1.9, ticket: 0.65 },
  { uid: 'u_g06', name: 'Camila Ribeiro', email: 'camila.ribeiro@validator.demo', role: 'agente', setor: 'starter', slack: true, rate: 1.7, ticket: 0.75 },
  { uid: 'u_g07', name: 'Gustavo Reis', email: 'gustavo.reis@validator.demo', role: 'agente', setor: 'online', slack: true, rate: 0.3, ticket: 0.45 },
  { uid: 'u_g08', name: 'Larissa Duarte', email: 'larissa.duarte@validator.demo', role: 'agente', setor: 'online', slack: false, rate: 0.25, ticket: 0.4 },
  { uid: 'u_g09', name: 'Felipe Moraes', email: 'felipe.moraes@validator.demo', role: 'agente', setor: 'eventos', slack: true, rate: 0.3, ticket: 0.45 },
  { uid: 'u_g10', name: 'Isabela Castro', email: 'isabela.castro@validator.demo', role: 'agente', setor: 'eventos', slack: true, rate: 0.25, ticket: 0.5 },
  { uid: 'u_g11', name: 'Rodrigo Teixeira', email: 'rodrigo.teixeira@validator.demo', role: 'agente', setor: 'starter', active: false, slack: false },
]

const FIRST = [
  'Ana', 'Bruno', 'Carlos', 'Daniela', 'Eduardo', 'Fernanda', 'Gabriel', 'Helena', 'Igor', 'Jéssica',
  'Kaio', 'Letícia', 'Marcelo', 'Natália', 'Otávio', 'Paula', 'Renato', 'Sabrina', 'Tiago', 'Vanessa',
  'Wagner', 'Yasmin', 'André', 'Bianca', 'César', 'Débora', 'Elias', 'Flávia', 'Heitor', 'Joana',
  'Leandro', 'Mônica', 'Nelson', 'Priscila', 'Ricardo', 'Simone', 'Vinícius', 'Alice', 'Mateus', 'Luana',
]
const LAST = [
  'Silva', 'Souza', 'Oliveira', 'Pereira', 'Almeida', 'Carvalho', 'Gomes', 'Barbosa', 'Rocha', 'Dias',
  'Moreira', 'Cardoso', 'Araújo', 'Teixeira', 'Correia', 'Pinto', 'Vieira', 'Freitas', 'Lopes', 'Monteiro',
  'Batista', 'Farias', 'Campos', 'Rezende', 'Machado', 'Azevedo', 'Bezerra', 'Cunha', 'Fonseca', 'Siqueira',
]

const COUNTRIES: ReadonlyArray<readonly [{ code: string; dial: string }, number]> = [
  [{ code: 'BR', dial: '55' }, 70],
  [{ code: 'PT', dial: '351' }, 9],
  [{ code: 'US', dial: '1' }, 5],
  [{ code: 'AR', dial: '54' }, 4],
  [{ code: 'MX', dial: '52' }, 4],
  [{ code: 'CO', dial: '57' }, 3],
  [{ code: 'CL', dial: '56' }, 2],
  [{ code: 'ES', dial: '34' }, 2],
  [{ code: 'AO', dial: '244' }, 1],
]

interface Client {
  name: string
  email: string
  phone: string
  clientId: string
  country: string
  tribe: 'premium' | 'starter' | 'nao_encontrado'
  dealAddTime: string
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const usedIds = new Set<string>()
function newClientId(): string {
  // Último dígito nunca é 0: no demo, conta terminada em 0 simula divergência
  // no validador (ver mock/validator.ts).
  for (;;) {
    const id = String(int(10000, 99999)) + String(int(1, 9))
    if (!usedIds.has(id)) {
      usedIds.add(id)
      return id
    }
  }
}

function newClient(setor: Setor, today: string): Client {
  const first = pick(FIRST)
  const last = pick(LAST)
  const country = weighted(COUNTRIES)
  const local =
    country.code === 'BR'
      ? `${int(11, 99)}9${int(1000, 9999)}${int(1000, 9999)}`
      : `${int(100, 999)}${int(100, 999)}${int(100, 999)}`
  const tribe: Client['tribe'] =
    setor === 'premium'
      ? weighted([['premium', 75], ['starter', 10], ['nao_encontrado', 15]] as const)
      : setor === 'starter'
        ? weighted([['starter', 75], ['premium', 8], ['nao_encontrado', 17]] as const)
        : weighted([['nao_encontrado', 60], ['starter', 25], ['premium', 15]] as const)
  const domain = pick(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'])
  return {
    name: `${first} ${last}`,
    email: `${stripAccents(first).toLowerCase()}.${stripAccents(last).toLowerCase()}${int(1, 99)}@${domain}`,
    phone: `+${country.dial}${local}`,
    clientId: newClientId(),
    country: country.code,
    tribe,
    dealAddTime: addDaysIso(today, -int(20, 400)) + 'T14:00:00Z',
  }
}

/* ----------------------------- Comprovantes ---------------------------- */

function svgDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const RECEIPT_URL = svgDataUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
  <rect width="360" height="520" fill="#f8fafc"/><rect x="20" y="20" width="320" height="480" rx="12" fill="#fff" stroke="#e2e8f0"/>
  <text x="180" y="70" text-anchor="middle" font-family="Arial" font-size="18" font-weight="bold" fill="#0f172a">COMPROVANTE</text>
  <text x="180" y="95" text-anchor="middle" font-family="Arial" font-size="12" fill="#64748b">Transferência internacional</text>
  <line x1="40" y1="120" x2="320" y2="120" stroke="#e2e8f0"/>
  ${[150, 190, 230, 270, 310].map((y) => `<rect x="40" y="${y}" width="${int(120, 260)}" height="10" rx="5" fill="#e2e8f0"/>`).join('')}
  <rect x="40" y="360" width="280" height="60" rx="8" fill="#ecfdf5"/>
  <text x="180" y="397" text-anchor="middle" font-family="Arial" font-size="14" fill="#047857">Pagamento concluído</text>
  <text x="180" y="470" text-anchor="middle" font-family="Arial" font-size="11" fill="#94a3b8">IMAGEM FICTÍCIA · DEMO</text></svg>`,
)

const CHAT_URL = svgDataUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
  <rect width="360" height="520" fill="#e5ddd5"/><rect width="360" height="56" fill="#075e54"/>
  <text x="20" y="35" font-family="Arial" font-size="16" fill="#fff">Cliente</text>
  <rect x="20" y="80" width="220" height="44" rx="10" fill="#fff"/><rect x="120" y="140" width="220" height="44" rx="10" fill="#dcf8c6"/>
  <rect x="20" y="200" width="180" height="44" rx="10" fill="#fff"/><rect x="140" y="260" width="200" height="60" rx="10" fill="#dcf8c6"/>
  <rect x="20" y="340" width="240" height="44" rx="10" fill="#fff"/>
  <text x="180" y="490" text-anchor="middle" font-family="Arial" font-size="11" fill="#667">CONVERSA FICTÍCIA · DEMO</text></svg>`,
)

/* ------------------------------- Valores ------------------------------- */

const AMOUNTS: ReadonlyArray<readonly [number, number]> = [
  [100, 8], [200, 10], [250, 8], [300, 9], [500, 14], [750, 5], [1000, 13],
  [1500, 8], [2000, 8], [2500, 4], [3000, 5], [5000, 5], [7500, 1.5], [10000, 1.5],
]

const FX = { USD: 1, EUR: 1.09, GBP: 1.27 } as const

const REJECT_NOTES = [
  'Conversa não comprova o registro: cliente cita outro valor.',
  'Print da conversa é de outro cliente.',
  'Registro feito por outro gestor antes; conversa não mostra a indicação.',
]

const INVALID_NOTES = [
  'Valor informado difere da transação encontrada. Conferir comprovante.',
  'Data do registro fora da janela da transação.',
]

/* -------------------------------- Seed --------------------------------- */

export interface Seed {
  docs: Record<string, DocData>
  users: DemoUser[]
}

export function buildSeed(): Seed {
  const now = new Date()
  const today = isoDate(now)
  const docs: Record<string, DocData> = {}
  const createdAt = Timestamp.fromMillis(now.getTime() - 220 * DAY)

  /* -------- agentes -------- */
  for (const u of USERS) {
    const data: DocData = {
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active ?? true,
      createdAt,
      lastLoginAt: Timestamp.fromMillis(now.getTime() - int(1, 72) * 3_600_000),
    }
    if (u.setor) data.setor = u.setor
    if (u.canEditMetas) data.canEditMetas = true
    if (u.slack) data.slackUserId = 'UDEMO' + u.uid.replace(/\W/g, '').toUpperCase()
    docs[`agentes/${u.uid}`] = data
  }

  /* -------- transactions -------- */
  type Row = DocData & { _client: Client; _ms: number }
  const rows: Row[] = []
  const gestores = USERS.filter((u) => u.role === 'agente' && u.rate)
  const pools = new Map<string, Client[]>()

  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const day = new Date(now.getTime() - back * DAY)
    const dow = day.getDay()
    const dayFactor = dow === 0 ? 0.08 : dow === 6 ? 0.3 : 1
    // Crescimento leve ao longo do tempo (o time "melhora" mês a mês).
    const growth = 0.8 + 0.35 * ((HISTORY_DAYS - back) / HISTORY_DAYS)
    const dateIso = isoDate(day)

    for (const g of gestores) {
      const pool = pools.get(g.uid) ?? []
      pools.set(g.uid, pool)
      const expected = g.rate! * dayFactor * growth
      let n = Math.floor(expected)
      if (chance(expected - n)) n++
      for (let i = 0; i < n; i++) {
        const client = pool.length > 3 && chance(0.38) ? pick(pool) : newClient(g.setor!, today)
        if (!pool.includes(client)) pool.push(client)
        const currency = weighted([['USD', 85], ['EUR', 10], ['GBP', 5]] as const)
        const base = weighted(AMOUNTS)
        const amount = Math.max(50, Math.round((base * g.ticket!) / 50) * 50)
        const hour = int(9, 20)
        let ms = new Date(`${dateIso}T${String(hour).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00`).getTime()
        if (chance(0.12) && back > 0) ms += DAY // registrado no dia seguinte
        if (ms > now.getTime()) ms = now.getTime() - int(5, 120) * 60_000
        rows.push({
          _client: client,
          _ms: ms,
          agenteId: g.uid,
          agenteName: g.name,
          agenteSetor: g.setor,
          clientName: client.name,
          clientEmail: client.email,
          clientPhone: client.phone,
          clientId: client.clientId,
          currency,
          amount,
          transactionDate: dateIso,
        })
      }
    }
  }

  rows.sort((a, b) => a._ms - b._ms)

  /* -------- status, ativação, enriquecimento -------- */
  const activatedClients = new Set<string>()
  let counter = 0

  const finalize = (r: Row, id: string): DocData => {
    const { _client: c, _ms: ms, ...rest } = r
    const ageDays = Math.floor((now.getTime() - ms) / DAY)
    const rate = FX[r.currency as keyof typeof FX]
    const fxJitter = r.currency === 'USD' ? 1 : 1 + (rand() - 0.5) * 0.02
    const usdRate = Math.round(rate * fxJitter * 10000) / 10000
    counter++

    const d: DocData = {
      ...rest,
      transactionNumber: counter,
      transactionReceiptUrls: [RECEIPT_URL],
      conversationReceiptUrls: [CHAT_URL],
      isActivation: false,
      agentMaskedIdEnabled: true,
      usdAmount: Math.round(Number(r.amount) * usdRate * 100) / 100,
      usdRate,
      usdRateDate: r.transactionDate,
      createdAt: Timestamp.fromMillis(ms),
      updatedAt: Timestamp.fromMillis(Math.min(now.getTime(), ms + int(1, 30) * 3_600_000)),
    }

    // Status do sistema conforme a "idade" do registro.
    let sys: string
    if (ageDays === 0) sys = chance(0.55) ? 'pending' : 'verified'
    else if (ageDays <= 2) sys = chance(0.12) ? 'pending' : chance(0.08) ? 'invalid' : 'verified'
    else sys = chance(0.085) ? 'invalid' : 'verified'
    d.systemValidation = sys

    let conv: string
    if (sys === 'pending') conv = 'pending'
    else if (sys === 'invalid') conv = weighted([['approved', 45], ['pending', 30], ['rejected', 25]] as const)
    else if (ageDays <= 1) conv = chance(0.5) ? 'pending' : 'approved'
    else conv = weighted([['approved', 96], ['rejected', 1.5], ['pending', 2.5]] as const)
    // Registros antigos já tiveram a conversa revisada.
    if (conv === 'pending' && ageDays > 20) conv = sys === 'invalid' ? 'rejected' : 'approved'
    d.conversationValidation = conv
    if (conv === 'rejected' && (ageDays < 30 || chance(0.3))) d.conversationNote = pick(REJECT_NOTES)

    const txId = 'TX' + String(100000000 + counter * 7919)
    if (sys === 'verified') {
      d.validationChecks = {
        id_check: true, value_check: true, currency_check: true,
        date_check: true, same_row_check: true, duplicate_check: true,
      }
      d.matchedTransactionId = txId
      d.sourceCountry = c.country
      d.sourcePartnerCode = weighted([['90001', 85], ['90002', 7], ['71234', 5], [null, 3]] as const)
      if (!activatedClients.has(c.clientId)) {
        activatedClients.add(c.clientId)
        d.isActivation = true
      }
      // null = cliente ainda não operou; data = primeira/última operação.
      const opDate = addDaysIso(String(r.transactionDate), int(0, 9))
      d.lastOperationDate = d.isActivation && chance(0.14) ? null : opDate <= today ? opDate : null
    } else if (sys === 'invalid') {
      const amountOff = chance(0.7)
      d.validationChecks = {
        id_check: true, value_check: !amountOff, currency_check: true,
        date_check: amountOff, same_row_check: false, duplicate_check: true,
      }
      d.bestCandidate = {
        sourceTransactionId: txId,
        matchCount: 3,
        loginMatch: true,
        amountMatch: !amountOff,
        currencyMatch: true,
        dateMatch: amountOff,
        sourceAmount: amountOff ? Math.round(Number(r.amount) * pick([0.5, 0.8, 0.9, 1.1])) : r.amount,
        sourceCurrency: r.currency,
        sourceDate: amountOff ? r.transactionDate : addDaysIso(String(r.transactionDate), -int(3, 12)),
      }
      if (conv !== 'rejected' && ageDays < 20 && chance(0.15)) d.conversationNote = pick(INVALID_NOTES)
    }

    if (sys !== 'pending') {
      d.pipedriveTribe = c.tribe
      if (c.tribe !== 'nao_encontrado') {
        d.pipedriveMatchedBy = chance(0.8) ? 'email' : 'phone'
        d.pipedriveDealAddTime = c.dealAddTime
        d.pipedriveStage = weighted([['Contrato Ok', 50], ['Suporte Ok', 30], ['Primary', 12], ['Cancelado', 5], ['Bloqueado', 3]] as const)
      }
    }

    // Comissões de meses anteriores já marcadas como pagas.
    const depMonth = String(r.transactionDate).slice(0, 7)
    if (d.isActivation && depMonth < today.slice(0, 7) && chance(0.7)) {
      d.commissionSettledAt = Timestamp.fromMillis(ms + int(20, 35) * DAY)
      d.commissionSettledBy = 'Rafael Lima'
    }

    docs[`transactions/${id}`] = d
    return d
  }

  const ids: string[] = []
  rows.forEach((r, i) => {
    const id = 'trx' + String(i + 1).padStart(5, '0')
    ids.push(id)
    finalize(r, id)
  })

  /* -------- duplicados (mesma transação registrada por 2 gestores) -------- */
  const dupCandidates = ids.filter((id) => {
    const d = docs[`transactions/${id}`]
    return d.systemValidation === 'verified' && !d.isActivation
  })
  for (let k = 0; k < 14; k++) {
    const origId = pick(dupCandidates)
    const orig = docs[`transactions/${origId}`]
    if (orig.systemValidation !== 'verified') continue
    const sameSetor = gestores.filter((g) => g.setor === orig.agenteSetor && g.uid !== orig.agenteId)
    const other = chance(0.7) && sameSetor.length ? pick(sameSetor) : pick(gestores.filter((g) => g.uid !== orig.agenteId))
    const origMs = (orig.createdAt as Timestamp).toMillis()
    const copyMs = Math.min(now.getTime() - 60_000, origMs + int(1, 30) * 3_600_000)
    const copyId = `trx_dup${k}`
    counter++
    const copy: DocData = {
      ...orig,
      agenteId: other.uid,
      agenteName: other.name,
      agenteSetor: other.setor,
      transactionNumber: counter,
      createdAt: Timestamp.fromMillis(copyMs),
      updatedAt: Timestamp.fromMillis(copyMs),
      isActivation: false,
    }
    const crossAgent = true
    const agentesInfo = [
      { uid: orig.agenteId, name: orig.agenteName, setor: orig.agenteSetor },
      { uid: other.uid, name: other.name, setor: other.setor },
    ]
    const setores = [...new Set([orig.agenteSetor, other.setor])]
    for (const [self, selfId, linkedId, linkedNum] of [
      [orig, origId, copyId, copy.transactionNumber],
      [copy, copyId, origId, orig.transactionNumber],
    ] as const) {
      self.systemValidation = 'duplicate'
      self.validationChecks = { ...(self.validationChecks as DocData), duplicate_check: false }
      delete self.matchedTransactionId
      self.isActivation = false
      self.duplicateAlert = {
        crossAgent,
        agentes: [orig.agenteId, other.uid],
        linkedTransactionIds: [linkedId],
        linkedTransactionNumbers: [linkedNum],
        setores,
        agentesInfo,
      }
      docs[`transactions/${selfId}`] = self
    }
  }

  /* -------- pedidos de edição pendentes -------- */
  const recentIds = ids.slice(-80)
  for (let k = 0; k < 5; k++) {
    const id = pick(recentIds)
    const d = docs[`transactions/${id}`]
    if (d.pendingEdit || d.systemValidation === 'duplicate') continue
    const changes: DocData = chance(0.6)
      ? { amount: Math.round(Number(d.amount) * pick([0.9, 1.1, 1.5]) / 50) * 50 }
      : { transactionDate: addDaysIso(String(d.transactionDate), -1) }
    d.pendingEdit = {
      submittedAt: Timestamp.fromMillis(now.getTime() - int(1, 30) * 3_600_000),
      submittedBy: d.agenteId,
      changes,
    }
    d.editRequestCount = k === 0 ? 3 : 1
  }

  /* -------- importados via planilha, sem comprovante ainda -------- */
  for (const id of ids.slice(-40).filter((_, i) => i % 9 === 4)) {
    const d = docs[`transactions/${id}`]
    d.transactionReceiptUrls = []
    d.conversationReceiptUrls = []
    d.importedAt = d.createdAt
  }

  docs['metadata/counters'] = { transactionsCounter: counter }

  /* -------- auditoria automática -------- */
  const activations = ids.filter((id) => docs[`transactions/${id}`].isActivation).length
  docs['audit_status/current'] = {
    status: 'clean',
    checked: activations,
    lastRunAt: Timestamp.fromMillis(now.getTime() - 2 * 3_600_000),
    lastReportId: 'demo-report',
  }

  /* -------- log de atividade -------- */
  const actors = USERS.filter((u) => u.role !== 'agente')
  const logIds = ids.slice(-120)
  for (let k = 0; k < 60; k++) {
    const depId = pick(logIds)
    const dep = docs[`transactions/${depId}`]
    const ms = now.getTime() - int(0, 14 * 24) * 3_600_000
    const byGestor = chance(0.35)
    const actor = byGestor ? USERS.find((u) => u.uid === dep.agenteId)! : pick(actors)
    const action = byGestor
      ? weighted([['transaction.create', 70], ['transaction.edit-request', 20], ['transaction.receipts-add', 10]] as const)
      : weighted([
          ['transaction.conversation-approve', 55],
          ['transaction.conversation-reject', 6],
          ['transaction.edit-approve', 10],
          ['transaction.edit-reject', 4],
          ['transaction.commission-settle', 15],
          ['transaction.fx-recalc', 5],
          ['transaction.force-revalidate', 5],
        ] as const)
    docs[`activityLog/log${String(k).padStart(3, '0')}`] = {
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      actorSetor: actor.setor ?? null,
      action,
      targetType: 'transaction',
      targetId: depId,
      targetLabel: `#${dep.transactionNumber} · ${dep.clientName}`,
      ...(action === 'transaction.edit-approve'
        ? { changes: { amount: { from: dep.amount, to: Number(dep.amount) + 100 } } }
        : {}),
      createdAt: Timestamp.fromMillis(ms),
    }
  }
  docs['activityLog/log_meta'] = {
    actorUid: 'u_admin',
    actorName: 'Marina Costa',
    actorRole: 'super_admin',
    actorSetor: null,
    action: 'meta.update',
    targetType: 'meta',
    targetId: today.slice(0, 7),
    targetLabel: `Metas ${today.slice(0, 7)}`,
    createdAt: Timestamp.fromMillis(now.getTime() - 5 * DAY),
  }

  return {
    docs,
    users: USERS.map((u) => ({ uid: u.uid, email: u.email, password: DEMO_PASSWORD })),
  }
}

/** Contas de acesso rápido exibidas na tela de login do demo. */
export const DEMO_ACCOUNTS = [
  { label: 'Super Admin', email: 'admin@validator.demo', hint: 'Visão global, metas, usuários, fechamento' },
  { label: 'Supervisor', email: 'supervisor@validator.demo', hint: 'Setores Premium + Starter' },
  { label: 'Gestor', email: 'gestor@validator.demo', hint: 'Registra e acompanha os próprios registros' },
] as const
