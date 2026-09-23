import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '../lib/format'
import type { CurrencyShare } from '../lib/metrics'

interface Props {
  mix: CurrencyShare[]
  title?: string
  subtitle?: string
}

// Paleta contida: USD = gold (moeda base, cor da marca), EUR/GBP em tons calmos
// que não brigam com o accent.
const colorOf: Record<string, string> = {
  USD: '#f0b90b',
  EUR: '#5b8def',
  GBP: '#8e97a8',
}

export function CurrencyMixCard({ mix, title = 'Mix de moedas', subtitle }: Props) {
  const hasData = mix.some((c) => c.amount > 0)
  const totalTransactions = mix.reduce((s, c) => s + c.count, 0)
  const dominant = [...mix].sort((a, b) => b.share - a.share)[0]

  return (
    <div className="surface p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-muted">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-[11px] text-app-subtle">{subtitle}</p>
          )}
        </div>
        {hasData && dominant && dominant.share > 0 && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-app-subtle">
              dominante
            </div>
            <div className="mt-0.5 text-sm font-medium tabular-nums text-app-text">
              {dominant.currency} · {(dominant.share * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="mt-4 rounded-md border border-dashed border-app-border px-4 py-8 text-center text-xs text-app-subtle">
          Sem registros no período
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-4">
          <div className="relative h-32 w-32 shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={mix.filter((c) => c.amount > 0)}
                  dataKey="amount"
                  innerRadius={38}
                  outerRadius={56}
                  paddingAngle={2}
                  strokeWidth={0}
                  isAnimationActive={false}
                >
                  {mix
                    .filter((c) => c.amount > 0)
                    .map((c) => (
                      <Cell key={c.currency} fill={colorOf[c.currency]} />
                    ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-lg font-semibold leading-none tabular-nums text-app-text">
                {totalTransactions}
              </div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.1em] text-app-subtle">
                registros
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            {mix.map((c) => (
              <div key={c.currency} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: colorOf[c.currency] }}
                />
                <span className="font-medium text-app-text">{c.currency}</span>
                <span className="ml-auto tabular-nums text-app-text">
                  {formatCurrency(c.amount, c.currency as 'USD' | 'EUR' | 'GBP')}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-app-subtle">
                  {(c.share * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
