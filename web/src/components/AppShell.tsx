import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Briefcase,
  Crown,
  LogOut,
  Menu,
  Shield,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { ThemeToggle } from './ThemeToggle'
import { NotificationBell } from './NotificationBell'
import { setorLabel as setorLabelMap } from '../types'
import { Avatar } from './Avatar'
import { Logo } from './Logo'
import { APP_ATTRIBUTION, APP_VERSION, APP_VERSION_DATE } from '../lib/version'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Quando setado, agrupa o item numa seção. Itens sem `group` vão pra "Menu". */
  group?: string
  /** Quando >0, renderiza um chip pequeno à direita do label (ex.: edições pendentes). */
  badge?: number
}

interface Props {
  nav: NavItem[]
  /** Slot opcional na sidebar entre o nav e o usuário, bom pra "Quick Stats". */
  sidebarExtras?: ReactNode
  children: ReactNode
}

/**
 * Shell estilo Apex Banking: sidebar fixa à esquerda com bloco de logo no topo
 * (quadrado colorido + texto), grupos de nav separados, slot opcional pra stats
 * rápidas, e bloco de usuário no rodapé. Topbar mobile colapsável.
 */
export function AppShell({ nav, sidebarExtras, children }: Props) {
  const { agente, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => setMobileOpen(false), [location.pathname])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Rótulo do cargo: curto de propósito. O setor NÃO entra aqui (um
  // "Supervisor · Online/Eventos" estouraria a largura do selo no rail
  // estreito); ele aparece numa linha própria logo abaixo, truncado.
  const roleLabel =
    agente?.role === 'super_admin'
      ? 'Super Admin'
      : agente?.role === 'admin'
        ? 'Admin'
        : agente?.role === 'supervisor'
          ? 'Supervisor'
          : 'Gestor'
  const setorText = agente?.setor ? setorLabelMap[agente.setor] : null

  // Selo de cargo do rodapé: cada papel ganha ícone + cor própria pra ter
  // identidade de relance. Super Admin em dourado com coroa (é o dono do
  // sistema), Admin em azul com escudo, Supervisor em teal, Gestor em verde.
  // Cores fixas (sem variants `dark:`) porque a sidebar é sempre escura.
  const roleStyle: { icon: LucideIcon; cls: string } =
    agente?.role === 'super_admin'
      ? {
          icon: Crown,
          cls: 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30',
        }
      : agente?.role === 'admin'
        ? {
            icon: ShieldCheck,
            cls: 'bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/30',
          }
        : agente?.role === 'supervisor'
          ? {
              icon: Shield,
              cls: 'bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/30',
            }
          : {
              icon: Briefcase,
              cls: 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30',
            }
  const RoleIcon = roleStyle.icon

  // Pro avatar do rodapé: usa foto do usuário quando setada, senão cai no
  // fallback de iniciais coloridas (Avatar.tsx faz isso sozinho).
  const profilePath = agente?.role === 'agente' ? '/agente/perfil' : '/admin/perfil'

  // Agrupa itens: default group "Menu" para os sem grupo, depois quaisquer outros.
  const groups = groupNavItems(nav)

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <BrandBlock />
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1.5 text-app-muted hover:bg-app-elev hover:text-app-text lg:hidden"
          aria-label="Fechar menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Faixa de metadados: ambiente, versão e data do build. Dá a cara de
          "sistema instalado" da referência sem custar espaço de navegação. */}
      <div className="flex items-center gap-1.5 border-y border-app-border/70 px-4 py-2">
        <span className="rounded bg-app-accent/15 px-1.5 py-[3px] font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-app-accent-text ring-1 ring-app-accent/25">
          Demo
        </span>
        <span className="rounded bg-app-elev px-1.5 py-[3px] font-mono text-[9px] font-semibold tabular-nums text-app-muted ring-1 ring-app-border">
          v{APP_VERSION}
        </span>
        <span className="ml-auto font-mono text-[9px] tabular-nums text-app-subtle">
          {formatVersionDate(APP_VERSION_DATE)}
        </span>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {groups.map((g) => (
          <NavGroup
            key={g.label}
            label={g.label}
            items={g.items}
            // Esconde o label da seção quando só existe um grupo, evita um
            // header solto "Menu" sobre o único bloco de nav.
            hideLabel={groups.length === 1}
          />
        ))}

        {sidebarExtras && (
          <div className="space-y-2">
            <SectionLabel text="Resumo" />
            <div className="px-2">{sidebarExtras}</div>
          </div>
        )}
      </nav>

      {/* Bloco do usuário: avatar + nome + selo do cargo. O crédito "PBI"
          saiu daqui: agora vive como tagline no cabeçalho (igual à referência),
          então não fica duplicado. */}
      <div className="border-t border-app-border p-2.5">
        <div className="flex items-center gap-2.5 rounded-lg px-1 py-1">
          <button
            type="button"
            onClick={() => navigate(profilePath)}
            title="Editar perfil"
            className="shrink-0 rounded-full ring-offset-2 ring-offset-app-card transition focus:outline-none focus:ring-2 focus:ring-app-accent"
            aria-label="Editar perfil"
          >
            <Avatar
              seed={agente?.uid ?? agente?.email ?? 'me'}
              name={agente?.name ?? '-'}
              photoUrl={agente?.avatarUrl}
              size={34}
            />
          </button>
          <button
            type="button"
            onClick={() => navigate(profilePath)}
            className="min-w-0 flex-1 cursor-pointer text-left"
            title="Editar perfil"
          >
            <div className="truncate text-[12.5px] font-medium leading-tight text-app-text">
              {agente?.name}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] ${roleStyle.cls}`}
              >
                <RoleIcon size={9} strokeWidth={2.6} />
                {roleLabel}
              </span>
              {setorText && (
                <span className="truncate text-[9.5px] text-app-subtle">
                  {setorText}
                </span>
              )}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              title="Sair"
              className="rounded-md p-1.5 text-app-muted transition-colors hover:bg-app-elev hover:text-red-400"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>

    </>
  )

  return (
    <div className="min-h-full">
      {/* Rail escuro flush full-height: cara de ERP. `rail dark`: paleta navy
          fixa (via .rail) + variants dark: ativos sobre o navy no tema claro. */}
      <aside className="rail dark fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-app-border bg-app-card shadow-[var(--shadow-card)] lg:flex">
        {sidebarContent}
      </aside>

      <div
        onClick={() => setMobileOpen(false)}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden
      />

      <aside
        className={`rail dark fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-app-border bg-app-card shadow-2xl transition-transform duration-200 lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      <main className="flex min-h-screen flex-col overflow-x-hidden lg:pl-64">
        <div className="flex items-center justify-between gap-2 border-b border-app-border bg-app-card px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-app-muted hover:bg-app-elev hover:text-app-text"
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <BrandBlock compact />
          <button
            type="button"
            onClick={() => navigate(profilePath)}
            title="Editar perfil"
            className="shrink-0 rounded-full ring-offset-2 ring-offset-app-card focus:outline-none focus:ring-2 focus:ring-app-accent"
          >
            <Avatar
              seed={agente?.uid ?? agente?.email ?? 'me'}
              name={agente?.name ?? '-'}
              photoUrl={agente?.avatarUrl}
              size={32}
            />
          </button>
        </div>

        <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-6">
          {children}
        </div>
      </main>
    </div>
  )
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Quando true, mostra search + bell. Default true em desktop. */
  showQuickBar?: boolean
}

