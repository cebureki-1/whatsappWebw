import type { ActiveResumePhase, JobCheckpoint, PauseReason, Phase } from './types'

export type JobEvent =
  | { type: 'START' }
  | { type: 'VALIDATION_OK' }
  | { type: 'VALIDATION_FAILED'; errorCode: string }
  | { type: 'SCROLL_PROGRESS' }
  | { type: 'START_FOUND' }
  | { type: 'START_MISSING' }
  | { type: 'POSITIONED' }
  | { type: 'FRAME_SAVED' }
  | { type: 'CAPTURE_FINISHED' }
  | { type: 'PAUSE'; reason: PauseReason }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'FAIL'; errorCode: string }
  | { type: 'WORKER_RESTART' }
  | { type: 'CANNOT_RESUME' }

export interface TransitionResult {
  job: JobCheckpoint
  accepted: boolean
}

const RUNNING: Phase[] = ['validating', 'scrolling_to_start', 'positioning', 'capturing']

export function isRunningPhase(phase: Phase): phase is ActiveResumePhase {
  return (RUNNING as readonly Phase[]).includes(phase)
}

export function applyMachine(job: JobCheckpoint, event: JobEvent): TransitionResult {
  const next = cloneJob(job)
  const accepted = move(next, event)
  return { job: accepted ? next : job, accepted }
}

function move(job: JobCheckpoint, event: JobEvent): boolean {
  switch (event.type) {
    case 'START':
      if (isRunningPhase(job.phase)) return false
      job.phase = 'validating'
      job.resumePhase = 'validating'
      job.pauseReason = null
      job.needsPositionCheck = false
      job.errorCode = null
      job.errorDetail = null
      job.statusHint = null
      job.incomplete = false
      job.incompleteReason = null
      job.captureComplete = false
      return true
    case 'VALIDATION_OK':
      if (job.phase !== 'validating') return false
      job.phase = 'scrolling_to_start'
      job.resumePhase = 'scrolling_to_start'
      return true
    case 'VALIDATION_FAILED':
      if (job.phase !== 'validating') return false
      job.phase = 'error'
      job.errorCode = event.errorCode
      job.captureComplete = false
      return true
    case 'SCROLL_PROGRESS':
      return job.phase === 'scrolling_to_start'
    case 'START_FOUND':
      if (job.phase !== 'scrolling_to_start') return false
      job.phase = 'positioning'
      job.resumePhase = 'positioning'
      job.stallCount = 0
      return true
    case 'START_MISSING':
      if (job.phase !== 'scrolling_to_start') return false
      job.phase = 'awaiting_partial_decision'
      job.incomplete = true
      job.exportAvailable = job.frameCount > 0
      return true
    case 'POSITIONED':
      if (job.phase !== 'positioning') return false
      job.phase = 'capturing'
      job.resumePhase = 'capturing'
      job.trimLeading = true
      return true
    case 'FRAME_SAVED':
      if (job.phase !== 'capturing') return false
      job.exportAvailable = true
      return true
    case 'CAPTURE_FINISHED':
      if (job.phase !== 'capturing') return false
      job.phase = 'completed'
      job.resumePhase = null
      job.pauseReason = null
      job.captureComplete = true
      job.exportAvailable = job.frameCount > 0
      job.statusHint = null
      return true
    case 'PAUSE':
      if (!isRunningPhase(job.phase)) return false
      job.resumePhase = job.phase
      job.phase = 'paused'
      job.pauseReason = event.reason
      job.exportAvailable = job.frameCount > 0
      return true
    case 'RESUME':
      if (job.phase === 'awaiting_partial_decision') {
        job.phase = 'positioning'
        job.resumePhase = 'positioning'
        job.pauseReason = null
        job.incomplete = true
        job.statusHint = null
        return true
      }
      if (job.phase !== 'paused' && job.phase !== 'needs_restart') return false
      if (job.pauseReason === 'chat') return false
      if (!job.resumePhase) return false
      if (job.pauseReason === 'position_lost') {
        job.phase = 'scrolling_to_start'
        job.resumePhase = 'scrolling_to_start'
        job.pauseReason = null
        job.needsPositionCheck = false
        job.stallCount = 0
        job.statusHint = null
        return true
      }
      job.phase = job.resumePhase
      job.pauseReason = null
      job.needsPositionCheck = job.phase === 'capturing'
      job.statusHint = null
      return true
    case 'STOP':
      if (job.phase === 'idle' || job.phase === 'completed') return false
      job.phase = 'stopped'
      job.pauseReason = null
      job.resumePhase = null
      if (!job.captureComplete) {
        job.incomplete = true
        job.incompleteReason = job.incompleteReason ?? 'Остановлено пользователем.'
      }
      job.exportAvailable = job.frameCount > 0
      return true
    case 'FAIL':
      if (job.phase === 'idle' || job.phase === 'completed') return false
      job.phase = 'error'
      job.errorCode = event.errorCode
      job.exportAvailable = job.frameCount > 0
      if (!job.captureComplete) job.incomplete = true
      return true
    case 'WORKER_RESTART':
      if (!isRunningPhase(job.phase)) return false
      job.resumePhase = job.phase
      job.phase = 'paused'
      job.pauseReason = 'worker_restarted'
      job.needsPositionCheck = job.resumePhase === 'capturing'
      job.exportAvailable = job.frameCount > 0
      job.statusHint =
        'Фоновая часть расширения перезапустилась. Проверьте чат и нажмите «Продолжить» или скачайте уже сохранённые кадры.'
      return true
    case 'CANNOT_RESUME':
      if (job.phase !== 'paused' && job.phase !== 'needs_restart' && !isRunningPhase(job.phase)) return false
      job.phase = 'needs_restart'
      job.exportAvailable = job.frameCount > 0
      job.statusHint = 'Безопасно продолжить с текущего места нельзя.'
      return true
    default:
      return false
  }
}

function cloneJob(job: JobCheckpoint): JobCheckpoint {
  return {
    ...job,
    warnings: [...job.warnings],
    diagnostics: job.diagnostics ? job.diagnostics.map((item) => ({ ...item })) : null,
    geometry: job.geometry ? { ...job.geometry, rect: { ...job.geometry.rect } } : null,
  }
}

export function resumeTarget(phase: Phase): ActiveResumePhase | null {
  if (phase === 'validating' || phase === 'scrolling_to_start' || phase === 'positioning' || phase === 'capturing') {
    return phase
  }
  return null
}
