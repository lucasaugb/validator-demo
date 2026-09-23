import { useMemo } from 'react'
import type { HeatmapCell } from '../lib/metrics'

interface Props {
  cells: HeatmapCell[]
  /** Tamanho de cada célula em px (default 14). */
  cellSize?: number
  /** Mostra coluna de labels de hora (default true). */
  showHourLabels?: boolean
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Heatmap 7×24 (dia da semana × hora) mostrando intensidade de cadastros.
 * Estilo Ref C: células pequenas com gradiente verde, mais intenso = mais
 * transações. Hover mostra o valor real via `title` nativo.
 */
export function HourDayHeatmap({ cells, cellSize = 14, showHourLabels = true }: Props) {
  // Reindexa pra acesso O(1) por (weekday, hour)
  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0),
    )
    for (const c of cells) {
      g[c.weekday][c.hour] = c.count
    }
    return g
  }, [cells])

  const max = useMemo(() => {
    let m = 0
    for (const c of cells) if (c.count > m) m = c.count
    return m
  }, [cells])

  const total = useMemo(
    () => cells.reduce((sum, c) => sum + c.count, 0),
    [cells],
  )

  // Hora de pico (mais ativa no agregado)
  const peakHour = useMemo(() => {
    const byHour = Array.from({ length: 24 }, () => 0)
    for (const c of cells) byHour[c.hour] += c.count
    let h = 0
    let mx = -1
    for (let i = 0; i < 24; i++) {
      if (byHour[i] > mx) {
        mx = byHour[i]
        h = i
      }
    }
    return { hour: h, count: mx }
  }, [cells])

  // Mostra labels de hora a cada 3h pra economizar espaço (00, 03, 06, ... 21).
  const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21]

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div className="text-[11px] text-app-subtle">
          {total > 0
            ? `Pico às ${String(peakHour.hour).padStart(2, '0')}h (${peakHour.count})`
            : 'Sem atividade no período'}
        </div>
        <Legend max={max} />
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          {showHourLabels && (
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                {Array.from({ length: 24 }).map((_, h) => (
                  <th
                    key={h}
                    className="text-[9px] tabular-nums text-app-subtle"
                    style={{ width: cellSize, height: 14 }}
                  >
                    {hourLabels.includes(h)
                      ? String(h).padStart(2, '0')
                      : ''}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {Array.from({ length: 7 }).map((_, w) => (
              <tr key={w}>
                <td
                  className="pr-2 text-[10px] font-medium text-app-subtle"
                  style={{ height: cellSize, width: 28 }}
                >
                  {WEEKDAY_LABELS[w]}
                </td>
                {Array.from({ length: 24 }).map((_, h) => {
                  const v = grid[w][h]
                  const intensity = max > 0 ? v / max : 0
                  return (
                    <td
                      key={h}
                      title={`${WEEKDAY_LABELS[w]} ${String(h).padStart(2, '0')}:00, ${v} ${v === 1 ? 'registro' : 'registros'}`}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRadius: 3,
                        background: cellColor(intensity),
                      }}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function cellColor(t: number): string {
  // Sem dado: usa app-elev sutil pra "ausência".
  if (t === 0) return 'color-mix(in oklab, var(--app-border) 65%, transparent)'
  // Curva exponencial pra realçar valores intermediários.
  const eased = Math.pow(t, 0.6)
  const opacity = 0.18 + eased * 0.82
  return `color-mix(in oklab, var(--app-accent) ${(opacity * 100).toFixed(0)}%, transparent)`
}

function Legend({ max }: { max: number }) {
  const stops = [0.05, 0.25, 0.5, 0.75, 1]
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-app-subtle">
      <span>0</span>
      <div className="flex h-2.5 items-stretch overflow-hidden rounded-sm border border-app-border/60">
        {stops.map((s) => (
          <span
            key={s}
            style={{ width: 14, background: cellColor(s) }}
            aria-hidden
          />
        ))}
      </div>
      <span className="tabular-nums">{max}</span>
    </div>
  )
}
