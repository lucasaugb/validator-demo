import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  DollarSign,
  ImageMinus,
  ImagePlus,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Target,
  Trash2,
  UserMinus,
  UserPlus,
  UserCog,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { formatDateBR } from '../lib/format'
import {
  subscribeActivityLog,
  type ActivityAction,
  type ActivityLogEntry,
} from '../lib/activityLog'
import { setorLabel } from '../types'
import { useAuth } from '../contexts/AuthContext'

const ACTION_META: Record<
  ActivityAction,
  { label: string; icon: LucideIcon; tone: 'neutral' | 'positive' | 'warning' | 'negative' | 'info' }
> = {
  'transaction.create': { label: 'Criou registro', icon: Plus, tone: 'positive' },
  'transaction.edit-request': { label: 'Solicitou edição', icon: Pencil, tone: 'info' },
  'transaction.edit-approve': { label: 'Aprovou edição', icon: CheckCircle2, tone: 'positive' },
  'transaction.edit-reject': { label: 'Rejeitou edição', icon: XCircle, tone: 'negative' },
  'transaction.edit-direct': { label: 'Editou registro', icon: Pencil, tone: 'info' },
  'transaction.delete': { label: 'Excluiu registro', icon: Trash2, tone: 'negative' },
  'transaction.conversation-approve': {
    label: 'Aprovou conversa',
    icon: ShieldCheck,
    tone: 'positive',
  },
  'transaction.conversation-reject': {
    label: 'Rejeitou conversa',
    icon: XCircle,
    tone: 'negative',
  },
  'transaction.conversation-pending': {
    label: 'Reabriu conversa',
    icon: RefreshCw,
    tone: 'warning',
  },
  'transaction.fx-recalc': { label: 'Puxou cotação BCE', icon: DollarSign, tone: 'info' },
  'transaction.force-revalidate': {
    label: 'Re-validou registro',
    icon: RefreshCw,
    tone: 'info',
  },
  'transaction.receipts-add': {
    label: 'Anexou imagens',
    icon: ImagePlus,
    tone: 'info',
  },
  'transaction.receipt-remove': {
    label: 'Removeu imagem',
    icon: ImageMinus,
    tone: 'warning',
  },
  'transaction.commission-settle': {
    label: 'Marcou comissão paga',
    icon: DollarSign,
    tone: 'positive',
  },
  'transaction.commission-unsettle': {
    label: 'Desmarcou comissão paga',
    icon: RefreshCw,
    tone: 'warning',
  },
  'agente.create': { label: 'Criou usuário', icon: UserPlus, tone: 'positive' },
  'agente.update': { label: 'Atualizou usuário', icon: UserCog, tone: 'info' },
  'agente.deactivate': { label: 'Desativou usuário', icon: UserMinus, tone: 'warning' },
  'agente.activate': { label: 'Ativou usuário', icon: ShieldCheck, tone: 'positive' },
  'agente.delete': { label: 'Excluiu usuário', icon: Trash2, tone: 'negative' },
  'agente.password-reset': {
    label: 'Enviou redefinição de senha',
    icon: KeyRound,
    tone: 'info',
  },
  'meta.update': { label: 'Ajustou meta', icon: Target, tone: 'info' },
}

