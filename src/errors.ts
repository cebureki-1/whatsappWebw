import type { DiagnosticCheck } from './types'

export const ErrorCodes = {
  NOT_WHATSAPP: 'NOT_WHATSAPP',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  NO_CHAT: 'NO_CHAT',
  MARKUP_INCOMPATIBLE: 'MARKUP_INCOMPATIBLE',
  DATE_UNREADABLE: 'DATE_UNREADABLE',
  AMBIGUOUS_DATE: 'AMBIGUOUS_DATE',
  CHAT_CHANGED: 'CHAT_CHANGED',
  TAB_CHANGED: 'TAB_CHANGED',
  GEOMETRY_CHANGED: 'GEOMETRY_CHANGED',
  CAPTURE_FAILED: 'CAPTURE_FAILED',
  CROP_FAILED: 'CROP_FAILED',
  HISTORY_LIMIT: 'HISTORY_LIMIT',
  JOB_TOO_LARGE: 'JOB_TOO_LARGE',
  STORAGE_FAILED: 'STORAGE_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  NEEDS_RESTART: 'NEEDS_RESTART',
  INVALID_RANGE: 'INVALID_RANGE',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

const MESSAGES: Record<ErrorCode, string> = {
  NOT_WHATSAPP: 'Откройте https://web.whatsapp.com/ и нужный чат, затем запустите архивирование снова.',
  NOT_LOGGED_IN: 'Вход в WhatsApp Web не подтверждён. Отсканируйте QR-код и откройте чат.',
  NO_CHAT: 'Чат не открыт. Выберите переписку слева и повторите запуск.',
  MARKUP_INCOMPATIBLE:
    'Разметка WhatsApp Web не распознана. Архив не создан. Обновите страницу и проверьте диагностику ниже. Селекторы нужно сверить с живой страницей.',
  DATE_UNREADABLE:
    'Даты сообщений не читаются. Архив не создан, чтобы не сохранить неверный диапазон.',
  AMBIGUOUS_DATE:
    'Даты в чате нельзя однозначно разобрать (день и месяц меняются местами). Архив не создан. Переключите язык WhatsApp на вариант с названием месяца или с датой вида ДД.ММ.ГГГГ и обновите страницу.',
  CHAT_CHANGED: 'Открыт другой чат. Автоматическое продолжение остановлено.',
  TAB_CHANGED: 'Активна другая вкладка. Снимок не сделан.',
  GEOMETRY_CHANGED: 'Изменился размер окна или масштаб. Задача на паузе.',
  CAPTURE_FAILED: 'Не удалось снять вкладку. Убедитесь, что виден нужный чат, и нажмите «Продолжить».',
  CROP_FAILED: 'Не удалось обрезать снимок до области сообщений.',
  HISTORY_LIMIT: 'Более ранняя история не загрузилась.',
  JOB_TOO_LARGE: 'Достигнут предел длины одной задачи. Скачайте уже сохранённые кадры.',
  STORAGE_FAILED: 'Не удалось сохранить кадр в локальное хранилище.',
  EXPORT_FAILED: 'Не удалось собрать файл. Кадры сохранены, попробуйте скачать ещё раз.',
  NEEDS_RESTART: 'Безопасно продолжить нельзя. Запустите задачу заново или скачайте уже сохранённые кадры.',
  INVALID_RANGE: 'Дата окончания раньше даты начала.',
  INTERNAL: 'Внутренняя ошибка. Уже сохранённые кадры можно скачать.',
}

export class ArchiveError extends Error {
  readonly code: ErrorCode
  readonly diagnostics?: DiagnosticCheck[]

  constructor(code: ErrorCode, message?: string, diagnostics?: DiagnosticCheck[]) {
    super(message ?? MESSAGES[code])
    this.name = 'ArchiveError'
    this.code = code
    this.diagnostics = diagnostics
  }
}

export function userMessage(code: string, fallback?: string): string {
  if (code in MESSAGES) return MESSAGES[code as ErrorCode]
  return fallback || MESSAGES.INTERNAL
}

export function isErrorCode(code: string): code is ErrorCode {
  return code in MESSAGES
}
