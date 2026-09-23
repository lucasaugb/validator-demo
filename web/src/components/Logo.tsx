/**
 * Logo do Validator: badge "V verificado" renderizado inline pra ADAPTAR à
 * cor do sistema (usa as CSS vars do accent). Assim acompanha o tema gold
 * Binance automaticamente em vez de uma cor crua fixa. O favicon da aba é a
 * versão estática equivalente em `public/favicon.svg`.
 */
export function Logo({
  size = 36,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 select-none ${className}`}
      role="img"
      aria-label="Validator Demo"
    >
      {/* Quadrado gold (cor do sistema) */}
      <rect width="64" height="64" rx="14" fill="var(--app-accent)" />
      {/* Check (V) CENTRADO: bounding box ~32,32 no meio do quadrado */}
      <path
        d="M19 30 L29 42 L45 23"
        stroke="var(--app-accent-fg)"
        strokeWidth="5.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Selo "verificado": círculo escuro no canto + check gold dentro */}
      <circle cx="49" cy="15" r="7.5" fill="var(--app-accent-fg)" />
      <path
        d="M45.5 15 L48 17.5 L52.5 12"
        stroke="var(--app-accent)"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
