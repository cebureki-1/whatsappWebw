export const LIMITS = {
  maxFrames: 1500,
  pdfFramesPerPart: 60,
  zipFramesPerPart: 200,
  maxStalls: 4,
  maxCaptureFailures: 3,
  scrollPortion: 0.82,
  minCaptureIntervalMs: 700,
  stablePollMs: 200,
  stablePasses: 3,
  stableTimeoutMs: 5000,
  contentTimeoutMs: 20000,
} as const

export const PHASE_LABELS = {
  idle: 'Ожидание',
  validating: 'Проверка страницы',
  scrolling_to_start: 'Поиск начала периода',
  positioning: 'Переход к первому сообщению',
  capturing: 'Съёмка переписки',
  paused: 'Пауза',
  awaiting_partial_decision: 'Нужно решение',
  completed: 'Готово',
  stopped: 'Остановлено',
  error: 'Ошибка',
  needs_restart: 'Нужно возобновление',
} as const
