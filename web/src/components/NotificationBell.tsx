import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  FileEdit,
  Pencil,
  Plus,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  subscribeAgenteTransactions,
  subscribeAllTransactions,
} from '../lib/transactions'
import type {
  ConversationValidation,
  Transaction,
  Setor,
  SystemValidation,
} from '../types'
import {
  finalStatus,
  replicationCount,
  replicationLabel,
  setorLabel,
  setoresInScope,
} from '../types'

/**
 * Bell de notificações.
 *
 * Modelo (revisado em 2026-06-02): dois tipos de item:
 *   1. ALERTAS PERSISTENTES: recalculados do snapshot atual a cada leitura do
 *      Firestore. Ficam na lista (e contam no badge) ENQUANTO a condição
 *      existir; somem sozinhos quando resolvida. Servem de "pendência aberta".
 *   2. EVENTOS TRANSIENTES: emitidos UMA vez na transição de estado e
 *      acumulados em memória; viram "lidos" ao abrir o bell.
 *
 * Comportamento por papel:
 *   - agente (gestor):
 *       · ALERTA persistente: conversa rejeitada (fica até a conversa ser
 *         reaberta/aprovada).
 *       · EVENTO único: registro TOTALMENTE verificado (finalStatus validated).
 *       · Nada mais (sem "criado", "editado", nem invalidado pelo sistema).
 *   - supervisor: bell EXCLUSIVO de alertas do próprio setor,
 *       · registro duplicado (na hora, mesmo gestor ou entre gestores);
 *       · gestor com mais de 2 registros invalidados pelo sistema;
 *       · 3+ pedidos de edição no mesmo registro.
 *   - admin / super_admin: os MESMOS alertas persistentes do supervisor (mas
 *       sobre todos os setores) MAIS o fluxo de eventos transientes (criado,
 *       verificado, editado, conversa). Os eventos que se sobrepõem aos
 *       alertas (duplicado, abuso de edição) saem do fluxo transiente pra não
 *       contar duas vezes: viram só alerta persistente.
 *
 * Sem backend dedicado: tudo client-side, alimentado por um listener do
 * Firestore. Supervisor assina só o próprio escopo de setor (rules exigem).
 *
 * Contagem de não-lidas (revisado em 2026-06-29, fim do "badge nunca zera"):
 *   o badge conta os IDENTIFICADORES de itens que o usuário ainda não viu.
 *   Abrir o sino marca TUDO que está na lista como visto (badge → 0); o número
 *   só volta quando aparece um item com ID novo, seja evento ou alerta. Os
 *   alertas persistentes continuam aparecendo na lista enquanto a pendência
 *   existir, mas, uma vez vistos, não re-inflam o badge. Antes os alertas
 *   sempre contavam, então o badge ficava vermelho pra sempre (bug relatado).
 *
 * Persistência:
 *   - `notif:seenIds:{uid}`  → IDs já vistos (JSON), base do badge entre reloads.
 *   - `notif:lastSeen:{uid}` → timestamp, só pra limitar o "histórico" inicial de
 *     eventos do gestor (não floodar a base inteira no primeiro load).
 */

type NotifKind =
  | 'created'
  | 'system-verified'
  | 'system-invalid'
  | 'conversation-approved'
  | 'conversation-rejected'
  | 'edited'
  | 'edit-abuse'
  | 'duplicate'
  | 'invalid-streak'

interface TransactionNotif {
  id: string
  ts: number
  kind: NotifKind
  transactionId: string
  transactionNumber?: number
  message: string
  detail?: string
}

interface PrevState {
  systemValidation: SystemValidation
  conversationValidation: ConversationValidation
  updatedAt: number
  editRequestCount: number
}

const MAX_NOTIFS = 50

/** Threshold de "abuso de edição": alinhado com AdminEdits (3+ pedidos). */
const EDIT_ABUSE_THRESHOLD = 3
/** Quantidade de invalidações pelo sistema acima da qual o supervisor é alertado. */
const INVALID_STREAK_THRESHOLD = 2

