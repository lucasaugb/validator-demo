interface Day {
  weekday: number
  label: string
  count: number
}

interface Props {
  data: Day[]
}

/**
 * Mini gráfico de barras vertical mostrando intensidade de cadastros por dia
 * da semana. Pequeno o suficiente pra encaixar num card lateral.
 */
export function WeekdayChart({ data }: Props) {
  const max = Math.max(...data.map((d) => d.count), 1)
  const peakIdx = data.reduce(
    (acc, d, i) => (d.count > data[acc].count ? i : acc),
    0,
  )

  const totalDays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-end justify-between gap-2">
        {data.map((d, i) => {
          const h = (d.count / max) * 100
          const isPeak = i === peakIdx && d.count > 0
          const tooltip = `${totalDays[d.weekday]}: ${d.count} ${d.count === 1 ? 'registro' : 'registros'}${
            isPeak ? ' (pico da semana)' : ''
          }`
          return (
            <div
              key={d.weekday}
              className="group flex flex-1 flex-col items-center gap-1.5"
              title={tooltip}
            >
              <div className="relative flex h-24 w-full items-end">
                <div
                  className={`w-full rounded-t-md transition-all duration-500 group-hover:brightness-110 ${
                    isPeak
                      ? 'bg-green-500'
                      : d.count > 0
                        ? 'bg-app-elev'
                        : 'bg-app-elev/40'
                  }`}
                  style={{
                    height: `${h}%`,
                    minHeight: d.count > 0 ? '3px' : '1px',
                  }}
                />
              </div>
              <div className="text-[10px] font-medium uppercase text-app-subtle group-hover:text-app-text">
                {d.label}
              </div>
              <div className="text-[11px] tabular-nums text-app-text">{d.count}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
