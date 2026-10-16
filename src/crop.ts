import { ArchiveError } from './errors'
import type { Geometry } from './types'

export interface PixelCrop {
  x: number
  y: number
  width: number
  height: number
  scaleX: number
  scaleY: number
}

export function computeCropRect(input: {
  imageWidth: number
  imageHeight: number
  viewportWidth: number
  viewportHeight: number
  rect: { x: number; y: number; width: number; height: number }
  trimTop?: number
  trimBottom?: number
}): PixelCrop {
  const { imageWidth, imageHeight, viewportWidth, viewportHeight, rect } = input
  if (viewportWidth < 2 || viewportHeight < 2) {
    throw new ArchiveError('CROP_FAILED', 'Не удалось определить размер окна.')
  }
  if (imageWidth < 2 || imageHeight < 2) {
    throw new ArchiveError('CROP_FAILED', 'Снимок вкладки пустой.')
  }
  const scaleX = imageWidth / viewportWidth
  const scaleY = imageHeight / viewportHeight
  const divergence = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY)
  if (divergence > 0.08) {
    throw new ArchiveError(
      'GEOMETRY_CHANGED',
      'Масштаб снимка не совпал с размером окна. Задача поставлена на паузу, чтобы не обрезать кадр наугад.',
    )
  }
  const trimTop = Math.max(0, input.trimTop ?? 0)
  const trimBottom = Math.max(0, input.trimBottom ?? 0)
  const x0 = clamp(rect.x, 0, viewportWidth)
  const y0 = clamp(rect.y + trimTop, 0, viewportHeight)
  const x1 = clamp(rect.x + rect.width, 0, viewportWidth)
  const y1 = clamp(rect.y + rect.height - trimBottom, 0, viewportHeight)
  const x = clamp(Math.round(x0 * scaleX), 0, imageWidth)
  const y = clamp(Math.round(y0 * scaleY), 0, imageHeight)
  const right = clamp(Math.round(x1 * scaleX), 0, imageWidth)
  const bottom = clamp(Math.round(y1 * scaleY), 0, imageHeight)
  const width = right - x
  const height = bottom - y
  if (width < 2 || height < 2) {
    throw new ArchiveError('CROP_FAILED', 'Область сообщений не попала в снимок.')
  }
  return { x, y, width, height, scaleX, scaleY }
}

export function geometryChanged(previous: Geometry, next: Geometry): boolean {
  if (Math.abs(previous.devicePixelRatio - next.devicePixelRatio) > 0.01) return true
  if (Math.abs(previous.viewportWidth - next.viewportWidth) > 2) return true
  if (Math.abs(previous.viewportHeight - next.viewportHeight) > 2) return true
  if (Math.abs(previous.rect.x - next.rect.x) > 4) return true
  if (Math.abs(previous.rect.y - next.rect.y) > 4) return true
  if (Math.abs(previous.rect.width - next.rect.width) > 2) return true
  if (Math.abs(previous.rect.height - next.rect.height) > 2) return true
  return false
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
