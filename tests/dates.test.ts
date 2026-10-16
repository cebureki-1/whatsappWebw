import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  calendarParts,
  compareDays,
  formatDay,
  inspectSlashOrder,
  isDayInRange,
  parseDateLabel,
  parseIsoDate,
  parsePrePlainText,
  rangeStatus,
  type ParseContext,
} from '../src/dates'

const moscow: ParseContext = {
  now: new Date('2026-10-07T21:30:00Z'),
  timeZone: 'Europe/Moscow',
  locale: 'ru-RU',
  slashOrder: 'unknown',
}

describe('календарь и часовой пояс', () => {
  it('берёт календарный день в заданной зоне, а не в UTC', () => {
    expect(calendarParts(new Date('2026-10-07T21:30:00Z'), 'Europe/Moscow')).toEqual({ y: 2026, m: 10, d: 8 })
    expect(calendarParts(new Date('2026-10-07T21:30:00Z'), 'UTC')).toEqual({ y: 2026, m: 10, d: 7 })
  })

  it('понимает Сегодня и Вчера в локальном календаре', () => {
    expect(parseDateLabel('Сегодня', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
    expect(parseDateLabel('вчера', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 7 } })
    expect(parseDateLabel('Today', { ...moscow, locale: 'en-US' })).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
    expect(parseDateLabel('Yesterday', { ...moscow, locale: 'en-GB' })).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 7 } })
  })
})

describe('разбор подписей дат', () => {
  it('читает русские и английские названия месяцев', () => {
    expect(parseDateLabel('8 октября 2026 г.', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
    expect(parseDateLabel('суббота, 8 октября 2026', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
    expect(parseDateLabel('October 8, 2026', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
    expect(parseDateLabel('8 October 2026', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
  })

  it('читает точки как ДД.ММ.ГГГГ и не меняет месяц с днём', () => {
    expect(parseDateLabel('08.10.2026', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 10, d: 8 } })
    expect(formatDay({ y: 2026, m: 10, d: 8 })).toBe('08.10.2026')
  })

  it('не угадывает неоднозначную дату со слэшем', () => {
    expect(parseDateLabel('05/06/2026', moscow)).toEqual({ kind: 'ambiguous' })
    expect(parseDateLabel('13/06/2026', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 6, d: 13 } })
    expect(parseDateLabel('06/13/2026', moscow)).toEqual({ kind: 'date', date: { y: 2026, m: 6, d: 13 } })
  })

  it('применяет порядок слэша только после доказательства в той же истории', () => {
    expect(inspectSlashOrder(['05/06/2026', '08/10/2026'])).toBe('unknown')
    expect(inspectSlashOrder(['13/06/2026', '05/06/2026'])).toBe('DMY')
    expect(inspectSlashOrder(['06/13/2026'])).toBe('MDY')
    expect(inspectSlashOrder(['13/06/2026', '06/13/2026'])).toBe('conflict')
    expect(parseDateLabel('05/06/2026', { ...moscow, slashOrder: 'DMY' })).toEqual({
      kind: 'date',
      date: { y: 2026, m: 6, d: 5 },
    })
  })

  it('достаёт дату из data-pre-plain-text, не требуя текста сообщения', () => {
    expect(parsePrePlainText('[10:15, 08.10.2026] Анна: ', moscow)).toEqual({
      kind: 'date',
      date: { y: 2026, m: 10, d: 8 },
    })
    expect(parsePrePlainText('[10:15 AM, October 8, 2026] Ann: ', moscow)).toEqual({
      kind: 'date',
      date: { y: 2026, m: 10, d: 8 },
    })
  })

  it('включает выбранные календарные дни целиком', () => {
    const start = parseIsoDate('2026-10-08')!
    const end = parseIsoDate('2026-10-09')!
    expect(isDayInRange(start, start, end)).toBe(true)
    expect(isDayInRange(end, start, end)).toBe(true)
    expect(isDayInRange(addCalendarDays(start, -1), start, end)).toBe(false)
    expect(rangeStatus(addCalendarDays(end, 1), false, start, end)).toBe('after')
    expect(rangeStatus(null, false, start, end)).toBe('unknown')
    expect(compareDays(start, end)).toBeLessThan(0)
  })
})
