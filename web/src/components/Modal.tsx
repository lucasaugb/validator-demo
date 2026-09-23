import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  width?: 'md' | 'lg' | 'xl' | '2xl' | '3xl'
}

const widthMap = {
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
  '3xl': 'max-w-4xl',
}

export function Modal({ open, onClose, title, subtitle, children, width = 'lg' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden
      />
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full ${widthMap[width]} flex-col border-l border-app-border bg-app-card shadow-[var(--shadow-elev)] transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-app-border bg-app-card px-6 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-subtle">
              Validator Demo · {sectionFromTitle(title)}
            </div>
            <h2
              id="modal-title"
              className="mt-1 truncate text-[17px] font-medium tracking-[-0.01em] text-app-text"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 truncate text-xs text-app-muted">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1.5 text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {open ? children : null}
        </div>
      </div>
    </>
  )
}

/** Deriva uma seção curta pra eyebrow do modal (acima do título). */
function sectionFromTitle(title: string): string {
  const t = title.toLowerCase()
  if (t.includes('registro')) return 'Registros'
  if (t.includes('transação') || t.includes('transaction')) return 'Registros'
  if (t.includes('edição') || t.includes('edita')) return 'Edição'
  if (t.includes('detalhe')) return 'Detalhes'
  if (t.includes('gestor') || t.includes('agente')) return 'Gestores'
  if (t.includes('excluir') || t.includes('exclus')) return 'Operação'
  return 'Operação'
}
