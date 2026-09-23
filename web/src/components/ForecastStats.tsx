import {
  Bar,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { formatMetric, formatMetricCompact } from '../lib/format'
import type { Forecast, ForecastDaily } from '../lib/forecast'
import type { MetaKind } from '../types'

/**
 * Cards de RITMO do mês + barra de progresso, compartilhados entre o Forecast
 * da Visão Geral (`ForecastPanel`) e o gráfico Realizado × Meta da tela de
 * Metas (`MetaRealizadoChart`). Layout replicado do report do Power BI:
 * realizado acumulado × meta, realizado no dia, meta diária, meta acumulada até
 * hoje, gap vs meta acumulada e quanto precisa por dia útil restante.
 *
 * `kind` escolhe a MÉTRICA: 'transacao' (volume USD) ou 'ativacao' (contagem de
 * primeiras transações). A estrutura é a mesma nas duas, mudam só os rótulos e
 * a formatação dos números.
 *
 * `daily` pode ser null (ex.: "meu time" do agente, cujo realizado vem do
 * rollup sem detalhe por dia): aí os tiles dependentes de série viram "-".
 */
export function ForecastRitmoCards({
  forecast,
  daily,
  kind = 'transacao',
}: {
  forecast: Forecast
  daily: ForecastDaily | null
  kind?: MetaKind
}) {
  const { realized, meta, attainmentPct, isPastMonth } = forecast
  const hasMeta = meta > 0
  const remaining = Math.max(0, meta - realized)
  const todayLabel = daily?.points.find((p) => p.day === daily.todayDay)?.label
  const fmt = (v: number) => formatMetric(v, kind)
  const fmtC = (v: number) => formatMetricCompact(v, kind)
  // "Volume" no modo transação, "Ativações" no modo ativação.
  const noun = kind === 'ativacao' ? 'Ativações' : 'Volume'

  // Sem série diária = "Meu time" do gestor: o realizado vem do rollup agregado
  // (sem detalhe por dia nem por colaborador). Mostra SÓ como está a meta do
  // TIME que ele pertence: volume acumulado × meta + % atingido. Nada dos
  // outros colaboradores, nada de cards de ritmo vazios ("-").
  if (!daily) {
    return (
      <div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-app-border bg-app-border">
          <StatTile
            label={`${noun} do time (acumulado)`}
            value={fmtC(realized)}
            sub={hasMeta ? `de ${fmtC(meta)}` : undefined}
            accent
          />
          <StatTile
            label="Meta do time"
            value={hasMeta ? fmtC(meta) : '-'}
            sub="no mês"
          />
        </div>

        <ProgressBar attainmentPct={attainmentPct} meta={meta} hasMeta={hasMeta} kind={kind} />

        <div className="mt-2 text-[10.5px] text-app-subtle">
          {noun} do time no mês:{' '}
          <span className="font-mono font-semibold tabular-nums text-app-text">
            {fmt(realized)}
          </span>
          {hasMeta && (
            <>
              {' '}• Falta pra meta:{' '}
              <span className="font-mono font-semibold tabular-nums text-app-text">
                {fmt(remaining)}
              </span>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-app-border bg-app-border sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label={`${noun} (acumulado)`}
          value={fmtC(realized)}
          sub={hasMeta ? `de ${fmtC(meta)}` : undefined}
          accent
        />
        <StatTile
          label={`${noun} no dia`}
          value={daily && daily.todayDay > 0 ? fmtC(daily.realizedToday) : '-'}
          sub={daily && daily.todayDay > 0 ? todayLabel : undefined}
        />
        <StatTile
          label="Meta diária"
          value={daily ? fmtC(daily.metaDaily) : '-'}
          sub="por dia útil"
        />
        <StatTile
          label="Meta acumulada"
          value={daily ? fmtC(daily.metaAccumToday) : '-'}
          sub="até hoje"
        />
        <StatTile
          label="Gap vs meta acum."
          value={daily ? fmtC(daily.gapVsMetaAccum) : '-'}
          tone={daily ? (daily.gapVsMetaAccum >= 0 ? 'good' : 'bad') : undefined}
        />
        <StatTile
          label="Precisa por dia"
          value={daily && !isPastMonth ? fmtC(daily.neededPerDay) : '-'}
          sub={
            daily && !isPastMonth
              ? `${daily.businessDaysRemaining} dia${daily.businessDaysRemaining === 1 ? '' : 's'} úteis`
              : undefined
          }
          tone="warn"
        />
      </div>

      <ProgressBar attainmentPct={attainmentPct} meta={meta} hasMeta={hasMeta} kind={kind} />

      <div className="mt-2 text-[10.5px] text-app-subtle">
        {noun} no mês (total):{' '}
        <span className="font-mono font-semibold tabular-nums text-app-text">
          {fmt(realized)}
        </span>
        {hasMeta && (
          <>
            {' '}• Restante:{' '}
            <span className="font-mono font-semibold tabular-nums text-app-text">
              {fmt(remaining)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  accent,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'warn'
  accent?: boolean
}) {
  const valueCls =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-rose-600 dark:text-rose-400'
        : tone === 'warn'
          ? 'text-amber-600 dark:text-amber-400'
          : accent
            ? 'text-app-accent'
            : 'text-app-text'
  return (
    <div className="bg-app-card px-3 py-2.5">
      <div className="truncate text-[9.5px] font-medium uppercase tracking-[0.1em] text-app-subtle">
        {label}
      </div>
      <div className={`mt-1 font-mono text-[17px] font-semibold leading-none tabular-nums ${valueCls}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[9.5px] text-app-subtle">{sub}</div>}
    </div>
  )
}

export function ProgressBar({
  attainmentPct,
  meta,
  hasMeta,
  kind = 'transacao',
}: {
  attainmentPct: number
  meta: number
  hasMeta: boolean
  kind?: MetaKind
}) {
  // Largura da barra é capada em 100%; o rótulo mostra o % real (pode passar de 100).
  const pct = Math.min(100, Math.max(0, attainmentPct * 100))
  const rawPct = attainmentPct * 100
  const tone =
    attainmentPct >= 1
      ? 'bg-emerald-500'
      : attainmentPct >= 0.8
        ? 'bg-amber-500'
        : 'bg-app-accent'
  const toneText =
    attainmentPct >= 1
      ? 'text-emerald-600 dark:text-emerald-400'
      : attainmentPct >= 0.8
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-app-text'
  return (
    <div className="mt-3">
      {/* % atingido da meta: grande e legível (antes ficava escondido na barra). */}
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        {hasMeta ? (
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-[20px] font-bold leading-none tabular-nums ${toneText}`}>
              {rawPct.toFixed(0)}%
            </span>
            <span className="text-[10px] font-medium text-app-subtle">da meta atingida</span>
          </div>
        ) : (
          <span className="text-[11px] font-medium text-app-subtle">sem meta definida</span>
        )}
        {hasMeta && (
          <span className="font-mono text-[10.5px] font-semibold tabular-nums text-app-muted">
            meta {formatMetricCompact(meta, kind)}
          </span>
        )}
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-md bg-app-elev">
        <div className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------------- */
/* Gráfico: realizado acumulado (barras navy) × meta acumulada (linha vermelha)*/
/* Replica o report do Power BI. SEM linha de projeção. Compartilhado entre a   */
/* Visão geral e a tela de Metas.                                               */
/* --------------------------------------------------------------------------- */

export function ForecastChart({
  daily,
  meta,
  kind = 'transacao',
}: {
  daily: ForecastDaily
  meta: number
  kind?: MetaKind
}) {
  const { theme } = useTheme()
  const axis = theme === 'dark' ? '#5e6673' : '#a1a8b8'
  const labelColor = theme === 'dark' ? '#eaecef' : '#0a0e1a'
  const tooltipBg = theme === 'dark' ? '#181a20' : '#ffffff'
  const tooltipBorder = theme === 'dark' ? '#2b3139' : '#e6e8ee'
  // Barras = realizado (azul/navy); linha + rótulos = meta (vermelho), como no report.
  const realizadoColor = theme === 'dark' ? '#5b8fd6' : '#2f5f8f'
  const metaColor = theme === 'dark' ? '#f87171' : '#ef4444'

  const data = daily.points
  // Formatter dos rótulos do gráfico (assinatura do recharts: recebe o valor
  // renderizável). Dias futuros (realizedCum null) não recebem rótulo.
  const compact = (v: unknown): string =>
    v == null || v === '' ? '' : formatMetricCompact(Number(v), kind)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: realizadoColor }} />
          <span className="text-app-subtle">Realizado acumulado</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-sm" style={{ background: metaColor }} />
          <span className="text-app-subtle">Meta acumulada</span>
        </span>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              stroke={axis}
              fontSize={8}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              interval={0}
              height={20}
            />
            <YAxis hide domain={[0, Math.max(meta, 1) * 1.08]} />
            <Tooltip
              wrapperStyle={{ zIndex: 50, outline: 'none' }}
              cursor={{ fill: theme === 'dark' ? '#ffffff08' : '#0000000a' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0]?.payload as
                  | { label: string; realizedCum: number | null; metaCum: number; isWeekend: boolean }
                  | undefined
                if (!p) return null
                const realizado = p.realizedCum
                const pct = p.metaCum > 0 && realizado != null ? (realizado / p.metaCum) * 100 : 0
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
                      minWidth: 170,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 5 }}>
                      {p.label} (acumulado){p.isWeekend ? ' · fim de semana' : ''}
                    </div>
                    <TipRow
                      label="Realizado"
                      value={realizado == null ? '-' : formatMetric(realizado, kind)}
                      color={realizadoColor}
                    />
                    <TipRow
                      label="Meta"
                      value={formatMetric(p.metaCum, kind)}
                      color={metaColor}
                    />
                    {realizado != null && p.metaCum > 0 && (
                      <TipRow
                        label="do ritmo"
                        value={`${pct.toFixed(0)}%`}
                        color={pct >= 100 ? realizadoColor : pct >= 80 ? '#c9930a' : metaColor}
                      />
                    )}
                  </div>
                )
              }}
            />
            <Bar
              dataKey="realizedCum"
              name="Realizado"
              radius={[3, 3, 0, 0]}
              maxBarSize={26}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.day} fill={realizadoColor} />
              ))}
              <LabelList
                dataKey="realizedCum"
                position="top"
                formatter={compact}
                style={{ fill: realizadoColor, fontSize: 8, fontWeight: 600 }}
              />
            </Bar>
            <Line
              type="linear"
              dataKey="metaCum"
              name="Meta"
              stroke={metaColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="metaCum"
                position="top"
                formatter={compact}
                style={{ fill: metaColor, fontSize: 8, fontWeight: 600 }}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TipRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: color }} />
        {label}
      </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}
