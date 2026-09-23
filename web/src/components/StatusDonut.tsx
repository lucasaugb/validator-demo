import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { useTheme } from '../contexts/ThemeContext'

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

interface Props {
  slices: DonutSlice[]
  /** Texto central: número grande. */
  centerValue: string
  /** Texto central pequeno (rótulo). */
  centerLabel: string
  size?: number
  /** Quando true, mostra valores absolutos na legenda. Default true. */
  showCounts?: boolean
  /** Função pra formatar o valor de cada fatia na legenda (default número). */
  formatLegend?: (value: number) => string
}

/**
 * Donut compacto com texto central. Estilo Apex: bordas finas, fatias coloridas,
 * legenda em coluna ao lado com valor absoluto e % do total.
 */
export function StatusDonut({
  slices,
  centerValue,
  centerLabel,
  size = 160,
  showCounts = true,
  formatLegend,
}: Props) {
  const { theme } = useTheme()
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const data = slices.filter((s) => s.value > 0)

  const trackColor = theme === 'dark' ? '#2b3139' : '#eef0f4'
  const labelColor = theme === 'dark' ? '#eaecef' : '#0a0e1a'
  const subColor = theme === 'dark' ? '#848e9c' : '#555c70'

  return (
    <div className="flex flex-wrap items-center justify-between gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer>
          {total === 0 ? (
            <PieChart>
              <Pie
                data={[{ value: 1 }]}
                dataKey="value"
                innerRadius="68%"
                outerRadius="98%"
                stroke="none"
                isAnimationActive={false}
              >
                <Cell fill={trackColor} />
              </Pie>
            </PieChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius="68%"
                outerRadius="98%"
                paddingAngle={data.length > 1 ? 2 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          style={{ color: labelColor }}
        >
          <div className="text-[22px] font-semibold leading-none tabular-nums tracking-tight">
            {centerValue}
          </div>
          <div
            className="mt-1 text-[10px] uppercase tracking-[0.14em]"
            style={{ color: subColor }}
          >
            {centerLabel}
          </div>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {slices.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-app-muted">
                {s.label}
              </span>
              {showCounts && (
                <span className="shrink-0 text-right font-medium tabular-nums text-app-text">
                  {formatLegend ? formatLegend(s.value) : s.value}
                </span>
              )}
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-app-subtle">
                {pct.toFixed(0)}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
