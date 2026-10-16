export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89
export const MARGIN_X = 24
export const MARGIN_TOP = 12
export const FOOTER_BLOCK = 28
export const MAX_SCALE = 4

export function contentWidth(): number {
  return PAGE_WIDTH - MARGIN_X * 2
}

export function contentHeight(): number {
  return PAGE_HEIGHT - MARGIN_TOP - FOOTER_BLOCK
}

export function imageScale(imageWidth: number): number {
  return Math.min(contentWidth() / Math.max(1, imageWidth), MAX_SCALE)
}

/** How many source pixels fit in the printable area of one A4 page. */
export function maxStripPixels(imageWidth: number): number {
  const scale = imageScale(imageWidth)
  return Math.max(1, Math.floor(contentHeight() / scale))
}
