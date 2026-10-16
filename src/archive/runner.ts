import { geometryChanged } from '../crop'
import { ArchiveError, userMessage } from '../errors'
import { addWarning } from '../job'
import { LIMITS } from '../limits'
import type { ContentRequest, ContentResponse } from '../protocol'
import { applyMachine } from '../state-machine'
import { compareDays, formatDay, formatIsoDate, isDayInRange, parseIsoDate } from '../dates'
import type { CalendarDate, FrameDraft, Geometry, JobCheckpoint } from '../types'

export type Visibility = 'visible' | 'hidden' | 'other_tab' | 'closed'

export interface CropInput {
  png: Blob
  viewportWidth: number
  viewportHeight: number
  rect: Geometry['rect']
  trimTop: number
  trimBottom: number
}

export interface ArchivePorts {
  now(): string
  sleep(ms: number): Promise<void>
  isTargetVisible(tabId: number, windowId: number): Promise<Visibility>
  send(tabId: number, request: ContentRequest): Promise<ContentResponse>
  capture(windowId: number): Promise<Blob>
  crop(input: CropInput): Promise<Blob>
  saveFrame(frame: FrameDraft): Promise<void>
}

export type StepOutcome = 'continue' | 'idle'

const AMBIGUOUS_WARNING =
  'Есть даты, которые нельзя однозначно разобрать. Они не используются как границы периода.'
const UNSETTLED_WARNING = 'Список сообщений не успел стабилизироваться перед шагом. Кадр всё равно проверяется по позиции.'
const COVERAGE_WARNING = 'Точные границы периода на части кадров определить нельзя. Проверьте фактический охват.'

export async function runOneStep(job: JobCheckpoint, ports: ArchivePorts): Promise<{ job: JobCheckpoint; outcome: StepOutcome }> {
  if (job.phase === 'validating') return validate(job, ports)
  if (job.phase === 'scrolling_to_start') return scrollTowardStart(job, ports)
  if (job.phase === 'positioning') return positionAtStart(job, ports)
  if (job.phase === 'capturing') return captureStep(job, ports)
  return { job, outcome: 'idle' }
}

async function validate(job: JobCheckpoint, ports: ArchivePorts): Promise<{ job: JobCheckpoint; outcome: StepOutcome }> {
  const blocked = await guardWindow(job, ports)
  if (blocked) return blocked
  const status = await ask(job, ports, { type: 'STATUS' })
  if (!status.ok) return fail(job, status, ports)
  if (status.type !== 'STATUS') return failProtocol(job, ports)
  if (!status.status.compatible || !status.status.chatKey || !status.status.chatTitle) {
    const code = !status.status.onWhatsapp
      ? 'NOT_WHATSAPP'
      : !status.status.loggedIn
        ? 'NOT_LOGGED_IN'
        : status.status.messageCount < 1
          ? 'NO_CHAT'
          : status.status.readableDates < 1
            ? status.status.diagnostics.some((item) => (item.note ?? '').includes('неоднознач'))
              ? 'AMBIGUOUS_DATE'
              : 'DATE_UNREADABLE'
            : 'MARKUP_INCOMPATIBLE'
    return fail(job, { ok: false, errorCode: code, message: userMessage(code), diagnostics: status.status.diagnostics }, ports)
  }
  const boundary = await ask(job, ports, { type: 'READ_BOUNDARY' })
  if (!boundary.ok) return fail(job, boundary, ports)
  if (boundary.type !== 'READ_BOUNDARY') return failProtocol(job, ports)
  const moved = applyMachine(job, { type: 'VALIDATION_OK' })
  if (!moved.accepted) return { job, outcome: 'idle' }
  return {
    outcome: 'continue',
    job: stamp(
      {
        ...moved.job,
        chatKey: boundary.chatKey,
        chatTitle: boundary.chatTitle,
        boundaryMessageId: boundary.boundaryId,
        geometry: boundary.geometry,
        loadedOldest: boundary.oldest,
        loadedNewest: boundary.newest,
        lastFingerprint: boundary.fingerprint,
        diagnostics: status.status.diagnostics,
      },
      ports,
    ),
  }
}

