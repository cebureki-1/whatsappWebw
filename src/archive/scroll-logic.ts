import { LIMITS } from '../limits'
import type { CalendarDate } from '../types'
import { compareDays } from '../dates'

export interface ScrollSnapshot {
  scrollTop: number
  scrollHeight: number
  firstId: string | null
  lastId: string | null
  oldest: CalendarDate | null
}

export interface TrimItem {
  top: number
  bottom: number
  status: 'before' | 'in' | 'after' | 'unknown'
}

export interface EdgeTrim {
  trimTop: number
  trimBottom: number
  reliable: boolean
  warning: string | null
  leadingClear: boolean
}

export function scrollDelta(clientHeight: number): number {
  return Math.max(1, Math.round(clientHeight * LIMITS.scrollPortion))
}

export function upProgress(previous: ScrollSnapshot, next: ScrollSnapshot): boolean {
  if (next.oldest && previous.oldest && compareDays(next.oldest, previous.oldest) < 0) return true
  if (next.scrollHeight > previous.scrollHeight + 20) return true
  if (next.firstId && next.firstId !== previous.firstId) return true
  if (next.scrollTop < previous.scrollTop - 10) return true
  return false
}

export function downProgress(previous: ScrollSnapshot, next: ScrollSnapshot): boolean {
  if (next.scrollTop > previous.scrollTop + 10) return true
  if (next.lastId && next.lastId !== previous.lastId) return true
  if (next.firstId && next.firstId !== previous.firstId && next.scrollTop !== previous.scrollTop) return true
  return false
}

export function sameView(previous: ScrollSnapshot, next: ScrollSnapshot): boolean {
  return (
    previous.firstId === next.firstId &&
    previous.lastId === next.lastId &&
    Math.abs(previous.scrollTop - next.scrollTop) <= 2 &&
    Math.abs(previous.scrollHeight - next.scrollHeight) <= 2
  )
}

export function computeEdgeTrim(
  items: TrimItem[],
  paneHeight: number,
  edges: { leading: boolean; trailing: boolean },
): EdgeTrim {
  const visible = items
    .filter((item) => item.bottom > item.top + 0.5 && item.bottom > 0 && item.top < paneHeight)
    .map((item) => ({
      ...item,
      top: clamp(item.top, 0, paneHeight),
      bottom: clamp(item.bottom, 0, paneHeight),
    }))
    .sort((a, b) => a.top - b.top)

  const firstIn = visible.find((item) => item.status === 'in')
  const leadingClear = visible.length > 0 && visible[0]?.status === 'in'
  if (!firstIn) {
    return {
      trimTop: 0,
      trimBottom: 0,
      reliable: false,
      warning: 'Границы сообщений выбранного периода на этом кадре определить нельзя.',
      leadingClear: false,
    }
  }

  let trimTop = 0
  let trimBottom = 0
  let reliable = true
  let warning: string | null = null
  const lastIn = [...visible].reverse().find((item) => item.status === 'in') ?? firstIn

  if (edges.leading) {
    const above = visible.filter((item) => item.bottom <= firstIn.top + 1)
    if (above.some((item) => item.status === 'unknown' || item.status === 'in' || item.status === 'after')) {
      reliable = false
      warning = 'Верх кадра может содержать сообщения вне периода: их границы неясны, поэтому они оставлены.'
    } else if (above.length > 0 && above.every((item) => item.status === 'before')) {
      trimTop = Math.max(0, Math.round(firstIn.top))
    }
  }

  if (edges.trailing) {
    const below = visible.filter((item) => item.top >= lastIn.bottom - 1)
    if (below.some((item) => item.status === 'unknown' || item.status === 'in' || item.status === 'before')) {
      reliable = false
      warning = warning ?? 'Низ кадра может содержать сообщения вне периода: их границы неясны, поэтому они оставлены.'
    } else if (below.length > 0 && below.every((item) => item.status === 'after')) {
      trimBottom = Math.max(0, Math.round(paneHeight - lastIn.bottom))
    }
  }

  if (trimTop + trimBottom >= paneHeight - 4) {
    return {
      trimTop: 0,
      trimBottom: 0,
      reliable: false,
      warning: 'Обрезка краёв убрала бы почти весь кадр, поэтому кадр сохранён целиком.',
      leadingClear,
    }
  }

  return { trimTop, trimBottom, reliable, warning, leadingClear }
}

export interface VirtualMessage {
  id: string
  date: CalendarDate
}

export interface VirtualWindow {
  start: number
  size: number
}

export function scrollWindow(total: number, current: VirtualWindow, direction: 'up' | 'down'): {
  window: VirtualWindow
  progressed: boolean
  hitEdge: boolean
} {
  const step = Math.max(1, Math.round(current.size * LIMITS.scrollPortion))
  const maxStart = Math.max(0, total - current.size)
  const nextStart =
    direction === 'up' ? Math.max(0, current.start - step) : Math.min(maxStart, current.start + step)
  return {
    window: { start: nextStart, size: current.size },
    progressed: nextStart !== current.start,
    hitEdge: direction === 'up' ? nextStart === 0 : nextStart === maxStart,
  }
}

export function coverDownward(total: number, size: number): number[][] {
  const frames: number[][] = []
  let current: VirtualWindow = { start: 0, size }
  const guard = total + 5
  for (let i = 0; i < guard; i++) {
    const end = Math.min(total, current.start + current.size)
    frames.push(Array.from({ length: end - current.start }, (_, index) => current.start + index))
    const moved = scrollWindow(total, current, 'down')
    if (!moved.progressed) break
    current = moved.window
  }
  return frames
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
