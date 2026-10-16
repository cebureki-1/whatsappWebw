import { computeCropRect } from '../crop'
import { ArchiveError } from '../errors'
import type { CropMessage, CropResponse } from '../protocol'

chrome.runtime.onMessage.addListener((message: CropMessage, _sender, sendResponse: (response: CropResponse) => void) => {
  if (message?.source !== 'wa-archive' || message.target !== 'offscreen' || message.type !== 'CROP') return undefined
  void cropLocally(message).then(
    (buffer) => sendResponse({ ok: true, buffer }),
    (error: unknown) => {
      const archive = error instanceof ArchiveError ? error : null
      const detail = error instanceof Error ? error.message : ''
      sendResponse({
        ok: false,
        code: archive?.code ?? 'CROP_FAILED',
        message: archive?.message || detail || 'Не удалось обрезать снимок.',
      })
    },
  )
  return true
})

async function cropLocally(message: CropMessage): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(new Blob([message.buffer], { type: 'image/png' }))
  try {
    const crop = computeCropRect({
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
      viewportWidth: message.viewportWidth,
      viewportHeight: message.viewportHeight,
      rect: message.rect,
      trimTop: message.trimTop,
      trimBottom: message.trimBottom,
    })
    const canvas = new OffscreenCanvas(crop.width, crop.height)
    const context = canvas.getContext('2d')
    if (!context) throw new ArchiveError('CROP_FAILED', 'Браузер не дал холст для обрезки.')
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return blob.arrayBuffer()
  } finally {
    bitmap.close()
  }
}
