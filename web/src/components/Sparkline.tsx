import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts'

interface Props {
  data: { date: string; value: number }[]
  color?: string
  height?: number
  showTooltip?: boolean
}

export function Sparkline({
  data,
  color = '#22c55e',
  height = 38,
  showTooltip = false,
}: Props) {
  const id = `spark-${color.replace('#', '')}`
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showTooltip && (
            <Tooltip
              cursor={false}
              contentStyle={{
                background: 'var(--app-card)',
                border: '1px solid var(--app-border)',
                borderRadius: 6,
                fontSize: 11,
                padding: '4px 8px',
              }}
              labelFormatter={(v) => {
                if (typeof v !== 'string') return v
                const [y, m, d] = v.split('-')
                return `${d}/${m}/${y}`
              }}
              formatter={(value) => [`${Number(value)}`, '']}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
