import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import {
  agentDeltas,
  METRIC_GETTER,
  type AgentMetricKey,
  type AgentScorecard,
} from '../lib/metrics'
import { formatMoney } from '../lib/format'
import { SetorBadge } from './SetorBadge'
import { HiddenDots } from './CommissionBalanceCard'

interface Props {
  current: AgentScorecard[]
  previous: AgentScorecard[]
  onSelectAgent?: (agenteId: string) => void
  /** Mapa agenteId → URL da foto. Quando ausente, cai no fallback de iniciais. */
  avatarUrlByAgente?: Map<string, string | undefined>
  /** Quando true, oculta o valor da coluna Comissão (olhinho global). */
  hidden?: boolean
}

interface ColumnDef {
  key: AgentMetricKey
  label: string
  /** Quando true, queda é boa (inválido, tempo). */
  invertDelta?: boolean
  format: (v: number) => string
  /** Quando true, mostra a barra horizontal de comparação. */
  showBar?: boolean
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'validated',
    label: 'Validados',
    format: (v) => String(Math.round(v)),
    showBar: true,
  },
  {
    key: 'commission',
    label: 'Comissão',
    format: (v) => formatMoney(v),
    showBar: true,
  },
  {
    key: 'activations',
    label: 'Ativações',
    format: (v) => String(Math.round(v)),
  },
  {
    key: 'validationRate',
    label: 'Taxa val.',
    format: (v) => `${(v * 100).toFixed(0)}%`,
  },
  {
    key: 'avgTicket',
    label: 'Ticket médio',
    format: (v) => (v > 0 ? formatMoney(v) : '-'),
  },
  {
    key: 'invalidRate',
    label: 'Inválidos',
    format: (v) => `${(v * 100).toFixed(0)}%`,
    invertDelta: true,
  },
]

/**
 * Tabela densa comparando agentes em múltiplas métricas, com:
 *   - Sort clicável por coluna
 *   - Delta vs período anterior (chip colorido por métrica)
 *   - Barra horizontal proporcional ao top da coluna nas métricas chave
 *   - Avatar circular com iniciais
 */