const KIND_META: Record<
  NotifKind,
  { icon: LucideIcon; tone: 'positive' | 'negative' | 'warning' | 'info' }
> = {
  created: { icon: Plus, tone: 'info' },
  'system-verified': { icon: CheckCircle2, tone: 'positive' },
  'system-invalid': { icon: XCircle, tone: 'negative' },
  'conversation-approved': { icon: CheckCircle2, tone: 'positive' },
  'conversation-rejected': { icon: XCircle, tone: 'warning' },
  edited: { icon: Pencil, tone: 'info' },
  'edit-abuse': { icon: AlertTriangle, tone: 'negative' },
  duplicate: { icon: Copy, tone: 'warning' },
  'invalid-streak': { icon: ShieldAlert, tone: 'negative' },
}

function toneCls(tone: 'positive' | 'negative' | 'warning' | 'info'): string {
  switch (tone) {
    case 'positive':
      return 'text-emerald-600 dark:text-emerald-300'
    case 'negative':
      return 'text-red-600 dark:text-red-300'
    case 'warning':
      return 'text-amber-600 dark:text-amber-300'
    case 'info':
    default:
      return 'text-app-accent-text'
  }
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'agora há pouco'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const days = Math.floor(h / 24)
  if (days < 30) return `há ${days}d`
  return new Date(ts).toLocaleDateString('pt-BR')
}

function formatNumber(n?: number): string {
  return n != null ? `#${n}` : ''
}

/**
 * Descreve os gestores/setores envolvidos num grupo de duplicação além do
 * própria transação: usa `agentesInfo` (nome + setor) quando o backend gravou,
 * caindo pra `setores` quando não. Devolve string vazia se não há cross.
 */
function duplicateCrossPart(d: Transaction): string {
  const others = (d.duplicateAlert?.agentesInfo ?? []).filter(
    (a) => a.uid !== d.agenteId,
  )
  if (others.length > 0) {
    const parts = others.map((a) =>
      a.name && a.setor
        ? `${a.name} (${setorLabel[a.setor]})`
        : a.name ?? (a.setor ? setorLabel[a.setor] : 'outro gestor'),
    )
    return ` com ${parts.join(', ')}`
  }
  const otherSetores =
    d.duplicateAlert?.setores?.filter((s) => s !== d.agenteSetor) ?? []
  if (otherSetores.length > 0) {
    return ` (setor ${otherSetores.map((s) => setorLabel[s]).join(', ')})`
  }
  return ''
}

/** Notificação "registro totalmente verificado" (evento único do gestor). */
function verifiedNotif(d: Transaction, ts: number): TransactionNotif {
  return {
    id: `${d.id}-validated-${ts}`,
    ts: ts || Date.now(),
    kind: 'system-verified',
    transactionId: d.id,
    transactionNumber: d.transactionNumber,
    message: `Registro ${formatNumber(d.transactionNumber)} verificado`,
    detail: d.clientName,
  }
}

/**
 * Recalcula os ALERTAS persistentes do snapshot atual. IDs determinísticos
 * (por transação/gestor) pra não duplicar entre snapshots; some sozinho quando
 * a condição deixa de valer.
 */