async function scrollTowardStart(job: JobCheckpoint, ports: ArchivePorts): Promise<{ job: JobCheckpoint; outcome: StepOutcome }> {
  const blocked = await guardWindow(job, ports)
  if (blocked) return blocked
  const identity = await ask(job, ports, { type: 'PROBE' })
  if (!identity.ok) return fail(identityJob(job, identity), identity, ports)
  if (identity.type !== 'PROBE') return failProtocol(job, ports)
  if (identity.chatKey !== job.chatKey) return pause(job, ports, 'chat', userMessage('CHAT_CHANGED'))
  if (identity.visibility === 'hidden') {
    return pause(job, ports, 'hidden', 'Вкладка WhatsApp скрыта. Откройте её, затем снова откройте значок расширения и нажмите «Продолжить».')
  }
  const scrolled = await ask(job, ports, { type: 'SCROLL_UP', start: job.requestedStart })
  if (!scrolled.ok) return fail(job, scrolled, ports)
  if (scrolled.type !== 'SCROLL_UP') return failProtocol(job, ports)
  if (scrolled.chatKey !== job.chatKey) return pause(job, ports, 'chat', userMessage('CHAT_CHANGED'))
  let next = rememberRange(job, scrolled.oldest, scrolled.newest)
  if (scrolled.ambiguousCount > 0) addWarning(next, AMBIGUOUS_WARNING)
  if (!scrolled.settled) addWarning(next, UNSETTLED_WARNING)
  if (scrolled.reachedStart) {
    const moved = applyMachine(next, { type: 'START_FOUND' })
    return { outcome: 'continue', job: stamp({ ...moved.job, stallCount: 0, lastFingerprint: scrolled.fingerprint }, ports) }
  }
  if (scrolled.progressed) {
    const moved = applyMachine(next, { type: 'SCROLL_PROGRESS' })
    return {
      outcome: 'continue',
      job: stamp({ ...moved.job, stallCount: 0, lastFingerprint: scrolled.fingerprint }, ports),
    }
  }
  next = { ...next, stallCount: next.stallCount + 1 }
  if (scrolled.historyExhausted || next.stallCount >= LIMITS.maxStalls) {
    const oldestText = next.loadedOldest ? formatDay(mustDate(next.loadedOldest)) : 'не определено'
    const moved = applyMachine(next, { type: 'START_MISSING' })
    return {
      outcome: 'idle',
      job: stamp(
        {
          ...moved.job,
          statusHint: `Дата ${formatDay(mustDate(job.requestedStart))} не найдена в загруженной истории. Самое раннее доступное сообщение: ${oldestText}. Нажмите «Продолжить», чтобы архивировать доступный диапазон, или «Остановить».`,
          incompleteReason: `В загруженной истории нет сообщений от ${formatDay(mustDate(job.requestedStart))}. Доступный диапазон начинается с ${oldestText}.`,
          exportAvailable: next.frameCount > 0,
        },
        ports,
      ),
    }
  }
  const moved = applyMachine(next, { type: 'SCROLL_PROGRESS' })
  return { outcome: 'continue', job: stamp(moved.job, ports) }
}

async function positionAtStart(job: JobCheckpoint, ports: ArchivePorts): Promise<{ job: JobCheckpoint; outcome: StepOutcome }> {
  const blocked = await guardWindow(job, ports)
  if (blocked) return blocked
  const aligned = await ask(job, ports, { type: 'ALIGN_START', start: job.requestedStart, end: job.requestedEnd })
  if (!aligned.ok) return fail(job, aligned, ports)
  if (aligned.type !== 'ALIGN_START') return failProtocol(job, ports)
  if (aligned.chatKey !== job.chatKey) return pause(job, ports, 'chat', userMessage('CHAT_CHANGED'))
  const moved = applyMachine(job, { type: 'POSITIONED' })
  if (!moved.accepted) return { job, outcome: 'idle' }
  const next = stamp(
    {
      ...moved.job,
      geometry: aligned.geometry,
      lastFingerprint: aligned.fingerprint,
      trimLeading: true,
      needsPositionCheck: false,
    },
    ports,
  )
  if (aligned.warning) addWarning(next, aligned.warning)
  if (!aligned.settled) addWarning(next, UNSETTLED_WARNING)
  if (job.incomplete) {
    addWarning(next, 'Архивируется только загруженный диапазон: выбранная дата начала в истории не найдена.')
  }
  return { outcome: 'continue', job: next }
}

