import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface Props {
  urls: string[]
  initial?: number
  onClose: () => void
}

export function ImageGallery({ urls, initial = 0, onClose }: Props) {
  const [index, setIndex] = useState(initial)

  useEffect(() => {
    setIndex(initial)
  }, [initial])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(urls.length - 1, i + 1))
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, urls.length])

  if (urls.length === 0) return null

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-8"
    >
      <button
        onClick={(e) => {
          stop(e)
          onClose()
        }}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        aria-label="Fechar"
      >
        <X size={20} />
      </button>

      {urls.length > 1 && index > 0 && (
        <button
          onClick={(e) => {
            stop(e)
            setIndex((i) => Math.max(0, i - 1))
          }}
          className="absolute left-4 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
          aria-label="Imagem anterior"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <img
        src={urls[index]}
        onClick={stop}
        className="max-h-full max-w-full cursor-default rounded-lg"
        alt={`Comprovante ${index + 1} de ${urls.length}`}
      />

      {urls.length > 1 && index < urls.length - 1 && (
        <button
          onClick={(e) => {
            stop(e)
            setIndex((i) => Math.min(urls.length - 1, i + 1))
          }}
          className="absolute right-4 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
          style={{ right: '4rem' }}
          aria-label="Próxima imagem"
        >
          <ChevronRight size={20} />
        </button>
      )}

      {urls.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  )
}
