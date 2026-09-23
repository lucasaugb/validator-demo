import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { COUNTRIES, countryByDial, searchCountries, type Country } from '../lib/countries'

interface Props {
  /** Dial code atual sem o "+", ex.: "55". */
  dial: string
  /** Número de telefone (sem o DDI). */
  phone: string
  onDialChange: (dial: string) => void
  onPhoneChange: (phone: string) => void
  /** Placeholder do input do número. */
  placeholder?: string
  /** Classe externa pra o container. */
  className?: string
  /** Mensagem de erro (renderizada por quem usa o componente). */
  inputId?: string
}

const inputCls =
  'rounded border border-app-border bg-app-input px-3 py-2 text-[13px] text-app-text outline-none transition-colors focus:border-app-border-strong'

/**
 * Picker de país (bandeira + DDI) + input de telefone, com lista completa
 * de países e busca por nome (pt/en), código ISO ou DDI.
 *
 * - Botão à esquerda mostra a bandeira + "+DDI". Clica e abre dropdown.
 * - Dropdown tem campo de busca no topo + lista virtualizada simples.
 * - Lista mostra país priorizado primeiro; quando há busca, ordem do match.
 */
export function CountryPhoneInput({
  dial,
  phone,
  onDialChange,
  onPhoneChange,
  placeholder = '11 99999-9999',
  className,
  inputId,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected: Country | undefined = useMemo(() => countryByDial(dial), [dial])
  const filtered = useMemo(() => searchCountries(query), [query])

  // Click fora fecha; ESC fecha.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Foca busca quando abre.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      // small delay para o input existir no DOM
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open])

  // Quando muda a busca, reseta cursor.
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  // Scroll do item ativo pra visível.
  useEffect(() => {
    if (!open) return
    const li = listRef.current?.children[activeIdx] as HTMLElement | undefined
    li?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const select = (c: Country) => {
    onDialChange(c.dial)
    setOpen(false)
  }

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[activeIdx]
      if (c) select(c)
    }
  }

  return (
    <div ref={wrapperRef} className={`relative flex gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${inputCls} flex shrink-0 items-center gap-1.5 hover:border-app-border-strong`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected ? `${selected.name} (+${selected.dial})` : 'Selecionar país'}
      >
        <span className="text-base leading-none">
          {selected?.flag ?? '🌐'}
        </span>
        <span className="font-mono text-[12px] tabular-nums text-app-muted">
          +{dial || '?'}
        </span>
        <ChevronDown size={12} className="text-app-subtle" />
      </button>

      <input
        id={inputId}
        type="tel"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} flex-1`}
        inputMode="tel"
        autoComplete="tel-national"
      />

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-[320px] overflow-hidden rounded-md border border-app-border bg-app-card shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
          <div className="border-b border-app-border bg-app-elev/40 p-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-subtle"
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="Buscar país, código ou DDI…"
                className="w-full rounded border border-app-border bg-app-input py-1.5 pl-7 pr-2 text-[12px] text-app-text outline-none focus:border-app-border-strong"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-app-subtle">
              Nenhum país encontrado.
            </div>
          ) : (
            <ul
              ref={listRef}
              role="listbox"
              className="max-h-[280px] overflow-y-auto py-1"
            >
              {filtered.map((c, i) => {
                const active = i === activeIdx
                const isSelected = c.dial === dial
                return (
                  <li
                    key={c.code}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => select(c)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] ${
                      active
                        ? 'bg-app-elev/70 text-app-text'
                        : 'text-app-text hover:bg-app-elev/40'
                    } ${isSelected ? 'font-medium' : ''}`}
                  >
                    <span className="shrink-0 text-base leading-none">{c.flag}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 font-mono tabular-nums text-app-subtle">
                      +{c.dial}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-app-border bg-app-elev/40 px-3 py-1.5 text-[10px] text-app-subtle">
            {filtered.length} de {COUNTRIES.length} países · ↑↓ navega · Enter seleciona
          </div>
        </div>
      )}
    </div>
  )
}
