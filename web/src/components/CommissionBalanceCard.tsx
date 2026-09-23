import { ArrowUpRight, Clock, Eye, EyeOff, Info, Wallet } from 'lucide-react'
import { useBalanceVisibility } from '../contexts/BalanceVisibilityContext'
import { formatMoney } from '../lib/format'

interface Props {
  /** Valor principal: total em USD a receber/pagar. */
  amountUsd: number
  /** Label do topo. Default "Comissão a receber". */
  label?: string
  /** Linha auxiliar (período/atualização). Ex.: "Maio 2026". */
  period?: string
  /** Breakdown opcional pra mostrar embaixo. */
  breakdown?: BreakdownItem[]
  /** Delta percentual vs período anterior. */
  deltaPct?: number | null
  /** Click no card inteiro (CTA). Ativa hover/cursor pointer. */
  onClick?: () => void
  /** Variante visual. `agent` é o saldo pessoal (acento mais forte). `admin` é
   *  o agregado da operação (tom mais neutro, sem cara de "seu saldo"). */
  variant?: 'agent' | 'admin'
  /** Aviso/disclaimer abaixo do número. Útil pra deixar claro que o valor é
   *  estimado/pendente de aprovação. Renderiza em tom amber. */
  note?: string
  /** Renderiza o botão de olhinho no header, consome o BalanceVisibility
   *  context (toggle global, controla TODOS os valores sensíveis da tela). */
  hideable?: boolean
}

interface BreakdownItem {
  label: string
  value: string
  tone?: 'paid' | 'pending' | 'lost' | 'info'
}

/**
 * Card destacado pra exibir o valor de comissão como um "saldo bancário":
 * label discreto, numerão grande, opcionalmente delta e breakdown. Pensado
 * pra ser o primeiro elemento da home, antes da stat strip, substitui a
 * célula seca de KPI quando o número precisa de peso emocional ("é o que
 * você vai receber").
 */
export function CommissionBalanceCard({
  amountUsd,
  label = 'Comissão a receber',
  period,
  breakdown,
  deltaPct,
  onClick,
  variant = 'agent',
  note,
  hideable,
}: Props) {
  const isAgent = variant === 'agent'
  // Estado global compartilhado entre TODOS os componentes "hideable" da tela,
  // um toggle aqui esconde também o CommissionPanel, etc. Cards que não são
  // sensíveis (Total Transacionado, agregados de operação) passam `hideable=false`
  // e ignoram o estado global.
  const { hidden: globalHidden, toggle } = useBalanceVisibility()
  const hidden = !!hideable && globalHidden
  const wrapperBase =
    'group relative overflow-hidden rounded-2xl border transition-shadow'
  const wrapperVariant = isAgent
    ? 'border-app-accent/30 bg-gradient-to-br from-[color-mix(in_oklab,var(--app-accent)_8%,var(--app-card))] via-app-card to-app-card shadow-[var(--shadow-elev)]'
    : 'border-app-border bg-app-card shadow-[var(--shadow-card)]'
  const clickable = onClick
    ? 'cursor-pointer hover:shadow-[var(--shadow-pop)]'
    : ''
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={`${wrapperBase} ${wrapperVariant} ${clickable}`}
    >
      {/* Brilho discreto no canto */}
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            isAgent
              ? 'color-mix(in oklab, var(--app-accent) 35%, transparent)'
              : 'color-mix(in oklab, var(--app-accent) 12%, transparent)',
        }}
        aria-hidden
      />

      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">
            <Wallet size={11} strokeWidth={2} className="text-app-accent-text" />
            <span>{label}</span>
            {period && (
              <>
                <span className="text-app-subtle">·</span>
                <span className="font-normal normal-case tracking-normal text-app-subtle">
                  {period}
                </span>
              </>
            )}
            {hideable && (
              <button
                type="button"
                onClick={(e) => {
                  // Evita disparar o onClick do card inteiro.
                  e.stopPropagation()
                  toggle()
                }}
                title={
                  hidden
                    ? 'Mostrar valores sensíveis'
                    : 'Ocultar valores sensíveis'
                }
                aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
                aria-pressed={hidden}
                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
              >
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
          </div>

          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono text-[44px] font-semibold leading-none tabular-nums tracking-[-0.025em] text-app-text">
              {hidden ? <HiddenValue /> : formatMoney(amountUsd)}
            </span>
            {!hidden &&
              deltaPct !== undefined &&
              deltaPct !== null &&
              isFinite(deltaPct) &&
              deltaPct !== 0 && <DeltaChip value={deltaPct} />}
          </div>

          {note && (
            <div className="mt-2 flex max-w-[440px] items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-200">
              <Info size={11} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <span>{note}</span>
            </div>
          )}
        </div>

        {onClick && (
          <div className="flex shrink-0 items-center gap-1 self-center rounded-md border border-app-border bg-app-card/60 px-2 py-1 text-[11px] font-medium text-app-muted transition-colors group-hover:bg-app-elev group-hover:text-app-text">
            <span>Ver detalhes</span>
            <ArrowUpRight size={12} strokeWidth={2.2} />
          </div>
        )}
      </div>

      {breakdown && breakdown.length > 0 && (
        <div className="relative grid grid-cols-2 gap-px border-t border-app-border bg-app-border md:grid-cols-4">
          {breakdown.map((item) => (
            <BreakdownCell key={item.label} item={item} hidden={hidden} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Bolinhas sólidas: substituem o número quando o usuário toggla o olhinho.
 * Estilo Nubank: círculos pretos cheios, sem decoração. Tamanho herda do
 * texto via `em`.
 */
export function HiddenDots({
  count = 6,
  size = 'lg',
}: {
  count?: number
  /** Tamanho relativo do em: combina com o texto à volta. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const dim =
    size === 'sm'
      ? '0.45em'
      : size === 'md'
        ? '0.55em'
        : size === 'xl'
          ? '0.7em'
          : '0.6em'
  const gap = size === 'sm' ? 3 : size === 'md' ? 4 : 6
  return (
    <span
      className="inline-flex items-center align-baseline text-app-muted"
      style={{ gap }}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="inline-block rounded-full bg-current"
          style={{ width: dim, height: dim }}
        />
      ))}
    </span>
  )
}

function HiddenValue() {
  return <HiddenDots count={6} size="xl" />
}

function BreakdownCell({
  item,
  hidden,
}: {
  item: BreakdownItem
  hidden?: boolean
}) {
  const tone =
    item.tone === 'paid'
      ? 'text-app-text'
      : item.tone === 'pending'
        ? 'text-amber-600 dark:text-amber-400'
        : item.tone === 'lost'
          ? 'text-app-subtle line-through'
          : 'text-app-muted'
  return (
    <div className="bg-app-card px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-app-subtle">
        {item.label}
      </div>
      <div className={`mt-1 font-mono text-[14px] font-medium tabular-nums ${tone}`}>
        {hidden ? <HiddenDots count={3} size="md" /> : item.value}
      </div>
    </div>
  )
}

function DeltaChip({ value }: { value: number }) {
  const positive = value > 0
  const cls = positive
    ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
    : 'text-rose-700 bg-rose-500/10 dark:text-rose-300'
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${cls}`}
    >
      <Clock size={9} strokeWidth={2.6} className="opacity-70" />
      {positive ? '+' : ''}
      {(value * 100).toFixed(0)}%
    </span>
  )
}

