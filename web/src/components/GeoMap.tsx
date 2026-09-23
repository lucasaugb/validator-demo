import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Graticule,
  Sphere,
  ZoomableGroup,
} from 'react-simple-maps'
import { Map as MapIcon, Minus, Plus, RotateCcw, Table } from 'lucide-react'
import { numToIso2 } from '../lib/isoCodes'
import { formatCurrency } from '../lib/format'
import type { CountryRich } from '../lib/metrics'

// Topojson world atlas: countries-110m (~120kb). Importado uma vez, fica em
// cache do bundler.
import worldAtlas from 'world-atlas/countries-110m.json'

interface Props {
  countries: CountryRich[]
  /** Altura do mapa em px. Default 360. */
  height?: number
  /** 'agent' usa "Registros/Volume", esconde Comissão. 'admin' (default) mantém original. */
  viewMode?: 'admin' | 'agent'
}

interface HoverState {
  iso2: string
  data: CountryRich | null
  countryName: string
  // posição relativa ao container pra ancorar o tooltip
  x: number
  y: number
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const INITIAL_CENTER: [number, number] = [10, 20]
const INITIAL_ZOOM = 1.2

/**
 * Mapa-mundi com colorização proporcional ao volume de transações por país e
 * tooltip rico ao hover (estilo Power BI). Permite zoom (scroll, botões, pinça)
 * e pan (arrastar). Tooltip clampa nas bordas do container.
 *
 * Países sem transações no período são renderizados em cinza neutro mas ainda
 * aparecem no tooltip com "zero": facilita conferência sem confundir
 * visualmente quem teve atividade.
 */
export function GeoMap({ countries, height = 380, viewMode = 'admin' }: Props) {
  const isAgent = viewMode === 'agent'
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [mode, setMode] = useState<'map' | 'table'>('map')
  const [view, setView] = useState({
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
  })

  // Index por ISO-2 e cálculo do max pra normalização da escala de cor.
  const { byIso, max } = useMemo(() => {
    const map = new Map<string, CountryRich>()
    let m = 0
    for (const c of countries) {
      if (c.code === '??') continue
      map.set(c.code, c)
      if (c.transactions > m) m = c.transactions
    }
    return { byIso: map, max: m }
  }, [countries])

  // Total "Desconhecido" pra mostrar no rodapé do mapa.
  const unknown = useMemo(
    () => countries.find((c) => c.code === '??'),
    [countries],
  )

  const handleMove = (
    evt: React.MouseEvent,
    iso2: string,
    countryName: string,
  ) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({
      iso2,
      data: byIso.get(iso2) ?? null,
      countryName,
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    })
  }

