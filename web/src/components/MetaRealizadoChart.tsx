import { useMemo, useState } from 'react'
import {
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { ForecastChart, ForecastRitmoCards } from './ForecastStats'
import { formatMetric } from '../lib/format'
import {
  buildForecast,
  buildForecastDaily,
  countBusinessDays,
  metricValueOf,
} from '../lib/forecast'
import {
  effectiveColaboradorMeta,
  effectiveSetorMeta,
  eligibleColaboradores,
  rolledUpGeralMeta,
  rolledUpSetorMeta,
  type MetaDoc,
} from '../lib/metas'
import { SETORES, finalStatus, setorLabel } from '../types'
import type { Agente, Transaction, MetaKind, Setor } from '../types'

interface Props {
  /** Transações disponíveis (admin: todos). */
  transactions: Transaction[]
  agentes: Agente[]
  /** Todas as metas (default + por mês) keyed por id. */
  metasByMonth: Map<string, MetaDoc>
  /** yyyy-MM selecionado no topo da tela (usado no modo Dia + fim da série mensal). */
  month: string
  /** Métrica em foco (segue o seletor da tela de Metas). */
  kind: MetaKind
}

type Granularity = 'month' | 'day'
type ScopeKind = 'geral' | 'setor' | 'colaborador'

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * Gráfico Realizado × Meta, por Mês (últimos 12) ou por Dia (mês selecionado,
 * acumulado vs ritmo de meta). Escopo Geral / Time / Colaborador. A métrica
 * (volume validado USD × nº de ativações validadas) vem do seletor da tela.
 * Meta usa a mesma resolução da tela de Metas (rolled-up: ajuste individual
 * sobe pro time e pro geral). Só admin/canEditMetas vê.
 */
export function MetaRealizadoChart({ transactions, agentes, metasByMonth, month, kind }: Props) {
  const { theme } = useTheme()
  const fmt = (v: number) => formatMetric(v, kind)
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [scopeKind, setScopeKind] = useState<ScopeKind>('geral')
  const [selectedSetor, setSelectedSetor] = useState<Setor>('premium')
  const [selectedUid, setSelectedUid] = useState<string>('')

  const defaultDoc = metasByMonth.get('default') ?? null

  const colaboradores = useMemo(
    () =>
      agentes
        .filter((a) => a.role === 'agente' && a.active && a.setor)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agentes],
  )

  // Fallback pro primeiro colaborador enquanto nenhum foi escolhido (evita
  // setState em render).
  const effectiveUid = selectedUid || colaboradores[0]?.uid || ''

  /** Meta efetiva do escopo para um mês. */
  const metaForScope = useMemo(() => {
    return (m: string): number => {
      const monthDoc = metasByMonth.get(m) ?? null
      if (scopeKind === 'geral') return rolledUpGeralMeta(agentes, m, monthDoc, defaultDoc, kind)
      if (scopeKind === 'setor') {
        return rolledUpSetorMeta(agentes, selectedSetor, m, monthDoc, defaultDoc, kind)
      }
      const target = agentes.find((a) => a.uid === effectiveUid)
      if (!target?.setor) return 0
      const setorMeta = effectiveSetorMeta(target.setor, monthDoc, defaultDoc, kind)
      const elig = eligibleColaboradores(agentes, target.setor, m).length
      return effectiveColaboradorMeta(target.uid, setorMeta, elig, monthDoc, kind)
    }
  }, [metasByMonth, defaultDoc, scopeKind, selectedSetor, effectiveUid, agentes, kind])

  /** Transações filtrados pelo escopo (não por período, o período é aplicado no cálculo). */
  const scopedTransactions = useMemo(() => {
    if (scopeKind === 'setor') return transactions.filter((d) => d.agenteSetor === selectedSetor)
    if (scopeKind === 'colaborador') return transactions.filter((d) => d.agenteId === effectiveUid)
    return transactions
  }, [transactions, scopeKind, selectedSetor, effectiveUid])

  /* ------------------------------- dados ---------------------------------- */
  const data = useMemo(() => {
    if (granularity === 'month') {
      // Últimos 12 meses terminando no mês selecionado.
      const [sy, sm] = month.split('-').map(Number)
      const out: { key: string; label: string; realizado: number; meta: number }[] = []
      for (let i = 11; i >= 0; i--) {
        const ref = new Date(sy, sm - 1 - i, 1)
        const y = ref.getFullYear()
        const mo = ref.getMonth() + 1
        const key = `${y}-${String(mo).padStart(2, '0')}`
        let realizado = 0
        for (const d of scopedTransactions) {
          if (finalStatus(d) !== 'validated') continue
          if ((d.transactionDate || '').slice(0, 7) !== key) continue
          realizado += metricValueOf(d, kind)
        }
        out.push({ key, label: `${MONTHS_SHORT[mo - 1]}/${String(y).slice(2)}`, realizado, meta: metaForScope(key) })
      }
      return out
    }
    // DIA: acumulado no mês selecionado vs ritmo da meta (dias úteis).
    const [y, mo] = month.split('-').map(Number)
    const lastDay = new Date(y, mo, 0).getDate()
    const bdTotal = countBusinessDays(y, mo, 1, lastDay)
    const metaMonth = metaForScope(month)
    const now = new Date()
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === mo
    const todayDay = now.getDate()

    // Realizado por dia (do escopo, no mês).
    const perDay = new Array(lastDay + 1).fill(0)
    for (const d of scopedTransactions) {
      if (finalStatus(d) !== 'validated') continue
      if ((d.transactionDate || '').slice(0, 7) !== month) continue
      const day = Number((d.transactionDate || '').slice(8, 10))
      if (day >= 1 && day <= lastDay) perDay[day] += metricValueOf(d, kind)
    }

    const out: { key: string; label: string; realizado: number | null; meta: number }[] = []
    let cum = 0
    for (let day = 1; day <= lastDay; day++) {
      cum += perDay[day]
      const isFuture = isCurrentMonth && day > todayDay
      const bdElapsed = countBusinessDays(y, mo, 1, day)
      const metaPace = bdTotal > 0 ? (metaMonth * bdElapsed) / bdTotal : 0
      out.push({
        key: `${month}-${String(day).padStart(2, '0')}`,
        label: String(day).padStart(2, '0'),
        realizado: isFuture ? null : cum,
        meta: metaPace,
      })
    }
    return out
  }, [granularity, month, scopedTransactions, metaForScope, kind])

  // Resumo do escopo pro cabeçalho.
  const summary = useMemo(() => {
    const meta = metaForScope(month)
    let realizado = 0
    for (const d of scopedTransactions) {
      if (finalStatus(d) !== 'validated') continue
      if ((d.transactionDate || '').slice(0, 7) !== month) continue
      realizado += metricValueOf(d, kind)
    }
    return { meta, realizado, pct: meta > 0 ? realizado / meta : 0 }
  }, [metaForScope, month, scopedTransactions, kind])

  // Ritmo do mês selecionado (cards no topo, mesmo layout do Forecast da Visão
  // geral): realizado × meta, meta diária, meta acumulada até hoje, gap e
  // quanto precisa por dia útil. Fim de semana = meta 0 (só acumula seg-sex).
  const forecast = useMemo(
    () => buildForecast(summary.realizado, summary.meta, month),
    [summary.realizado, summary.meta, month],
  )
  const daily = useMemo(
    () => buildForecastDaily(scopedTransactions, summary.meta, month, kind),
    [scopedTransactions, summary.meta, month, kind],
  )

  /* ------------------------------- cores ---------------------------------- */
  const grid = theme === 'dark' ? '#2b3139' : '#eef0f4'
  const axis = theme === 'dark' ? '#5e6673' : '#a1a8b8'
  const labelColor = theme === 'dark' ? '#eaecef' : '#0a0e1a'
  const tooltipBg = theme === 'dark' ? '#181a20' : '#ffffff'
  const tooltipBorder = theme === 'dark' ? '#2b3139' : '#e6e8ee'
  const metaColor = theme === 'dark' ? '#8a93a3' : '#9aa2b2'
  const realizadoColor = theme === 'dark' ? '#2dc08a' : '#12a06a'

  const barColor = (realizado: number, meta: number) => {
    const p = meta > 0 ? realizado / meta : 0
    if (p >= 1) return theme === 'dark' ? '#2dc08a' : '#12a06a'
    if (p >= 0.8) return theme === 'dark' ? '#f0b90b' : '#c9930a'
    return theme === 'dark' ? '#f6465d' : '#e23545'
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="tablist">
            {(['month', 'day'] as Granularity[]).map((g) => (
              <button
                key={g}
                role="tab"
                aria-selected={granularity === g}
                onClick={() => setGranularity(g)}
                className="seg-item"
              >
                {g === 'month' ? 'Mês' : 'Dia'}
              </button>
            ))}
          </div>
          <div className="seg" role="tablist">
            {(['geral', 'setor', 'colaborador'] as ScopeKind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={scopeKind === k}
                onClick={() => setScopeKind(k)}
                className="seg-item"
              >
                {k === 'geral' ? 'Geral' : k === 'setor' ? 'Time' : 'Colaborador'}
              </button>
            ))}
          </div>
          {scopeKind === 'setor' && (
            <select
              value={selectedSetor}
              onChange={(e) => setSelectedSetor(e.target.value as Setor)}
              className="rounded-md border border-app-border bg-app-card px-2 py-1 text-[11px] font-medium text-app-text"
            >
              {SETORES.map((s) => (
                <option key={s} value={s}>
                  {setorLabel[s]}
                </option>
              ))}
            </select>
          )}
          {scopeKind === 'colaborador' && (
            <select
              value={effectiveUid}
              onChange={(e) => setSelectedUid(e.target.value)}
              className="max-w-[170px] rounded-md border border-app-border bg-app-card px-2 py-1 text-[11px] font-medium text-app-text"
            >
              {colaboradores.length === 0 && <option value="">-</option>}
              {colaboradores.map((a) => (
                <option key={a.uid} value={a.uid}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10.5px] tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-[2px] rounded-sm" style={{ background: realizadoColor }} />
            <span className="text-app-subtle">Realizado</span>
            <span className="font-semibold text-app-text">{fmt(summary.realizado)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-[2px] rounded-sm" style={{ background: metaColor }} />
            <span className="text-app-subtle">Meta</span>
            <span className="font-semibold text-app-text">{fmt(summary.meta)}</span>
          </span>
          <span
            className={`font-semibold ${
              summary.pct >= 1
                ? 'text-emerald-600 dark:text-emerald-400'
                : summary.pct >= 0.8
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {(summary.pct * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Cards de ritmo do mês (mesmo layout do Forecast da Visão geral) */}
      <ForecastRitmoCards forecast={forecast} daily={daily} kind={kind} />

      {granularity === 'day' ? (
        // Modo Dia: mesmo gráfico da Visão geral (barras = realizado
        // acumulado, linha = meta acumulada; fim de semana sem meta).
        <ForecastChart daily={daily} meta={summary.meta} kind={kind} />
      ) : (
        // Modo Mês: histórico dos últimos 12 meses (barra por atingimento).
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={grid} strokeWidth={1} strokeOpacity={0.6} vertical={false} />
              <XAxis
                dataKey="label"
                stroke={axis}
                fontSize={9}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                minTickGap={6}
                height={22}
              />
              <YAxis
                stroke={axis}
                fontSize={9}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                width={40}
                tickFormatter={(v: number) =>
                  kind === 'ativacao' ? String(Math.round(v)) : compactUsd(v)
                }
              />
              <Tooltip
                wrapperStyle={{ zIndex: 50, outline: 'none' }}
                cursor={{ fill: theme === 'dark' ? '#ffffff08' : '#0000000a' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0]?.payload as
                    | { realizado: number | null; meta: number }
                    | undefined
                  if (!p) return null
                  const realizado = p.realizado ?? 0
                  const pct = p.meta > 0 ? (realizado / p.meta) * 100 : 0
                  return (
                    <div
                      style={{
                        background: tooltipBg,
                        border: `1px solid ${tooltipBorder}`,
                        borderRadius: 6,
                        padding: '7px 10px',
                        fontSize: 10.5,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        color: labelColor,
                        minWidth: 160,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 5 }}>{label}</div>
                      <TipRow label="Realizado" value={fmt(realizado)} color={realizadoColor} />
                      <TipRow label="Meta" value={fmt(p.meta)} color={metaColor} />
                      <TipRow
                        label="Atingido"
                        value={`${pct.toFixed(0)}%`}
                        color={pct >= 100 ? realizadoColor : pct >= 80 ? '#c9930a' : '#e23545'}
                      />
                    </div>
                  )
                }}
              />
              <Bar dataKey="realizado" name="Realizado" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.key} fill={barColor(d.realizado ?? 0, d.meta)} />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="meta"
                name="Meta"
                stroke={metaColor}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function compactUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

function TipRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '1px 0' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 2, height: 8, borderRadius: 1, background: color, display: 'inline-block' }} />
        <span style={{ opacity: 0.7 }}>{label}</span>
      </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}
