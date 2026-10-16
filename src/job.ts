import type { ExportFormat, JobCheckpoint } from './types'

export function createJob(input: {
  now: string
  tabId: number
  windowId: number
  start: string
  end: string | null
  format: ExportFormat
  archiveName: string
}): JobCheckpoint {
  return {
    jobId: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    phase: 'validating',
    resumePhase: 'validating',
    pauseReason: null,
    needsPositionCheck: false,
    errorCode: null,
    errorDetail: null,
    statusHint: null,
    incomplete: false,
    incompleteReason: null,
    warnings: [],
    tabId: input.tabId,
    windowId: input.windowId,
    chatKey: '',
    chatTitle: '',
    requestedStart: input.start,
    requestedEnd: input.end,
    actualStart: null,
    actualEnd: null,
    loadedOldest: null,
    loadedNewest: null,
    boundaryMessageId: '',
    frameCount: 0,
    lastFingerprint: null,
    lastCaptureAt: 0,
    geometry: null,
    trimLeading: true,
    stallCount: 0,
    captureFailures: 0,
    format: input.format,
    archiveName: input.archiveName,
    createdAt: input.now,
    updatedAt: input.now,
    captureComplete: false,
    exportAvailable: false,
    diagnostics: null,
  }
}

export function addWarning(job: JobCheckpoint, warning: string): void {
  if (!job.warnings.includes(warning)) job.warnings.push(warning)
}