async function captureStep(job: JobCheckpoint, ports: ArchivePorts): Promise<{ job: JobCheckpoint; outcome: StepOutcome }> {
  const blocked = await guardWindow(job, ports)
  if (blocked) return blocked
  if (job.needsPositionCheck) {
    const probe = await ask(job, ports, { type: 'PROBE' })
    if (!probe.ok) return fail(job, probe, ports)
    if (probe.type !== 'PROBE') return failProtocol(job, ports)
    if (probe.chatKey !== job.chatKey) return pause(job, ports, 'chat', userMessage('CHAT_CHANGED'))
    if (probe.visibility === 'hidden') {
      return pause(job, ports, 'hidden', 'Вкладка WhatsApp скрыта. Откройте её, затем снова откройте значок расширения и нажмите «Продолжить».')
    }
    if (job.lastFingerprint && probe.fingerprint !== job.lastFingerprint) {
      return pause(
        { ...job, geometry: probe.geometry },
        ports,
        'position_lost',
        'Позиция прокрутки изменилась. «Продолжить» заново найдёт начало периода и сохранит уже снятые кадры. Возможны повторы.',
      )
    }
    job = stamp({ ...job, geometry: probe.geometry, needsPositionCheck: false }, ports)
  }

  const context = await ask(job, ports, {
    type: 'CAPTURE_CONTEXT',
    start: job.requestedStart,
    end: job.requestedEnd,
    boundaryId: job.boundaryMessageId,
    trimLeading: job.trimLeading,
  })
  if (!context.ok) return fail(job, context, ports)
  if (context.type !== 'CAPTURE_CONTEXT') return failProtocol(job, ports)
  const shot = context.context
  if (shot.chatKey !== job.chatKey) return pause(job, ports, 'chat', userMessage('CHAT_CHANGED'))
  if (job.geometry && geometryChanged(job.geometry, shot.geometry)) {
    return pause(job, ports, 'geometry', 'Изменился размер окна или масштаб. Задача на паузе. Нажмите «Продолжить», чтобы снять геометрию заново.')
  }
  if (job.lastFingerprint && shot.fingerprint === job.lastFingerprint && job.frameCount > 0) {
    return finishCapture(job, ports, !job.boundaryMessageId || shot.containsBoundary !== 'absent')
  }

  const waitMs = LIMITS.minCaptureIntervalMs - (Date.now() - job.lastCaptureAt)
  if (waitMs > 0) await ports.sleep(waitMs)
  const still = await guardWindow(job, ports)
  if (still) return still

  let png: Blob
  try {
    png = await ports.capture(job.windowId)
  } catch {
    const failures = job.captureFailures + 1
    if (failures >= LIMITS.maxCaptureFailures) {
      return fail(
        { ...job, captureFailures: failures },
        { ok: false, errorCode: 'CAPTURE_FAILED', message: userMessage('CAPTURE_FAILED') },
        ports,
      )
    }
    return pause({ ...job, captureFailures: failures }, ports, 'capture_failed', userMessage('CAPTURE_FAILED'))
  }

  let cropped: Blob
  try {
    cropped = await ports.crop({
      png,
      viewportWidth: shot.geometry.viewportWidth,
      viewportHeight: shot.geometry.viewportHeight,
      rect: shot.geometry.rect,
      trimTop: shot.trimTop,
      trimBottom: shot.trimBottom,
    })
  } catch (error) {
    const message =
      error instanceof ArchiveError
        ? error.message
        : error instanceof Error && error.message
          ? `${userMessage('CROP_FAILED')} ${error.message}`
          : userMessage('CROP_FAILED')
    const code = error instanceof ArchiveError ? error.code : 'CROP_FAILED'
    if (code === 'GEOMETRY_CHANGED') return pause(job, ports, 'geometry', message)
    return fail(job, { ok: false, errorCode: code, message }, ports)
  }

  const index = job.frameCount + 1
  try {
    await ports.saveFrame({
      jobId: job.jobId,
      index,
      capturedAt: ports.now(),
      scrollTop: shot.scrollTop,
      viewHeight: Math.max(1, Math.round(shot.geometry.rect.height - shot.trimTop - shot.trimBottom)),
      png: cropped,
    })
  } catch {
    return fail(job, { ok: false, errorCode: 'STORAGE_FAILED', message: userMessage('STORAGE_FAILED') }, ports)
  }

  let next = rememberRange({ ...job, frameCount: index, captureFailures: 0, lastCaptureAt: Date.now() }, shot.oldest, shot.newest)
  if (shot.ambiguousCount > 0) addWarning(next, AMBIGUOUS_WARNING)
  if (shot.coverageWarning) addWarning(next, shot.coverageWarning)
  if (!shot.trimReliable) addWarning(next, COVERAGE_WARNING)
  if (!shot.settled) addWarning(next, UNSETTLED_WARNING)
  const saved = applyMachine(next, { type: 'FRAME_SAVED' })
  next = stamp(
    {
      ...saved.job,
      lastFingerprint: shot.fingerprint,
      trimLeading: shot.leadingClear ? false : next.trimLeading,
      geometry: next.geometry ?? shot.geometry,
    },
    ports,
  )

  if (next.frameCount >= LIMITS.maxFrames) {
    next.incomplete = true
    next.incompleteReason = userMessage('JOB_TOO_LARGE')
    addWarning(next, next.incompleteReason)
    return finishCapture(next, ports, false)
  }

  const reachedEnd = shot.containsBoundary === 'full' || shot.passedEnd || (shot.atBottom && shot.containsBoundary === 'partial')
  if (reachedEnd) {
    if (shot.containsBoundary === 'partial') {
      addWarning(next, 'Последнее сообщение границы архива могло попасть в кадр не полностью.')
    }
    return finishCapture(next, ports, true)
  }

  const moved = await ask(next, ports, { type: 'SCROLL_DOWN' })
  if (!moved.ok) return fail(next, moved, ports)
  if (moved.type !== 'SCROLL_DOWN') return failProtocol(next, ports)
  if (moved.chatKey !== next.chatKey) return pause(next, ports, 'chat', userMessage('CHAT_CHANGED'))
  if (!moved.settled) addWarning(next, UNSETTLED_WARNING)
  if (!moved.progressed) {
    if (shot.containsBoundary === 'absent' && !shot.passedEnd) {
      addWarning(next, 'Прокрутка остановилась до подтверждённой конечной границы. Архив помечен как неполный.')
      next.incomplete = true
      next.incompleteReason = 'Прокрутка остановилась раньше конечной границы.'
    }
    return finishCapture(next, ports, shot.containsBoundary !== 'absent' || shot.passedEnd)
  }
  return { outcome: 'continue', job: next }
}