  const onZoomIn = () =>
    setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.6) }))
  const onZoomOut = () =>
    setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom / 1.6) }))
  const onReset = () =>
    setView({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM })

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onMouseLeave={() => setHover(null)}
    >
      {/* Toggle Mapa / Tabela: `absolute` no modo mapa (flutua sobre o mapa,
          que não tem header), `relative` no modo tabela (in-flow, pra não
          sobrepor o cabeçalho da CountryTable) */}
      <div
        className={`seg ${
          mode === 'map' ? 'absolute left-2 top-2 z-10' : 'mb-2 inline-flex'
        }`}
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'map'}
          onClick={() => setMode('map')}
          className="seg-item inline-flex items-center gap-1"
        >
          <MapIcon size={11} /> Mapa
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'table'}
          onClick={() => setMode('table')}
          className="seg-item inline-flex items-center gap-1"
        >
          <Table size={11} /> Tabela
        </button>
      </div>

      {mode === 'table' ? (
        <CountryTable countries={countries} height={height + 24} isAgent={isAgent} />
      ) : (
      <div
        className="overflow-hidden rounded-md bg-app-elev/30"
        style={{ height: `${height}px` }}
      >
        <ComposableMap
          projectionConfig={{ scale: 155 }}
          style={{ width: '100%', height: '100%' }}
        >
          <ZoomableGroup
            center={view.center}
            zoom={view.zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onMoveEnd={(pos) =>
              setView({ center: pos.coordinates, zoom: pos.zoom })
            }
          >
            <Sphere
              id="sphere"
              fill="transparent"
              stroke="var(--app-border)"
              strokeWidth={0.4}
            />
            <Graticule stroke="var(--app-border)" strokeWidth={0.25} />
            <Geographies geography={worldAtlas as unknown as object}>
              {({ geographies }: { geographies: TopoFeature[] }) =>
                geographies.map((geo) => {
                  const iso2 = numToIso2(geo.id) ?? ''
                  const data = iso2 ? byIso.get(iso2) : undefined
                  const intensity = data ? intensityOf(data.transactions, max) : 0
                  const fill = colorForIntensity(intensity)
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={(e) =>
                        handleMove(e, iso2, geo.properties?.name ?? '-')
                      }
                      onMouseMove={(e) =>
                        handleMove(e, iso2, geo.properties?.name ?? '-')
                      }
                      style={{
                        default: {
                          fill,
                          stroke: 'var(--app-border)',
                          strokeWidth: 0.4,
                          outline: 'none',
                          cursor: 'default',
                          transition: 'fill 0.15s',
                        },
                        hover: {
                          fill: data
                            ? 'var(--app-accent)'
                            : 'color-mix(in oklab, var(--app-accent) 25%, var(--app-elev))',
                          stroke: 'var(--app-text)',
                          strokeWidth: 0.6,
                          outline: 'none',
                          cursor: data ? 'pointer' : 'default',
                        },
                        pressed: {
                          fill: 'var(--app-accent)',
                          outline: 'none',
                        },
                      }}
                    />
                  )
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
      </div>
      )}

      {/* Controles de zoom: só no modo mapa */}
      {mode === 'map' && (
        <>
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
            <ZoomBtn label="Aproximar" onClick={onZoomIn} disabled={view.zoom >= MAX_ZOOM}>
              <Plus size={13} strokeWidth={2.2} />
            </ZoomBtn>
            <ZoomBtn label="Afastar" onClick={onZoomOut} disabled={view.zoom <= MIN_ZOOM}>
              <Minus size={13} strokeWidth={2.2} />
            </ZoomBtn>
            <ZoomBtn label="Resetar zoom" onClick={onReset}>
              <RotateCcw size={11} strokeWidth={2.2} />
            </ZoomBtn>
          </div>
          <div className="absolute bottom-12 left-2 z-10 rounded-md border border-app-border bg-app-card/85 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-app-muted backdrop-blur-sm">
            {view.zoom.toFixed(1)}×
          </div>
        </>
      )}

      {/* Legenda + nota de Desconhecido, só no mapa */}
      {mode === 'map' && (
        <div className="mt-2 flex items-center justify-between gap-3 px-1">
          <Legend max={max} isAgent={isAgent} />
          {unknown && unknown.transactions > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-app-subtle">
              🌐 sem país: {unknown.transactions} registro{unknown.transactions === 1 ? '' : 's'}
              {' · '}
              {unknown.clients} cliente{unknown.clients === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {/* Tooltip flutuante */}
      {mode === 'map' && hover && (
        <Tooltip
          hover={hover}
          containerRef={containerRef}
          containerHeight={height}
          isAgent={isAgent}
        />
      )}
    </div>
  )
}

/* ----------------------------- subcomponents ----------------------------- */

/**
 * Visão tabular dos mesmos dados do tooltip do mapa, ordenada por transações
 * desc, com sticky header. Permite enxergar o ranking de país inteiro sem
 * precisar passar o mouse pelo mapa.
 */
function CountryTable({
  countries,
  height,
  isAgent,
}: {
  countries: CountryRich[]
  height: number
  isAgent: boolean
}) {
  const rows = useMemo(
    () =>
      [...countries].sort(
        (a, b) => b.transactions - a.transactions || b.clients - a.clients,
      ),
    [countries],
  )
  return (
    <div
      className="overflow-auto rounded-md border border-app-border bg-app-card"
      style={{ height: `${height}px` }}
    >
      <table className="w-full text-[11px] tabular-nums">
        <thead className="sticky top-0 bg-app-card shadow-[0_1px_0_var(--app-border)]">
          <tr className="text-app-subtle">
            <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.1em]">
              País
            </th>
            <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              Registros
            </th>
            <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              Clientes
            </th>
            <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              Verif.
            </th>
            {!isAgent && (
              <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
                Aprov.
              </th>
            )}
            <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              Pend.
            </th>
            <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              Inv.
            </th>
            <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              Ativ.
            </th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              {isAgent ? 'Volume total' : 'Total transacionado'}
            </th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.1em]">
              {isAgent ? 'Volume médio' : 'Ticket médio'}
            </th>
            {!isAgent && (
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.1em]">
                Comissão
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={isAgent ? 9 : 11}
                className="px-3 py-8 text-center text-app-subtle"
              >
                Sem dados no período.
              </td>
            </tr>
          )}
          {rows.map((c) => (
            <tr
              key={c.code}
              className="transition-colors hover:bg-app-elev/40"
            >
              <td className="px-3 py-1.5 text-app-text">
                <span className="inline-flex items-center gap-2">
                  <span className="text-base leading-none">{c.flag}</span>
                  <span className="truncate">{c.name}</span>
                  <span className="font-mono text-[9px] text-app-subtle">
                    {c.code === '??' ? '' : c.code}
                  </span>
                </span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-semibold text-app-text">
                {c.transactions}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-app-text">
                {c.clients}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-emerald-700 dark:text-emerald-400">
                {isAgent ? c.validated : c.verified}
              </td>
              {!isAgent && (
                <td className="px-2 py-1.5 text-right font-mono text-violet-700 dark:text-violet-400">
                  {c.approved}
                </td>
              )}
              <td className="px-2 py-1.5 text-right font-mono text-amber-700 dark:text-amber-400">
                {c.pending}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-rose-700 dark:text-rose-400">
                {c.invalid}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-teal-700 dark:text-teal-400">
                {c.activations}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-app-text">
                {c.totalValidatedUsd > 0
                  ? formatCurrency(c.totalValidatedUsd, 'USD')
                  : '-'}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-app-muted">
                {c.avgTicketUsd > 0
                  ? formatCurrency(c.avgTicketUsd, 'USD')
                  : '-'}
              </td>
              {!isAgent && (
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-teal-700 dark:text-teal-400">
                  {formatCurrency(c.commission.payableRawTotal, 'USD')}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ZoomBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-app-border bg-app-card text-app-muted shadow-[var(--shadow-card)] transition-colors hover:bg-app-elev hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/**
 * Tooltip ancorado no cursor, mas clampado pra nunca sair da área visível do
 * container do mapa. Mede o próprio tamanho via `useLayoutEffect` (render
 * "invisível" no primeiro frame, posicionado no segundo).
 */
function Tooltip({
  hover,
  containerRef,
  containerHeight,
  isAgent,
}: {
  hover: HoverState
  containerRef: React.RefObject<HTMLDivElement | null>
  containerHeight: number
  isAgent: boolean
}) {
  const tipRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    if (!tipRef.current) return
    setSize({
      w: tipRef.current.offsetWidth,
      h: tipRef.current.offsetHeight,
    })
  }, [hover.iso2])

  const containerW = containerRef.current?.clientWidth ?? 0
  const offset = 14
  const padding = 6

  let left = hover.x + offset
  let top = hover.y + offset
  if (size) {
    // Flip horizontal: se passar da borda direita, ancora à esquerda do cursor
    if (hover.x + offset + size.w > containerW - padding) {
      left = Math.max(padding, hover.x - offset - size.w)
    }
    // Clampa lateral final
    left = Math.min(left, containerW - size.w - padding)
    left = Math.max(left, padding)
    // Flip vertical contra a altura do mapa, não do container inteiro
    if (hover.y + offset + size.h > containerHeight - padding) {
      top = Math.max(padding, hover.y - offset - size.h)
    }
    top = Math.min(top, containerHeight - size.h - padding)
    top = Math.max(top, padding)
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: 260,
    pointerEvents: 'none',
    zIndex: 50,
    // Esconde no primeiro frame até medir
    opacity: size ? 1 : 0,
  }
  const d = hover.data
  return (
    <div
      ref={tipRef}
      style={style}
      className="rounded-lg border border-app-border bg-app-card p-3 shadow-[var(--shadow-pop)]"
    >
      <div className="mb-2 flex items-center gap-2 border-b border-app-border pb-2">
        <span className="text-base leading-none">
          {hover.iso2 ? flagOf(hover.iso2) : '🌐'}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-app-text">
            {d?.name ?? hover.countryName}
          </div>
          <div className="font-mono text-[10px] text-app-subtle">
            {hover.iso2 || '-'}
          </div>
        </div>
      </div>

      {d ? (
        <>
          <TooltipRow label="Registros" value={d.transactions} />
          <TooltipRow label="Clientes únicos" value={d.clients} />
          <div className="my-1.5 h-px bg-app-border" />
          <TooltipRow
            label="Validados (Sistema + Conversa)"
            value={d.validated}
            tone="emerald"
          />
          <TooltipRow label="Pendentes" value={d.pending} tone="amber" />
          <TooltipRow label="Inválidos" value={d.invalid} tone="rose" />
          <div className="my-1.5 h-px bg-app-border" />
          <TooltipRow
            label={isAgent ? 'Volume' : 'Total transacionado'}
            value={formatCurrency(d.totalValidatedUsd, 'USD')}
            valueMono
          />
          <TooltipRow label="Ativações" value={d.activations} tone="teal" />
          {!isAgent && (
            <>
              <div className="my-1.5 h-px bg-app-border" />
              <TooltipRow
                label="Comissão ativação"
                value={formatCurrency(d.commission.fixedUsd, 'USD')}
                tone="teal"
                valueMono
              />
              <TooltipRow
                label="Comissão 1%"
                value={formatCurrency(
                  d.commission.percentageByCurrency.USD +
                    d.commission.percentageByCurrency.EUR +
                    d.commission.percentageByCurrency.GBP,
                  'USD',
                )}
                tone="teal"
                valueMono
              />
              <TooltipRow
                label="Comissão geral"
                value={formatCurrency(d.commission.payableRawTotal, 'USD')}
                tone="teal"
                valueMono
              />
            </>
          )}
        </>
      ) : (
        <div className="py-1 font-mono text-[11px] text-app-subtle">
          {isAgent
            ? 'Sem registros neste país no período.'
            : 'Sem registros neste país no período.'}
        </div>
      )}
    </div>
  )
}

function TooltipRow({
  label,
  value,
  tone,
  valueMono = true,
}: {
  label: string
  value: number | string
  tone?: 'emerald' | 'violet' | 'amber' | 'rose' | 'teal'
  valueMono?: boolean
}) {
  const valueCls =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'violet'
        ? 'text-violet-600 dark:text-violet-400'
        : tone === 'amber'
          ? 'text-amber-600 dark:text-amber-400'
          : tone === 'rose'
            ? 'text-rose-600 dark:text-rose-400'
            : tone === 'teal'
              ? 'text-teal-600 dark:text-teal-400'
              : 'text-app-text'
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-app-muted">{label}</span>
      <span
        className={`${valueMono ? 'font-mono tabular-nums' : ''} font-medium ${valueCls}`}
      >
        {value}
      </span>
    </div>
  )
}

function Legend({ max }: { max: number; isAgent?: boolean }) {
  if (max <= 0) {
    return (
      <span className="font-mono text-[10px] tabular-nums text-app-subtle">
        Sem registros no período.
      </span>
    )
  }
  const stops = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="flex items-center gap-2 text-[10px] text-app-subtle">
      <span className="font-mono">0</span>
      <div className="flex h-2 w-32 overflow-hidden rounded-sm border border-app-border">
        {stops.map((s, i) => (
          <div
            key={i}
            className="h-full flex-1"
            style={{ background: colorForIntensity(s) }}
          />
        ))}
      </div>
      <span className="font-mono tabular-nums">{max}</span>
      <span className="ml-1">registros</span>
    </div>
  )
}

/**
 * Intensidade de cor por país numa escala LOGARÍTMICA. O Brasil domina o
 * volume, então uma escala linear empurraria todos os outros países pra perto
 * de zero (quase invisíveis). O log comprime o topo e levanta a base: o país
 * de maior volume satura no accent e os menores ficam numa tonalidade mais
 * fraca: porém ainda nítida graças ao piso em `colorForIntensity`.
 */
function intensityOf(value: number, max: number): number {
  if (!value || value <= 0 || max <= 0) return 0
  return Math.log1p(value) / Math.log1p(max)
}

/**
 * Escala de cor: usa o accent do tema, indo de cinza (0) a accent saturado
 * (1). Implementado via color-mix pra herdar o tema (claro/escuro). O piso de
 * 30% garante que qualquer país COM registro seja visível, sem competir em
 * peso visual com o líder (que chega aos 100%).
 */
function colorForIntensity(t: number): string {
  if (t <= 0) return 'var(--app-elev)'
  const pct = Math.min(100, Math.max(30, Math.round(t * 100)))
  return `color-mix(in oklab, var(--app-accent) ${pct}%, var(--app-elev))`
}

function flagOf(iso2: string): string {
  return iso2
    .toUpperCase()
    .split('')
    .map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65))
    .join('')
}

/* -------------------------- topojson type helper -------------------------- */

interface TopoFeature {
  rsmKey: string
  id: string
  properties: { name?: string }
}
