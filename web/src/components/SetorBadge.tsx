import {
  Home,
  Infinity as InfinityIcon,
  Layers,
  MapPin,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Setor } from '../types'
import { setorLabel } from '../types'

/**
 * Cores de marca por setor (UX 2026-05-29). Usadas em tabelas e tags pra dar
 * leitura visual rápida do setor. Classes são strings ESTÁTICAS (não montadas
 * dinamicamente) pra o JIT do Tailwind incluí-las no bundle.
 *
 *   Premium                 → azul royal
 *   Starter                → amarelo esverdeado (lime)
 *   Online             → laranja
 *   Eventos           → marrom médio
 *   Premium/Starter          → teal (setor virtual de supervisor)
 *   Online/Eventos → âmbar/dourado (setor virtual de supervisor)
 */
interface SetorStyle {
  /** Badge completo: fundo tint + texto + ring. */
  badge: string
  /** Cor sólida do dot. */
  dot: string
  /** Só o texto colorido (pra uso inline em listas densas). */
  text: string
  /** Ícone do setor: dá identidade sem depender só da cor. */
  icon: LucideIcon
}

const SETOR_STYLE: Record<Setor, SetorStyle> = {
  premium: {
    badge: 'bg-blue-500/15 text-blue-700 ring-blue-500/30 dark:text-blue-300',
    dot: 'bg-blue-500',
    text: 'text-blue-700 dark:text-blue-300',
    icon: Users,
  },
  starter: {
    badge: 'bg-lime-500/15 text-lime-700 ring-lime-500/30 dark:text-lime-300',
    dot: 'bg-lime-500',
    text: 'text-lime-700 dark:text-lime-300',
    icon: Home,
  },
  online: {
    badge: 'bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300',
    dot: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-300',
    icon: InfinityIcon,
  },
  eventos: {
    badge: 'bg-[#9c6b3f]/15 text-[#8a5a30] ring-[#9c6b3f]/30 dark:text-[#cd9b6f]',
    dot: 'bg-[#9c6b3f]',
    text: 'text-[#8a5a30] dark:text-[#cd9b6f]',
    icon: MapPin,
  },
  premium_starter: {
    badge: 'bg-teal-500/15 text-teal-700 ring-teal-500/30 dark:text-teal-300',
    dot: 'bg-teal-500',
    text: 'text-teal-700 dark:text-teal-300',
    icon: Layers,
  },
  online_eventos: {
    badge: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    icon: Layers,
  },
}

export function setorStyle(setor: Setor): SetorStyle {
  return SETOR_STYLE[setor]
}

/**
 * Selo do setor: ícone + label em caixa alta compacta, no mesmo desenho dos
 * selos de cargo da sidebar. O dot pastel de antes saiu: dava um ar genérico
 * e o ícone identifica o setor mesmo sem depender da cor.
 */
export function SetorBadge({
  setor,
  size = 'sm',
  className = '',
}: {
  setor: Setor
  size?: 'xs' | 'sm'
  className?: string
}) {
  const st = SETOR_STYLE[setor]
  const Icon = st.icon
  const sizeCls =
    size === 'xs'
      ? 'gap-1 px-1.5 py-[2px] text-[9px]'
      : 'gap-1 px-1.5 py-[3px] text-[9.5px]'
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${st.badge} ${sizeCls} ${className}`}
    >
      <Icon size={size === 'xs' ? 9 : 10} strokeWidth={2.6} className="shrink-0" />
      {setorLabel[setor]}
    </span>
  )
}