function finishCapture(
  job: JobCheckpoint,
  ports: ArchivePorts,
  confirmed: boolean,
): { job: JobCheckpoint; outcome: StepOutcome } {
  const moved = applyMachine(job, { type: 'CAPTURE_FINISHED' })
  const next = stamp(moved.job, ports)
  if (!confirmed) {
    next.incomplete = true
    next.incompleteReason = next.incompleteReason ?? 'Конечная граница архива не подтверждена.'
  }
  next.exportAvailable = next.frameCount > 0
  next.statusHint = next.incomplete
    ? 'Съёмка закончена неполностью. Можно скачать уже сохранённые кадры.'
    : 'Съёмка закончена. Можно скачать результат.'
  return { outcome: 'idle', job: next }
}

async function guardWindow(job: JobCheckpoint, ports: ArchivePorts): Promise<{ job: JobCheckpoint; outcome: StepOutcome } | null> {
  const visibility = await ports.isTargetVisible(job.tabId, job.windowId)
  if (visibility === 'visible') return null
  if (visibility === 'other_tab' || visibility === 'closed') {
    const message =
      visibility === 'closed'
        ? 'Вкладка WhatsApp закрыта. Снимок другой вкладки не делается.'
        : 'Активна другая вкладка. Вернитесь к чату WhatsApp, снова откройте значок расширения и нажмите «Продолжить».'
    return pause(job, ports, 'tab', message)
  }
  return pause(
    job,
    ports,
    'hidden',
    'Вкладка WhatsApp скрыта. Откройте её, затем снова откройте значок расширения и нажмите «Продолжить».',
  )
}