/**
 * Header das páginas: título + saudação à esquerda, search/bell/actions à direita,
 * estilo "Welcome back" do Apex.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  showQuickBar = true,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      {/* Título: sem `truncate` nem `min-w-0`, esses combinados deixavam o
          h1 caindo pra "..." quando as actions à direita ocupavam muita
          largura. Como "Visão geral" e demais títulos são curtos, vale mais
          deixar o título sempre legível e permitir que as actions quebrem
          pra linha de baixo quando precisar. (#bug 2026-05-26) */}
      <div className="shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-app-text">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-app-muted first-letter:capitalize">
            {subtitle}
          </p>
        )}
      </div>
      {/* Bell vai DEPOIS das actions pra não ficar isolado numa linha em cima
          quando as actions (filtros, CSV, etc.) preenchem a row em telas
          intermediárias. Mantém tudo na mesma linha sempre que cabe. */}
      <div className="flex flex-wrap items-center gap-2">
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
        {showQuickBar && <NotificationBell />}
      </div>
    </div>
  )
}

/* ----------------------------- subcomponents ----------------------------- */

/** Data da versão (ISO) → "13.08.2026" (formato da referência). */
function formatVersionDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function BrandBlock({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo size={compact ? 30 : 32} />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[14px] font-semibold tracking-tight text-app-text">
            Validator Demo
          </div>
          {/* Tagline no lugar da linha de versão, a versão foi pra faixa de
              metadados logo abaixo, como na referência. */}
          <div className="mt-[3px] truncate text-[7.5px] font-semibold uppercase tracking-[0.13em] text-app-subtle">
            {APP_ATTRIBUTION}
          </div>
        </div>
      )}
    </div>
  )
}

/** Rótulo de seção com filete à direita, separa os blocos do menu. */
function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-2">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-app-subtle">
        {text}
      </span>
      <div className="h-px flex-1 bg-app-border/70" />
    </div>
  )
}

interface Group {
  label: string
  items: NavItem[]
}

function groupNavItems(nav: NavItem[]): Group[] {
  const map = new Map<string, NavItem[]>()
  for (const item of nav) {
    const key = item.group ?? 'Menu'
    const arr = map.get(key) ?? []
    arr.push(item)
    map.set(key, arr)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}

function NavGroup({
  label,
  items,
  hideLabel,
}: {
  label: string
  items: NavItem[]
  hideLabel?: boolean
}) {
  return (
    <div className="space-y-0.5">
      {!hideLabel && <SectionLabel text={label} />}
      {items.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `group relative flex items-center gap-2.5 rounded-lg py-2 pl-3.5 pr-2.5 text-[12.5px] transition-colors ${
                isActive
                  ? 'bg-app-elev text-app-text shadow-[inset_0_0_0_1px_var(--app-border)]'
                  : 'text-app-muted hover:bg-app-elev/50 hover:text-app-text'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* Barra de destaque do item ativo. Elemento real (não
                    pseudo-elemento): no Tailwind v4 os variants `before:`
                    já deram dor de cabeça neste projeto. */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-app-accent"
                    aria-hidden
                  />
                )}
                <Icon
                  size={15}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={isActive ? 'text-app-accent-text' : 'text-app-muted'}
                />
                <span className={`flex-1 truncate ${isActive ? 'font-medium' : ''}`}>
                  {item.label}
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded bg-app-neg px-1 font-mono text-[9.5px] font-bold tabular-nums text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        )
      })}
    </div>
  )
}
