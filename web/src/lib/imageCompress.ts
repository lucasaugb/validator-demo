/**
 * Comprime imagens no browser antes do upload (canvas resize + JPEG re-encode).
 * - Mantem proporcao.
 * - Maior lado limitado a maxSide (default 1600px).
 * - Qualidade JPEG 0.82.
 * - Se a imagem ja for menor que maxSide e estiver abaixo de targetSize, retorna como esta.
 *
 * Por que: comprovantes vindos de celular tipicamente sao 3-5MB. Reduzindo
 * pra ~300-500KB o upload fica ~10x mais rapido sem perda visivel de legibilidade.
 */
const MAX_SIDE_DEFAULT = 1600
const QUALITY_DEFAULT = 0.82
const SKIP_IF_BELOW_BYTES = 400 * 1024 // 400KB

export async function compressImage(
  file: File,
  maxSide = MAX_SIDE_DEFAULT,
  quality = QUALITY_DEFAULT,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.size <= SKIP_IF_BELOW_BYTES) return file

  const bitmap = await loadBitmap(file)
  const { width, height } = scaledDimensions(bitmap.width, bitmap.height, maxSide)

  if (width === bitmap.width && height === bitmap.height && file.type === 'image/jpeg') {
    bitmap.close?.()
    return file
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) return file

  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      // fallback abaixo
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Fake bitmap shim: only width/height + drawImage works
      resolve(img as unknown as ImageBitmap)
    }
    img.onerror = reject
    img.src = url
  })
}

function scaledDimensions(w: number, h: number, maxSide: number) {
  if (w <= maxSide && h <= maxSide) return { width: w, height: h }
  if (w >= h) {
    const r = maxSide / w
    return { width: maxSide, height: Math.round(h * r) }
  }
  const r = maxSide / h
  return { width: Math.round(w * r), height: maxSide }
}