function computeAlerts(
  transactions: Transaction[],
  role: 'agente' | 'supervisor' | 'admin',
): TransactionNotif[] {
  const out: TransactionNotif[] = []

  if (role === 'agente') {
    // Conversa rejeitada: persiste até a conversa sair de 'rejected'.
    for (const d of transactions) {
      if (d.conversationValidation !== 'rejected') continue
      out.push({
        id: `alert-conv-rejected-${d.id}`,
        ts: d.updatedAt?.toMillis() ?? Date.now(),
        kind: 'conversation-rejected',
        transactionId: d.id,
        transactionNumber: d.transactionNumber,
        message: `Registro ${formatNumber(d.transactionNumber)}: conversa rejeitada`,
        detail: d.conversationNote
          ? `Observação do admin: ${d.conversationNote}`
          : d.clientName,
      })
    }
    out.sort((a, b) => b.ts - a.ts)
    return out
  }

  // ---- supervisor / admin / super_admin: alertas persistentes ----
  // (supervisor escopado por setor pela assinatura; admin/super veem todos)

  // 1. Duplicados: na hora, qualquer gestor (mesmo ou entre gestores).
  for (const d of transactions) {
    if (d.systemValidation !== 'duplicate') continue
    const lbl = replicationLabel(replicationCount(d))
    const cross = duplicateCrossPart(d)
    out.push({
      id: `alert-duplicate-${d.id}`,
      ts: d.updatedAt?.toMillis() ?? Date.now(),
      kind: 'duplicate',
      transactionId: d.id,
      transactionNumber: d.transactionNumber,
      message: `Registro ${formatNumber(d.transactionNumber)} ${lbl.toLowerCase()}${cross}`,
      detail: cross
        ? `${d.agenteName} · duplicidade entre gestores`
        : `${d.agenteName} · mesmo gestor`,
    })
  }

  // 2. Abuso de edição: 3+ pedidos no mesmo registro.
  for (const d of transactions) {
    const c = d.editRequestCount ?? 0
    if (c < EDIT_ABUSE_THRESHOLD) continue
    out.push({
      id: `alert-edit-abuse-${d.id}`,
      ts: d.updatedAt?.toMillis() ?? Date.now(),
      kind: 'edit-abuse',
      transactionId: d.id,
      transactionNumber: d.transactionNumber,
      message: `Registro ${formatNumber(d.transactionNumber)}: ${c} pedidos de edição`,
      detail: `${d.agenteName} · revisar antes de aprovar`,
    })
  }

  // 3. Gestor com mais de 2 registros invalidados pelo sistema.
  const invalidByAgent = new Map<
    string,
    { name: string; setor?: Setor; count: number; ts: number }
  >()
  for (const d of transactions) {
    if (d.systemValidation !== 'invalid') continue
    const e =
      invalidByAgent.get(d.agenteId) ??
      { name: d.agenteName, setor: d.agenteSetor, count: 0, ts: 0 }
    e.count += 1
    e.ts = Math.max(e.ts, d.updatedAt?.toMillis() ?? 0)
    invalidByAgent.set(d.agenteId, e)
  }
  for (const [uid, e] of invalidByAgent) {
    if (e.count <= INVALID_STREAK_THRESHOLD) continue
    out.push({
      id: `alert-invalid-streak-${uid}`,
      ts: e.ts || Date.now(),
      kind: 'invalid-streak',
      transactionId: uid,
      message: `${e.name}: ${e.count} registros invalidados pelo sistema`,
      detail: e.setor ? `Setor ${setorLabel[e.setor]} · revisar` : 'revisar',
    })
  }

  out.sort((a, b) => b.ts - a.ts)
  return out
}

