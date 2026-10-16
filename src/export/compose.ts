import { maxStripPixels } from './layout'
import { matchAdvance, scrollAdvance } from './stitch'

export interface ComposeFrame {
  index: number
  capturedAt: string
  scrollTop: number
  viewHeight?: number
  png: Blob
}

export interface ContinuousSlice {
  index: number
  capturedAt: string
  scrollTop: number
  png: Uint8Array
}

interface Strip {
  bitmap: ImageBitmap
  drawHeight: number
  capturedAt: string
  scrollTop: number
}

export async function composeContinuous(frames: ComposeFrame[]): Promise<ContinuousSlice[]> {
  const ordered = [...frames].sort((left, right) => left.index - right.index)
  if (ordered.length === 0) return []
  const slices: ContinuousSlice[] = []
  let pending: Strip[] = []
  let pendingHeight = 0
  let targetWidth = 0
  let previous: { rows: number[]; scrollTop: number; viewHeight: number; imageHeight: number } | null = null

  const flush = async (): Promise<void> => {
    if (pending.length === 0 || pendingHeight < 1 || targetWidth < 1) return
    const png = await paintSlice(pending, targetWidth, pendingHeight)
    const first = pending[0]!
    slices.push({
      index: slices.length + 1,
      capturedAt: first.capturedAt,
      scrollTop: first.scrollTop,
      png,
    })
    for (const strip of pending) strip.bitmap.close()
    pending = []
    pendingHeight = 0
  }

  try {
    for (const frame of ordered) {
      const bitmap = await createImageBitmap(frame.png)
      try {
        if (targetWidth < 1) targetWidth = bitmap.width
        const limit = maxStripPixels(targetWidth)
        const rows = await rowSignature(bitmap)
        const estimate = previous
          ? scrollAdvance(
              { scrollTop: previous.scrollTop, viewHeight: previous.viewHeight, imageHeight: previous.imageHeight },
              { scrollTop: frame.scrollTop, viewHeight: frame.viewHeight ?? 0, imageHeight: bitmap.height },
            )
          : bitmap.height
        const advance = previous ? matchAdvance(previous.rows, rows, estimate) : bitmap.height
        previous = {
          rows,
          scrollTop: frame.scrollTop,
          viewHeight: frame.viewHeight ?? 0,
          imageHeight: bitmap.height,
        }
        if (advance < 1) continue
        const scale = targetWidth / Math.max(1, bitmap.width)
        const stripTop = bitmap.height - advance
        let consumed = 0
        while (consumed < advance) {
          if (limit - pendingHeight < 8 && pendingHeight > 0) await flush()
          const take = Math.min(advance - consumed, Math.max(1, limit - pendingHeight))
          const strip = await createImageBitmap(bitmap, 0, stripTop + consumed, bitmap.width, take)
          const drawHeight = Math.max(1, Math.round(take * scale))
          pending.push({ bitmap: strip, drawHeight, capturedAt: frame.capturedAt, scrollTop: frame.scrollTop })
          pendingHeight += drawHeight
          consumed += take
          if (pendingHeight >= limit) await flush()
        }
      } finally {
        bitmap.close()
      }
    }
    await flush()
  } catch (error) {
    for (const strip of pending) strip.bitmap.close()
    throw error
  }
  return slices
}

async function paintSlice(strips: Strip[], width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Браузер не смог собрать непрерывную ленту.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  let y = 0
  for (const strip of strips) {
    context.drawImage(strip.bitmap, 0, y, width, strip.drawHeight)
    y += strip.drawHeight
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

async function rowSignature(bitmap: ImageBitmap): Promise<number[]> {
  const width = 24
  const canvas = new OffscreenCanvas(width, bitmap.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.drawImage(bitmap, 0, 0, width, bitmap.height)
  const data = context.getImageData(0, 0, width, bitmap.height).data
  const rows: number[] = []
  for (let y = 0; y < bitmap.height; y += 1) {
    let sum = 0
    const start = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const offset = start + x * 4
      sum += (data[offset] ?? 0) * 0.3 + (data[offset + 1] ?? 0) * 0.59 + (data[offset + 2] ?? 0) * 0.11
    }
    rows.push(Math.round(sum / width))
  }
  return rows
}