function pause(
  job: JobCheckpoint,
  ports: ArchivePorts,
  reason: 'user' | 'tab' | 'chat' | 'geometry' | 'hidden' | 'worker_restarted' | 'position_lost' | 'capture_failed',
  hint: string,
): { job: JobCheckpoint; outcome: StepOutcome } {
  const moved = applyMachine(job, { type: 'PAUSE', reason })
  if (!moved.accepted) return { job: stamp({ ...job, statusHint: hint }, ports), outcome: 'idle' }
  return { outcome: 'idle', job: stamp({ ...moved.job, statusHint: hint, exportAvailable: job.frameCount > 0 }, ports) }
}

function fail(
  job: JobCheckpoint,
  response: Extract<ContentResponse, { ok: false }>,
  ports: ArchivePorts,
): { job: JobCheckpoint; outcome: StepOutcome } {
  const moved = applyMachine(job, { type: 'FAIL', errorCode: response.errorCode })
  const base = moved.accepted ? moved.job : job
  return {
    outcome: 'idle',
    job: stamp(
      {
        ...base,
        phase: 'error',
        errorCode: response.errorCode,
        errorDetail: response.message,
        diagnostics: response.diagnostics ?? job.diagnostics,
        incomplete: true,
        incompleteReason: response.message,
        exportAvailable: job.frameCount > 0,
      },
      ports,
    ),
  }
}

function failProtocol(job: JobCheckpoint, ports: ArchivePorts): { job: JobCheckpoint; outcome: StepOutcome } {
  return fail(job, { ok: false, errorCode: 'INTERNAL', message: userMessage('INTERNAL') }, ports)
}

function identityJob(job: JobCheckpoint, response: ContentResponse): JobCheckpoint {
  return response.ok ? job : job
}

async function ask(job: JobCheckpoint, ports: ArchivePorts, request: ContentRequest): Promise<ContentResponse> {
  try {
    return await ports.send(job.tabId, request)
  } catch (error) {
    const message = error instanceof ArchiveError ? error.message : 'Страница WhatsApp не ответила. Обновите вкладку и нажмите «Продолжить».'
    return { ok: false, errorCode: error instanceof ArchiveError ? error.code : 'INTERNAL', message }
  }
}

function rememberRange(job: JobCheckpoint, oldest: string | null, newest: string | null): JobCheckpoint {
  const next = { ...job, warnings: [...job.warnings] }
  const start = parseIsoDate(job.requestedStart)
  const end = job.requestedEnd ? parseIsoDate(job.requestedEnd) : null
  if (!start) return next
  for (const iso of [oldest, newest]) {
    if (!iso) continue
    const day = parseIsoDate(iso)
    if (!day) continue
    if (!next.loadedOldest || iso < next.loadedOldest) next.loadedOldest = iso
    if (!next.loadedNewest || iso > next.loadedNewest) next.loadedNewest = iso
    if (!isDayInRange(day, start, end)) continue
    if (!next.actualStart || iso < next.actualStart) next.actualStart = iso
    if (!next.actualEnd || iso > next.actualEnd) next.actualEnd = iso
  }
  return next
}

function mustDate(iso: string): CalendarDate {
  return parseIsoDate(iso) ?? { y: 0, m: 0, d: 0 }
}

function stamp(job: JobCheckpoint, ports: ArchivePorts): JobCheckpoint {
  return { ...job, updatedAt: ports.now() }
}

export function formatRequestedPeriod(job: JobCheckpoint): string {
  const start = parseIsoDate(job.requestedStart)
  const end = job.requestedEnd ? parseIsoDate(job.requestedEnd) : null
  const startText = start ? formatDay(start) : job.requestedStart
  const endText = end ? formatDay(end) : 'последнее сообщение на момент запуска'
  return `${startText} — ${endText}`
}

export function periodStarted(oldest: CalendarDate, start: CalendarDate): boolean {
  return compareDays(oldest, start) <= 0
}

export function isoOrNull(day: CalendarDate | null): string | null {
  return day ? formatIsoDate(day) : null
}
