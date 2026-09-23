/**
 * Avatar com fallback pra iniciais. Quando `photoUrl` chegar no Agente type
 * (futuro), o componente troca pra imagem real automaticamente.
 *
 * - `seed`: usado pra escolher uma cor consistente da paleta (mesmo agente,
 *   mesma cor entre sessões/views).
 * - `size`: diâmetro em px. Default 28.
 * - `rank`: opcional: quando 1/2/3 mostra um badge dourado/prata/bronze.
 */
interface Props {
  seed: string
  name: string
  photoUrl?: string
  size?: number
  rank?: number
}

const PALETTE = [
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
]

function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function initials(name: string): string {
  return (
    (name || '?')
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '-'
  )
}

export function Avatar({ seed, name, photoUrl, size = 28, rank }: Props) {
  const showBadge = rank != null && rank >= 1 && rank <= 3
  const badgeBg = rank === 1 ? '#fbbf24' : rank === 2 ? '#a3a3a3' : '#d97706'
  return (
    <div className="relative inline-block shrink-0">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="rounded-full border border-app-border object-cover"
        />
      ) : (
        <div
          style={{ width: size, height: size, fontSize: size * 0.36 }}
          className={`flex items-center justify-center rounded-full font-semibold ${pickColor(
            seed,
          )}`}
        >
          {initials(name)}
        </div>
      )}
      {showBadge && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none"
          style={{ background: badgeBg, color: '#0a0e1a' }}
        >
          {rank}
        </span>
      )}
    </div>
  )
}