export function NotificationBell() {
  const { agente } = useAuth()
  const role = agente?.role

  // Hooks SEMPRE chamados na mesma ordem, early return só DEPOIS deles.
  const [open, setOpen] = useState(false)
  // Alertas persistentes (recalculados) e eventos transientes (acumulados).
  const [alerts, setAlerts] = useState<TransactionNotif[]>([])
  const [events, setEvents] = useState<TransactionNotif[]>([])

  // Chave do timestamp de baseline (gating do histórico inicial de eventos).
  const lsKey = agente?.uid ? `notif:lastSeen:${agente.uid}` : null
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    if (!lsKey) return Date.now()
    const stored = typeof window !== 'undefined' ? localStorage.getItem(lsKey) : null
    return stored ? Number(stored) : Date.now()
  })

  // IDs já vistos: base do badge. Persistidos por uid.
  const seenKey = agente?.uid ? `notif:seenIds:${agente.uid}` : null
  const [seenIds, setSeenIds] = useState<Set<string>>(() => loadSeen(seenKey))
  // Quais estavam não-lidos no momento da abertura, congela o destaque visual
  // enquanto o painel está aberto (abrir não "apaga" o realce na hora).
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())

  const persistSeen = (ids: Set<string>) => {
    if (!seenKey || typeof window === 'undefined') return
    try {
      localStorage.setItem(seenKey, JSON.stringify(Array.from(ids)))
    } catch {
      /* localStorage cheio/indisponível: badge degrada, sem quebrar */
    }
  }

  const prevStates = useRef<Map<string, PrevState>>(new Map())
  const initialized = useRef(false)

  useEffect(() => {
    if (!agente) return
    // reset ao trocar de usuário
    prevStates.current = new Map()
    initialized.current = false
    setAlerts([])
    setEvents([])
    setSeenIds(loadSeen(seenKey))
    setHighlightIds(new Set())
    const baselineCutoff = lastSeenAt

    // -------- supervisor: só alertas, escopado por setor --------
    if (role === 'supervisor') {
      const setores = agente.setor ? setoresInScope(agente.setor) : undefined
      return subscribeAllTransactions(
        (transactions) => setAlerts(computeAlerts(transactions, 'supervisor')),
        setores,
      )
    }

    // -------- gestor: alerta de conversa rejeitada + evento de verificado --------
    if (role === 'agente') {
      const handler = (transactions: Transaction[]) => {
        setAlerts(computeAlerts(transactions, 'agente'))

        if (!initialized.current) {
          // Baseline: popula prev e emite "verificado" histórico (gated pelo
          // lastSeen) pra não floodar a base inteira.
          const baseline: TransactionNotif[] = []
          for (const d of transactions) {
            prevStates.current.set(d.id, snap(d))
            const updatedMs = d.updatedAt?.toMillis() ?? 0
            if (updatedMs <= baselineCutoff) continue
            if (finalStatus(d) === 'validated') {
              baseline.push(verifiedNotif(d, updatedMs))
            }
          }
          if (baseline.length > 0) {
            baseline.sort((a, b) => b.ts - a.ts)
            setEvents((prev) => [...baseline, ...prev].slice(0, MAX_NOTIFS))
          }
          initialized.current = true
          return
        }

        const incoming: TransactionNotif[] = []
        const currentIds = new Set<string>()
        for (const d of transactions) {
          currentIds.add(d.id)
          const prev = prevStates.current.get(d.id)
          const updatedMs = d.updatedAt?.toMillis() ?? 0
          if (prev) {
            const prevFinal = finalStatus({
              systemValidation: prev.systemValidation,
              conversationValidation: prev.conversationValidation,
            })
            if (prevFinal !== 'validated' && finalStatus(d) === 'validated') {
              incoming.push(verifiedNotif(d, updatedMs))
            }
          }
          prevStates.current.set(d.id, snap(d))
        }
        for (const id of Array.from(prevStates.current.keys())) {
          if (!currentIds.has(id)) prevStates.current.delete(id)
        }
        if (incoming.length > 0) {
          setEvents((prev) => [...incoming, ...prev].slice(0, MAX_NOTIFS))
        }
      }
      return subscribeAgenteTransactions(agente.uid, handler)
    }

    // -------- admin / super_admin: alertas persistentes + eventos transientes --------
    const handler = (transactions: Transaction[]) => {
      // Alertas persistentes (duplicado / abuso de edição / gestor com 3+
      // invalidações) recalculados do snapshot: aparecem mesmo que a transição
      // tenha ocorrido fora da sessão (cron de validação, etc.).
      setAlerts(computeAlerts(transactions, 'admin'))

      if (!initialized.current) {
        for (const d of transactions) prevStates.current.set(d.id, snap(d))
        initialized.current = true
        return
      }

      const incoming: TransactionNotif[] = []
      const currentIds = new Set<string>()
      const itemLabel = 'Registro'

      for (const d of transactions) {
        currentIds.add(d.id)
        const prev = prevStates.current.get(d.id)
        const updatedMs = d.updatedAt?.toMillis() ?? 0

        if (!prev) {
          incoming.push({
            id: `${d.id}-created`,
            ts: d.createdAt?.toMillis() ?? Date.now(),
            kind: 'created',
            transactionId: d.id,
            transactionNumber: d.transactionNumber,
            message: `${itemLabel} ${formatNumber(d.transactionNumber)} registrado`,
            detail: `${d.agenteName} · ${d.clientName}`,
          })
        } else {
          let emitted = false

          if (
            prev.systemValidation === 'pending' &&
            d.systemValidation !== 'pending'
          ) {
            const sv = d.systemValidation
            // 'duplicate' não vira evento transiente: já é coberto pelo alerta
            // persistente acima (computeAlerts), pra não notificar duas vezes.
            if (sv !== 'duplicate') {
              const message =
                sv === 'verified'
                  ? `Registro ${formatNumber(d.transactionNumber)} validado pelo sistema`
                  : `Registro ${formatNumber(d.transactionNumber)} invalidado pelo sistema`
              incoming.push({
                id: `${d.id}-sys-${sv}-${updatedMs}`,
                ts: updatedMs || Date.now(),
                kind: sv === 'verified' ? 'system-verified' : 'system-invalid',
                transactionId: d.id,
                transactionNumber: d.transactionNumber,
                message: message.replace(/\s+/g, ' ').trim(),
                detail: d.clientName,
              })
            }
            emitted = true
          }

          if (
            prev.conversationValidation === 'pending' &&
            d.conversationValidation !== 'pending'
          ) {
            const cv = d.conversationValidation
            const message =
              cv === 'approved'
                ? `Registro ${formatNumber(d.transactionNumber)} aprovado na conversa`
                : `Registro ${formatNumber(d.transactionNumber)} rejeitado na conversa`
            incoming.push({
              id: `${d.id}-conv-${cv}-${updatedMs}`,
              ts: updatedMs || Date.now(),
              kind:
                cv === 'approved'
                  ? 'conversation-approved'
                  : 'conversation-rejected',
              transactionId: d.id,
              transactionNumber: d.transactionNumber,
              message: message.replace(/\s+/g, ' ').trim(),
              detail: d.clientName,
            })
            emitted = true
          }

          if (!emitted && updatedMs > prev.updatedAt) {
            incoming.push({
              id: `${d.id}-edit-${updatedMs}`,
              ts: updatedMs,
              kind: 'edited',
              transactionId: d.id,
              transactionNumber: d.transactionNumber,
              message: `${itemLabel} ${formatNumber(d.transactionNumber)} editado`,
              detail: d.clientName,
            })
          }
          // Abuso de edição (3+ pedidos) não vira evento transiente: já é
          // coberto pelo alerta persistente (computeAlerts), pra não duplicar.
        }

        prevStates.current.set(d.id, snap(d))
      }

      for (const id of Array.from(prevStates.current.keys())) {
        if (!currentIds.has(id)) prevStates.current.delete(id)
      }

      if (incoming.length > 0) {
        setEvents((prev) => [...incoming, ...prev].slice(0, MAX_NOTIFS))
      }
    }

    return subscribeAllTransactions(handler)
  }, [agente, role])

  // Lista exibida: alertas + eventos, mais recente primeiro.
  const items = useMemo(() => {
    return [...alerts, ...events]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_NOTIFS)
  }, [alerts, events])

  // Não-lidas: itens (alertas OU eventos) cujo ID ainda não foi visto. Abrir o
  // sino marca todos como vistos, então isto zera; só volta com ID novo.
  const unreadCount = useMemo(
    () => items.filter((n) => !seenIds.has(n.id)).length,
    [items, seenIds],
  )

  // Enquanto o painel está aberto, qualquer item que chegue é marcado como visto
  // na hora: mantém o badge zerado e evita "1" piscando com o sino aberto.
  useEffect(() => {
    if (!open) return
    setSeenIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const n of items) {
        if (!next.has(n.id)) {
          next.add(n.id)
          changed = true
        }
      }
      if (changed) persistSeen(next)
      return changed ? next : prev
    })
    // persistSeen é estável o suficiente (fecha sobre seenKey); items/open governam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items])

  const handleToggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    // Abrindo: congela o realce dos que estavam não-lidos, marca tudo como visto.
    const unseen = items.filter((n) => !seenIds.has(n.id)).map((n) => n.id)
    setHighlightIds(new Set(unseen))
    const allIds = new Set(items.map((n) => n.id))
    setSeenIds(allIds)
    persistSeen(allIds)
    if (lsKey) {
      const now = Date.now()
      setLastSeenAt(now)
      localStorage.setItem(lsKey, String(now))
    }
    setOpen(true)
  }

  // Render null só quando não autenticado. Supervisor agora TEM bell (alertas).
  if (!agente) return null

  const subtitle =
    role === 'agente'
      ? 'Eventos nos seus registros'
      : role === 'supervisor'
        ? 'Alertas do seu setor'
        : 'Eventos em todos os registros'

  const emptyText =
    role === 'supervisor'
      ? 'Sem alertas no momento.'
      : 'Sem novidades por enquanto.'

  return (
    <div className="relative hidden lg:inline-block">
      <button
        type="button"
        onClick={handleToggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-app-border bg-app-card text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
        title="Notificações"
        aria-label="Notificações"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9.5px] font-semibold leading-none text-white shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* backdrop pra fechar ao clicar fora */}
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30"
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Notificações"
            className="absolute right-0 top-full z-40 mt-2 w-[340px] origin-top-right rounded-xl border border-app-border bg-app-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-app-text">
                  {role === 'supervisor' ? 'Alertas' : 'Notificações'}
                </h3>
                <p className="text-[11px] text-app-subtle">{subtitle}</p>
              </div>
              {events.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEvents([])}
                  className="text-[11px] text-app-subtle transition-colors hover:text-app-text"
                  title="Limpar eventos (alertas abertos permanecem)"
                >
                  Limpar
                </button>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <FileEdit
                    size={20}
                    className="mx-auto mb-2 text-app-subtle"
                  />
                  <p className="text-sm text-app-muted">{emptyText}</p>
                  <p className="mt-1 text-[11px] text-app-subtle">
                    {role === 'supervisor'
                      ? 'Duplicidades, abuso de edição e invalidações aparecem aqui.'
                      : 'Eventos novos vão aparecer aqui em tempo real.'}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-app-border">
                  {items.map((n) => {
                    const meta = KIND_META[n.kind]
                    const Icon = meta.icon
                    const isUnread = highlightIds.has(n.id)
                    return (
                      <li
                        key={n.id}
                        className={`flex gap-3 px-4 py-3 ${
                          isUnread ? 'bg-app-accent/[0.04]' : ''
                        }`}
                      >
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-app-elev ${toneCls(meta.tone)}`}
                        >
                          <Icon size={13} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-app-text">
                            {n.message}
                          </p>
                          {n.detail && (
                            <p className="mt-0.5 truncate text-[11px] text-app-muted">
                              {n.detail}
                            </p>
                          )}
                          <p className="mt-0.5 text-[10px] text-app-subtle">
                            {relTime(n.ts)}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Lê o conjunto de IDs já vistos do localStorage (tolerante a dado corrompido). */
function loadSeen(key: string | null): Set<string> {
  if (!key || typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function snap(d: Transaction): PrevState {
  return {
    systemValidation: d.systemValidation,
    conversationValidation: d.conversationValidation,
    updatedAt: d.updatedAt?.toMillis() ?? 0,
    editRequestCount: d.editRequestCount ?? 0,
  }
}