export function AdminActivityLog() {
  const { agente } = useAuth()
  const isSuperAdmin = agente?.role === 'super_admin'
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [actorFilter, setActorFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<ActivityAction | 'all'>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const unsub = subscribeActivityLog(setEntries, 500)
    return unsub
  }, [])

  // Admin não vê ações de super_admin no log. Só o próprio super_admin vê
  // tudo. Filtramos no client e também usamos `visibleEntries` como base
  // pros filtros de ator/ação: assim o select de "usuários" não lista
  // super_admins pra um admin viewer. #decisao 2026-05-26
  const visibleEntries = useMemo(() => {
    if (isSuperAdmin) return entries
    return entries.filter((e) => e.actorRole !== 'super_admin')
  }, [entries, isSuperAdmin])

  // Lista de atores únicos pra filtro
  const actors = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of visibleEntries) m.set(e.actorUid, e.actorName)
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [visibleEntries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visibleEntries.filter((e) => {
      if (actorFilter !== 'all' && e.actorUid !== actorFilter) return false
      if (actionFilter !== 'all' && e.action !== actionFilter) return false
      if (
        q &&
        !e.actorName.toLowerCase().includes(q) &&
        !e.targetLabel.toLowerCase().includes(q) &&
        !(e.note ?? '').toLowerCase().includes(q)
      )
        return false
      return true
    })
  }, [visibleEntries, actorFilter, actionFilter, query])

  return (
    <>
      <PageHeader
        title="Log de atividade"
        subtitle={`${filtered.length} de ${visibleEntries.length} ações registradas`}
      />

      {/* Filtros */}
      <div className="panel mb-3 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-card px-2 py-1">
            <Search size={11} className="text-app-subtle" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar usuário, alvo ou nota…"
              className="w-56 bg-transparent text-[12px] text-app-text placeholder:text-app-subtle focus:outline-none"
            />
          </div>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded-md border border-app-border bg-app-card px-2 py-1 text-[12px] text-app-text"
          >
            <option value="all">Todos os usuários</option>
            {actors.map(([uid, name]) => (
              <option key={uid} value={uid}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as ActivityAction | 'all')}
            className="rounded-md border border-app-border bg-app-card px-2 py-1 text-[12px] text-app-text"
          >
            <option value="all">Todas as ações</option>
            {(Object.keys(ACTION_META) as ActivityAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_META[a].label}
              </option>
            ))}
          </select>
          {(actorFilter !== 'all' || actionFilter !== 'all' || query) && (
            <button
              type="button"
              onClick={() => {
                setActorFilter('all')
                setActionFilter('all')
                setQuery('')
              }}
              className="rounded-md px-2 py-1 text-[11px] text-app-muted hover:bg-app-elev hover:text-app-text"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <Shield size={28} className="mx-auto mb-3 text-app-subtle" />
          <h3 className="text-sm font-semibold text-app-text">
            Nenhuma ação registrada
          </h3>
          <p className="mt-1 text-xs text-app-muted">
            {entries.length === 0
              ? 'O log começa a partir de agora.'
              : 'Ajuste os filtros pra ver outras ações.'}
          </p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-app-border/60">
            {filtered.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function LogRow({ entry }: { entry: ActivityLogEntry }) {
  const meta = ACTION_META[entry.action] ?? {
    label: entry.action,
    icon: ChevronRight,
    tone: 'neutral' as const,
  }
  const Icon = meta.icon
  const toneCls =
    meta.tone === 'positive'
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
      : meta.tone === 'negative'
        ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10'
        : meta.tone === 'warning'
          ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
          : meta.tone === 'info'
            ? 'text-app-accent-text bg-app-accent/10'
            : 'text-app-muted bg-app-elev'
  const ts = entry.createdAt as { toDate?: () => Date } | undefined
  const date = ts?.toDate?.() ?? null

  return (
    <li className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-app-elev/30">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneCls}`}
      >
        <Icon size={13} strokeWidth={2.2} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-app-text">
            {entry.actorName}
          </span>
          <RolePill role={entry.actorRole} setor={entry.actorSetor} />
          <span className="text-[12px] text-app-muted">{meta.label}</span>
          <span className="text-[12px] text-app-text">{entry.targetLabel}</span>
        </div>
        {entry.changes && Object.keys(entry.changes).length > 0 && (
          <ChangesBadge changes={entry.changes} />
        )}
        {entry.note && (
          <div className="mt-0.5 text-[11px] italic text-app-muted">
            “{entry.note}”
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-[11px] tabular-nums text-app-muted">
          {date ? formatDateBR(toIso(date)) : '-'}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-app-subtle">
          {date ? formatTime(date) : ''}
        </div>
      </div>
    </li>
  )
}

function RolePill({
  role,
  setor,
}: {
  role: ActivityLogEntry['actorRole']
  setor: ActivityLogEntry['actorSetor']
}) {
  const cls =
    role === 'super_admin'
      ? 'bg-purple-500/10 text-purple-700 dark:text-purple-300'
      : role === 'admin'
        ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
        : role === 'supervisor'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  const label =
    role === 'super_admin'
      ? 'Super'
      : role === 'admin'
        ? 'Admin'
        : role === 'supervisor'
          ? 'Supervisor'
          : 'Gestor'
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] ${cls}`}
    >
      {label}
      {setor && (
        <span className="ml-1 font-normal normal-case text-app-muted">
          · {setorLabel[setor]}
        </span>
      )}
    </span>
  )
}

function ChangesBadge({
  changes,
}: {
  changes: NonNullable<ActivityLogEntry['changes']>
}) {
  const keys = Object.keys(changes)
  if (keys.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {keys.map((k) => {
        const { from, to } = changes[k]
        return (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded border border-app-border bg-app-elev/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-app-muted"
            title={`${k}: ${displayVal(from)} → ${displayVal(to)}`}
          >
            <span className="text-app-text">{k}</span>
            <span className="text-app-subtle">
              {displayVal(from)} → {displayVal(to)}
            </span>
          </span>
        )
      })}
    </div>
  )
}

function displayVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.length > 30 ? v.slice(0, 27) + '…' : v
  return JSON.stringify(v).slice(0, 30)
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
