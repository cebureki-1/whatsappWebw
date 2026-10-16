import type { CalendarDate } from './types'

export interface ParseContext {
  now: Date
  timeZone: string
  locale: string
  slashOrder: SlashOrder
}

export type SlashOrder = 'DMY' | 'MDY' | 'unknown'

export type DateParse = { kind: 'date'; date: CalendarDate } | { kind: 'ambiguous' } | { kind: 'none' }

const RU_MONTHS: Record<string, number> = {
  январь: 1,
  января: 1,
  февраль: 2,
  февраля: 2,
  март: 3,
  марта: 3,
  апрель: 4,
  апреля: 4,
  май: 5,
  мая: 5,
  июнь: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  август: 8,
  августа: 8,
  сентябрь: 9,
  сентября: 9,
  октябрь: 10,
  октября: 10,
  ноябрь: 11,
  ноября: 11,
  декабрь: 12,
  декабря: 12,
}

const EN_MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

const WEEKDAYS = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function calendarParts(date: Date, timeZone: string): CalendarDate {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  if (!isValidDate(year, month, day)) {
    throw new Error('timezone calendar conversion failed')
  }
  return { y: year, m: month, d: day }
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

export function addCalendarDays(day: CalendarDate, delta: number): CalendarDate {
  const probe = new Date(Date.UTC(day.y, day.m - 1, day.d))
  probe.setUTCDate(probe.getUTCDate() + delta)
  return { y: probe.getUTCFullYear(), m: probe.getUTCMonth() + 1, d: probe.getUTCDate() }
}

export function compareDays(a: CalendarDate, b: CalendarDate): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.m !== b.m) return a.m - b.m
  return a.d - b.d
}

export function formatDay(day: CalendarDate): string {
  return `${String(day.d).padStart(2, '0')}.${String(day.m).padStart(2, '0')}.${day.y}`
}

export function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return isValidDate(y, m, d) ? { y, m, d } : null
}

export function formatIsoDate(day: CalendarDate): string {
  return `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`
}

export function isDayInRange(day: CalendarDate, start: CalendarDate, end: CalendarDate | null): boolean {
  if (compareDays(day, start) < 0) return false
  if (end && compareDays(day, end) > 0) return false
  return true
}

export function rangeStatus(
  day: CalendarDate | null,
  ambiguous: boolean,
  start: CalendarDate,
  end: CalendarDate | null,
): 'before' | 'in' | 'after' | 'unknown' {
  if (!day || ambiguous) return 'unknown'
  if (compareDays(day, start) < 0) return 'before'
  if (end && compareDays(day, end) > 0) return 'after'
  return 'in'
}

export function normalizeDateText(value: string): string {
  return value
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripWeekday(text: string): string {
  const lower = text.toLowerCase()
  for (const weekday of WEEKDAYS) {
    if (lower.startsWith(weekday)) {
      return text.slice(weekday.length).replace(/^[\s,.:-]+/, '').trim()
    }
  }
  return text
}

function expandYear(year: number): number | null {
  if (year >= 100) return year
  if (year < 0) return null
  return year < 70 ? 2000 + year : 1900 + year
}

function monthNumber(token: string): number | null {
  const key = token.toLowerCase().replace(/\./g, '')
  return RU_MONTHS[key] ?? EN_MONTHS[key] ?? null
}

function finish(yRaw: number, m: number, d: number): DateParse {
  const y = expandYear(yRaw)
  if (y === null || !isValidDate(y, m, d)) return { kind: 'none' }
  return { kind: 'date', date: { y, m, d } }
}

export function inspectSlashOrder(samples: string[]): SlashOrder | 'conflict' {
  let order: SlashOrder = 'unknown'
  for (const sample of samples) {
    const text = normalizeDateText(sample)
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text)
    if (!match) continue
    const first = Number(match[1])
    const second = Number(match[2])
    let next: SlashOrder = 'unknown'
    if (first > 12 && second <= 12) next = 'DMY'
    else if (second > 12 && first <= 12) next = 'MDY'
    if (next === 'unknown') continue
    if (order === 'unknown') order = next
    else if (order !== next) return 'conflict'
  }
  return order
}

export function parseDateLabel(input: string, context: ParseContext): DateParse {
  const normalized = stripWeekday(normalizeDateText(input)).replace(/\s*г\.?$/i, '').trim()
  if (!normalized) return { kind: 'none' }
  const lower = normalized.toLowerCase()
  if (lower === 'сегодня' || lower === 'today') {
    return { kind: 'date', date: calendarParts(context.now, context.timeZone) }
  }
  if (lower === 'вчера' || lower === 'yesterday') {
    return { kind: 'date', date: addCalendarDays(calendarParts(context.now, context.timeZone), -1) }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (iso) return finish(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const dayMonth = /^(\d{1,2})\s+([^\d\s]+)\s+(\d{2,4})$/.exec(normalized)
  if (dayMonth) {
    const month = monthNumber(dayMonth[2])
    if (month) return finish(Number(dayMonth[3]), month, Number(dayMonth[1]))
  }

  const monthDay = /^([^\d\s]+)\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(normalized)
  if (monthDay) {
    const month = monthNumber(monthDay[1])
    if (month) return finish(Number(monthDay[3]), month, Number(monthDay[2]))
  }

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(normalized)
  if (dotted) return finish(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]))

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(normalized)
  if (slashed) {
    const first = Number(slashed[1])
    const second = Number(slashed[2])
    const year = Number(slashed[3])
    if (first > 12 && second <= 12) return finish(year, second, first)
    if (second > 12 && first <= 12) return finish(year, first, second)
    if (context.slashOrder === 'DMY') return finish(year, second, first)
    if (context.slashOrder === 'MDY') return finish(year, first, second)
    return { kind: 'ambiguous' }
  }

  return { kind: 'none' }
}

export function parsePrePlainText(value: string, context: ParseContext): DateParse {
  const match = normalizeDateText(value).match(/^\[([^\]]+)\]/)
  if (!match) return { kind: 'none' }
  const inside = match[1]
  const comma = inside.indexOf(',')
  if (comma < 0) return { kind: 'none' }
  const timePart = inside.slice(0, comma).trim()
  const datePart = inside.slice(comma + 1).trim()
  if (!/^\d{1,2}:\d{2}/.test(timePart)) return { kind: 'none' }
  return parseDateLabel(datePart, context)
}

export function dateSamplesFromText(value: string): string[] {
  const plain = normalizeDateText(value).match(/^\[([^\]]+)\]/)
  if (!plain) return []
  const inside = plain[1]
  const comma = inside.indexOf(',')
  if (comma < 0) return []
  return [inside.slice(comma + 1).trim()]
}
