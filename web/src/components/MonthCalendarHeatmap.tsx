import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { commissionForTransaction, effectiveUsdAmount } from '../lib/commission'
import { formatMoney } from '../lib/format'
import { finalStatus } from '../types'
import type { Transaction } from '../types'

interface Props {
  transactions: Transaction[]
  /** 'agent' usa nomenclatura "Registro/Volume", sem comissão. 'admin' (default) mantém original. */
  viewMode?: 'admin' | 'agent'
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const WEEKDAY_FULL = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
]
const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

interface DayCell {
  kind: 'day'
  day: number
  iso: string
  weekday: number
  count: number
  totalUsd: number
  commissionUsd: number
  isToday: boolean
  isFuture: boolean
}
type Cell = DayCell | { kind: 'pad' }

interface HoverState {
  cell: DayCell
  x: number
  y: number
}

/**
 * Calendário do mês com heatmap por dia, célula fica mais intensa quanto mais
 * transações validadas foram registrados naquele dia (usando `createdAt`).
 *
 * - Navegação ◀/▶ entre meses (não passa do mês atual).
 * - Só conta transações com `finalStatus === 'validated'`.
 * - Tooltip nativo com contagem ao passar o mouse.
 * - Hoje destacado com ring accent.
 */
export function MonthCalendarHeatmap({ transactions, viewMode = 'admin' }: Props) {
  const isAgent = viewMode === 'agent'
  const [{ year, month }, setView] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  // Agrupa transações VALIDADOS por dia ISO (yyyy-mm-dd) usando `transactionDate`,
  // data em que a transação foi feito de fato pelo cliente. Cada dia acumula
  // count + totalUsd + comissão pra mostrar no tooltip.
  const { byDay, max, totalInMonth, totalUsdInMonth, commissionUsdInMonth } =
    useMemo(() => {
      const map = new Map<
        string,
        { count: number; totalUsd: number; commissionUsd: number }
      >()
      let totalCount = 0
      let totalUsdSum = 0
      let commissionSum = 0
      for (const d of transactions) {
        if (finalStatus(d) !== 'validated') continue
        if (!d.transactionDate) continue
        const [yStr, mStr] = d.transactionDate.split('-')
        const dy = Number(yStr)
        const dm = Number(mStr) - 1
        if (dy !== year || dm !== month) continue
        const key = d.transactionDate
        const bucket = map.get(key) ?? {
          count: 0,
          totalUsd: 0,
          commissionUsd: 0,
        }
        const usdAmt = effectiveUsdAmount(d)
        const com = commissionForTransaction(d)
        bucket.count += 1
        bucket.totalUsd += usdAmt
        bucket.commissionUsd += com.fixedUsd + com.percentage
        map.set(key, bucket)
        totalCount += 1
        totalUsdSum += usdAmt
        commissionSum += com.fixedUsd + com.percentage
      }
      let m = 0
      for (const v of map.values()) if (v.count > m) m = v.count
      return {
        byDay: map,
        max: m,
        totalInMonth: totalCount,
        totalUsdInMonth: totalUsdSum,
        commissionUsdInMonth: commissionSum,
      }
    }, [transactions, year, month])

  const cells = useMemo(() => buildCells(year, month, byDay), [year, month, byDay])

  const now = new Date()
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth()
  const canForward = !isCurrentMonth

  const goPrev = () =>
    setView(({ year: y, month: m }) =>
      m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 },
    )
  const goNext = () =>
    setView(({ year: y, month: m }) =>
      m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 },
    )

  const onHover = (e: React.MouseEvent, c: DayCell) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ cell: c, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  const onLeave = () => setHover(null)

  return (
    <div
      ref={containerRef}
      className="relative space-y-3"
      onMouseLeave={onLeave}
    >
      {/* Navegação + título */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          title="Mês anterior"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-app-border text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
        >
          <ChevronLeft size={13} />
        </button>
        <div className="text-center">
          <div className="text-[12px] font-semibold text-app-text">
            {MONTH_LABELS[month]} {year}
          </div>
          <div className="font-mono text-[10px] tabular-nums text-app-subtle">
            {totalInMonth} {isAgent ? 'verificado' : 'validado'}{totalInMonth === 1 ? '' : 's'}
            {totalUsdInMonth > 0 && (
              <>
                {' · '}
                {formatMoney(totalUsdInMonth)}
              </>
            )}
            {!isAgent && commissionUsdInMonth > 0 && (
              <>
                {' · '}
                <span className="text-teal-600 dark:text-teal-400">
                  comissão {formatMoney(commissionUsdInMonth)}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={goNext}
          disabled={!canForward}
          title={canForward ? 'Próximo mês' : 'Você está no mês atual'}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-app-border text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Grid de cabeçalho (D S T Q Q S S) */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((d, i) => (
          <div
            key={i}
            className="text-center font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-app-subtle"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) =>
          c.kind === 'pad' ? (
            <div key={i} />
          ) : (
            <CalendarCell
              key={i}
              cell={c}
              max={max}
              onMouseEnter={(e) => onHover(e, c)}
              onMouseMove={(e) => onHover(e, c)}
            />
          ),
        )}
      </div>

      {hover && (
        <CalendarTooltip
          hover={hover}
          year={year}
          month={month}
          containerRef={containerRef}
          isAgent={isAgent}
        />
      )}
    </div>
  )
}

function CalendarTooltip({
  hover,
  year,
  month,
  containerRef,
  isAgent,
}: {
  hover: HoverState
  year: number
  month: number
  containerRef: React.RefObject<HTMLDivElement | null>
  isAgent: boolean
}) {
  const tipRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    if (!tipRef.current) return
    setSize({ w: tipRef.current.offsetWidth, h: tipRef.current.offsetHeight })
  }, [hover.cell.iso])

  const cw = containerRef.current?.clientWidth ?? 0
  const ch = containerRef.current?.clientHeight ?? 0
  const offset = 12
  let left = hover.x + offset
  let top = hover.y + offset
  if (size) {
    if (hover.x + offset + size.w > cw - 4) left = Math.max(4, hover.x - offset - size.w)
    if (hover.y + offset + size.h > ch - 4) top = Math.max(4, hover.y - offset - size.h)
    left = Math.max(4, Math.min(left, cw - size.w - 4))
    top = Math.max(4, Math.min(top, ch - size.h - 4))
  }

  const c = hover.cell
  return (
    <div
      ref={tipRef}
      className="pointer-events-none absolute z-50 w-[220px] rounded-lg border border-app-border bg-app-card p-2.5 shadow-[var(--shadow-pop)]"
      style={{ left, top, opacity: size ? 1 : 0 }}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-app-border pb-1.5">
        <span className="text-[12px] font-semibold text-app-text">
          {String(c.day).padStart(2, '0')} de {MONTH_LABELS[month]}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-app-subtle">
          {year}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-app-subtle">
        {WEEKDAY_FULL[c.weekday]}
        {c.isToday && (
          <span className="ml-1 inline-flex items-center rounded bg-app-accent/15 px-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-app-accent-text">
            hoje
          </span>
        )}
        {c.isFuture && (
          <span className="ml-1 text-app-subtle">· no futuro</span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-app-muted">
            {isAgent ? 'Registros verificados' : 'Registros validados'}
          </span>
          <span
            className={`font-mono text-[15px] font-semibold tabular-nums tracking-[-0.01em] ${
              c.count > 0 ? 'text-app-text' : 'text-app-subtle'
            }`}
          >
            {c.count}
          </span>
        </div>
        {c.count > 0 && (
          <>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-app-muted">
                {isAgent ? 'Volume total' : 'Total transacionado'}
              </span>
              <span className="font-mono font-semibold tabular-nums text-app-text">
                {formatMoney(c.totalUsd)}
              </span>
            </div>
            {!isAgent && (
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-app-muted">Comissão calculada</span>
                <span className="font-mono font-semibold tabular-nums text-teal-600 dark:text-teal-400">
                  {formatMoney(c.commissionUsd)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CalendarCell({
  cell,
  max,
  onMouseEnter,
  onMouseMove,
}: {
  cell: DayCell
  max: number
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
}) {
  const intensity = max > 0 ? cell.count / max : 0
  const bg =
    cell.count === 0
      ? 'var(--app-elev)'
      : `color-mix(in oklab, var(--app-accent) ${Math.max(15, Math.round(intensity * 100))}%, var(--app-elev))`
  const ring = cell.isToday ? 'ring-1 ring-app-accent ring-offset-0' : ''
  const text =
    cell.isFuture ? 'text-app-subtle/60' : cell.count > 0 ? 'text-app-text' : 'text-app-muted'
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      className={`relative flex aspect-square cursor-default flex-col items-start justify-between rounded-md border border-app-border p-1 transition-colors hover:border-app-accent/60 ${ring}`}
      style={{ background: bg }}
    >
      <span className={`font-mono text-[10px] tabular-nums ${text}`}>
        {cell.day}
      </span>
      {cell.count > 0 && (
        <span className="self-end font-mono text-[11px] font-semibold tabular-nums text-app-text">
          {cell.count}
        </span>
      )}
    </div>
  )
}

function buildCells(
  year: number,
  month: number,
  byDay: Map<string, { count: number; totalUsd: number; commissionUsd: number }>,
): Cell[] {
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Cell[] = []

  // padding antes (até o primeiro dia)
  for (let i = 0; i < firstWeekday; i++) cells.push({ kind: 'pad' })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const iso = isoDate(date)
    const stats = byDay.get(iso) ?? { count: 0, totalUsd: 0, commissionUsd: 0 }
    cells.push({
      kind: 'day',
      day,
      iso,
      weekday: date.getDay(),
      count: stats.count,
      totalUsd: stats.totalUsd,
      commissionUsd: stats.commissionUsd,
      isToday: date.getTime() === today.getTime(),
      isFuture: date.getTime() > today.getTime(),
    })
  }

  // padding depois pra fechar a última semana
  while (cells.length % 7 !== 0) cells.push({ kind: 'pad' })

  return cells
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
