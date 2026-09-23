import { ChevronRight } from 'lucide-react'

export interface AvatarRow {
  id: string
  primary: string
  /** Linha secundária (email, setor, hint). */
  secondary?: string
  /** Linhas de valor à direita (uma por moeda, ou só um string). */
  values: string[]
  onClick?: () => void
}

interface Props {
  rows: AvatarRow[]
  emptyText?: string
  /** Mostra um ícone de chevron à direita quando clicável. Default true. */
  showChevron?: boolean
  /** Override do conteúdo do avatar: default usa iniciais. */
  renderAvatar?: (row: AvatarRow, index: number) => React.ReactNode
}

const PALETTE = [
  'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
]

function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '-'
  )
}

/**
 * Lista de itens com avatar circular (iniciais) à esquerda, nome+hint no centro,
 * valor à direita: estilo "Top Payees" do Apex.
 */
export function AvatarList({
  rows,
  emptyText = 'Sem dados no período.',
  showChevron = true,
  renderAvatar,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-app-subtle">
        {emptyText}
      </div>
    )
  }
  return (
    <ul className="divide-y divide-app-border/70">
      {rows.map((r, i) => {
        const inner = (
          <>
            {renderAvatar ? (
              renderAvatar(r, i)
            ) : (
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${pickColor(
                  r.id,
                )}`}
              >
                {initials(r.primary)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-app-text">
                {r.primary}
              </div>
              {r.secondary && (
                <div className="truncate text-[11px] text-app-subtle">
                  {r.secondary}
                </div>
              )}
            </div>
            <div className="shrink-0 text-right">
              {r.values.length === 0 ? (
                <span className="text-xs text-app-subtle">-</span>
              ) : (
                r.values.map((v, j) => (
                  <div
                    key={j}
                    className="text-[13px] font-semibold tabular-nums text-app-text"
                  >
                    {v}
                  </div>
                ))
              )}
            </div>
            {showChevron && r.onClick && (
              <ChevronRight size={14} className="shrink-0 text-app-subtle" />
            )}
          </>
        )

        if (r.onClick) {
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={r.onClick}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-app-elev/60"
              >
                {inner}
              </button>
            </li>
          )
        }
        return (
          <li
            key={r.id}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            {inner}
          </li>
        )
      })}
    </ul>
  )
}
