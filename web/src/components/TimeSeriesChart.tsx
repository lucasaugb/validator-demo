import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyMultiPoint, DailyPoint } from '../lib/metrics'
import { useTheme } from '../contexts/ThemeContext'

export interface SeriesConfig {
  key: 'count' | 'total' | 'verified' | 'invalid' | 'activations'
  label: string
  color: string
}

interface Props {
  data: DailyPoint[] | DailyMultiPoint[]
  height?: number
  series?: SeriesConfig[]
}

const DEFAULT_SERIES: SeriesConfig[] = [
  { key: 'count', label: 'Ativações', color: '#0ecb81' },
]

export function TimeSeriesChart({
  data,
  height = 260,
  series = DEFAULT_SERIES,
}: Props) {
  const { theme } = useTheme()
  const grid = theme === 'dark' ? '#2b3139' : '#e2e8f0'
  const axis = theme === 'dark' ? '#5e6673' : '#94a3b8'
  const tooltipBg = theme === 'dark' ? '#181a20' : '#ffffff'
  const tooltipBorder = theme === 'dark' ? '#2b3139' : '#e2e8f0'
  const tooltipLabel = theme === 'dark' ? '#eaecef' : '#0f172a'

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart
          data={data as object[]}
          margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient
                key={s.key}
                id={`grad-${s.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            stroke={axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tickFormatter={(v: string) => {
              const [, m, d] = v.split('-')
              return `${d}/${m}`
            }}
          />
          <YAxis
            stroke={axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            allowDecimals={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              borderRadius: 8,
              fontSize: 12,
              padding: '8px 10px',
            }}
            labelStyle={{
              color: tooltipLabel,
              marginBottom: 4,
              fontWeight: 600,
            }}
            labelFormatter={(v) => {
              if (typeof v !== 'string') return v
              const [y, m, d] = v.split('-')
              return `${d}/${m}/${y}`
            }}
          />
          {series.length > 1 && (
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: axis }}
            />
          )}
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
