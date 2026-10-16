export function safeFileName(name: string, fallback = 'WhatsApp-chat'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  const base = cleaned.length > 0 ? cleaned : fallback
  return base.slice(0, 80)
}

export function frameFileName(index: number): string {
  const width = Math.max(4, String(index).length)
  return `${String(index).padStart(width, '0')}.png`
}

export function archiveBaseName(name: string, incomplete: boolean): string {
  const safe = safeFileName(name)
  return incomplete ? `${safe}-неполный` : safe
}

export function partSuffix(part: number, parts: number): string {
  if (parts <= 1) return ''
  return `-часть-${String(part).padStart(2, '0')}`
}