export function AgentLeaderboard({
  current,
  previous,
  onSelectAgent,
  avatarUrlByAgente,
  hidden = false,
}: Props) {
  const [sortKey, setSortKey] = useState<AgentMetricKey>('commission')
  const [desc, setDesc] = useState(true)

  const rows = useMemo(() => {
    const list = [...current]
    const sign = desc ? -1 : 1
    const get = METRIC_GETTER[sortKey]
    list.sort((a, b) => {
      const va = get(a) ?? 0
      const vb = get(b) ?? 0
      return sign * (va - vb)
    })
    return list
  }, [current, sortKey, desc])

  // pré-computa deltas pra cada coluna (mapa agenteId -> rel)
  const deltaByCol = useMemo(() => {
    const map = new Map<AgentMetricKey, Map<string, number | null>>()
    for (const col of COLUMNS) {
      const list = agentDeltas(current, previous, col.key)
      const m = new Map<string, number | null>()
      for (const d of list) m.set(d.agenteId, d.rel)
      map.set(col.key, m)
    }
    return map
  }, [current, previous])

  // máximos por coluna pra barras proporcionais
  const maxByCol = useMemo(() => {
    const m: Partial<Record<AgentMetricKey, number>> = {}
    for (const col of COLUMNS) {
      const get = METRIC_GETTER[col.key]
      let mx = 0
      for (const s of current) {
        const v = get(s) ?? 0
        if (v > mx) mx = v
      }
      m[col.key] = mx
    }
    return m
  }, [current])

  const toggleSort = (k: AgentMetricKey) => {
    if (sortKey === k) {
      setDesc((v) => !v)
    } else {
      setSortKey(k)
      setDesc(true)
    }
  }

  if (current.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-app-subtle">
        Nenhum gestor fez registro no período.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-app-border bg-app-elev/40 text-[10px] uppercase tracking-[0.12em] text-app-subtle">
            <Th className="text-left">Gestor</Th>
            <Th className="text-left">Setor</Th>
            {COLUMNS.map((c) => (
              <Th
                key={c.key}
                className={`text-right ${sortKey === c.key ? 'text-app-text' : ''}`}
              >
                <button
                  onClick={() => toggleSort(c.key)}
                  className="inline-flex items-center gap-1 hover:text-app-text"
                  title={`Ordenar por ${c.label}`}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="text-app-muted">{desc ? '↓' : '↑'}</span>
                  )}
                </button>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {rows.map((s, idx) => (
            <tr
              key={s.agenteId}
              onClick={onSelectAgent ? () => onSelectAgent(s.agenteId) : undefined}
              className={`transition-colors hover:bg-app-elev/40 ${
                onSelectAgent ? 'cursor-pointer' : ''
              }`}
            >
              <Td>
                <div className="flex items-center gap-2.5">
                  <Avatar
                    seed={s.agenteId}
                    name={s.agenteName}
                    photoUrl={avatarUrlByAgente?.get(s.agenteId)}
                    rank={idx + 1}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-app-text">{s.agenteName}</div>
                    <div className="text-[10px] text-app-subtle">
                      {s.total} registro{s.total === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </Td>
              <Td>
                {s.setor ? (
                  <SetorBadge setor={s.setor} size="xs" />
                ) : (
                  <span className="text-[10px] text-app-subtle">-</span>
                )}
              </Td>
              {COLUMNS.map((c) => {
                const num = METRIC_GETTER[c.key](s) ?? 0
                const max = maxByCol[c.key] ?? 0
                const ratio = max > 0 ? num / max : 0
                const rel = deltaByCol.get(c.key)?.get(s.agenteId)
                return (
                  <Td key={c.key} className="text-right">
                    <div className="inline-flex flex-col items-end">
                      <span className="font-semibold tabular-nums text-app-text">
                        {hidden && c.key === 'commission' ? (
                          <HiddenDots count={3} size="sm" />
                        ) : (
                          c.format(num)
                        )}
                      </span>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <DeltaChip
                          rel={rel ?? undefined}
                          invert={c.invertDelta}
                        />
                        {c.showBar && (
                          <div className="h-1 w-12 overflow-hidden rounded-full bg-app-elev/60">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
                                background:
                                  c.key === 'commission' || c.key === 'validated'
                                    ? 'var(--app-accent)'
                                    : 'var(--app-border-strong)',
                                opacity: 0.85,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </Td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DeltaChip({
  rel,
  invert,
}: {
  rel?: number | null
  invert?: boolean
}) {
  if (rel === undefined || rel === null) {
    return (
      <span className="inline-flex items-center text-[10px] text-app-subtle">
        <Minus size={9} />
      </span>
    )
  }
  const isZero = Math.abs(rel) < 0.005
  const isUp = rel > 0
  const isGood = isZero ? false : invert ? !isUp : isUp
  const cls = isZero
    ? 'text-app-subtle'
    : isGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400'
  const Icon = isZero ? Minus : isUp ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums ${cls}`}>
      <Icon size={9} strokeWidth={2.5} />
      {isZero
        ? '0%'
        : `${Math.abs(rel * 100).toFixed(rel * 100 >= 10 ? 0 : 1)}%`}
    </span>
  )
}

const PALETTE = [
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
]
function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function initials(name: string): string {
  return (
    (name || '?')
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '-'
  )
}

function Avatar({
  seed,
  name,
  photoUrl,
  rank,
}: {
  seed: string
  name: string
  photoUrl?: string
  rank: number
}) {
  return (
    <div className="relative shrink-0">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          width={32}
          height={32}
          className="h-8 w-8 rounded-full border border-app-border object-cover"
        />
      ) : (
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold ${pickColor(
            seed,
          )}`}
        >
          {initials(name)}
        </div>
      )}
      {rank <= 3 && (
        <span
          className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none"
          style={{
            background:
              rank === 1
                ? '#fbbf24'
                : rank === 2
                  ? '#a3a3a3'
                  : '#d97706',
            color: '#0a0e1a',
          }}
        >
          {rank}
        </span>
      )}
    </div>
  )
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
        className ?? ''
      }`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2.5 align-middle text-app-text ${
        className ?? ''
      }`}
    >
      {children}
    </td>
  )
}

