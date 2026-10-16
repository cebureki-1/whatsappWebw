export interface CalendarDate {
  y: number
  m: number
  d: number
}

export type ExportFormat = 'pdf' | 'zip' | 'both'

export type Phase =
  | 'idle'
  | 'validating'
  | 'scrolling_to_start'
  | 'positioning'
  | 'capturing'
  | 'paused'
  | 'awaiting_partial_decision'
  | 'completed'
  | 'stopped'
  | 'error'
  | 'needs_restart'

export type PauseReason =
  | 'user'
  | 'tab'
  | 'chat'
  | 'geometry'
  | 'hidden'
  | 'worker_restarted'
  | 'position_lost'
  | 'capture_failed'

export type ActiveResumePhase = 'validating' | 'scrolling_to_start' | 'positioning' | 'capturing'

export interface Geometry {
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  rect: { x: number; y: number; width: number; height: number }
}

export interface DiagnosticCheck {
  name: string
  ok: boolean
  note?: string
}

export interface JobCheckpoint {
  jobId: string
  phase: Phase
  resumePhase: ActiveResumePhase | null
  pauseReason: PauseReason | null
  needsPositionCheck: boolean
  errorCode: string | null
  errorDetail: string | null
  statusHint: string | null
  incomplete: boolean
  incompleteReason: string | null
  warnings: string[]
  tabId: number
  windowId: number
  chatKey: string
  chatTitle: string
  requestedStart: string
  requestedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  loadedOldest: string | null
  loadedNewest: string | null
  boundaryMessageId: string
  frameCount: number
  lastFingerprint: string | null
  lastCaptureAt: number
  geometry: Geometry | null
  trimLeading: boolean
  stallCount: number
  captureFailures: number
  format: ExportFormat
  archiveName: string
  createdAt: string
  updatedAt: string
  captureComplete: boolean
  exportAvailable: boolean
  diagnostics: DiagnosticCheck[] | null
}

export interface Settings {
  format: ExportFormat
  archiveName: string
}

export interface PageStatus {
  onWhatsapp: boolean
  loggedIn: boolean
  chatOpen: boolean
  compatible: boolean
  chatKey: string | null
  chatTitle: string | null
  readableDates: number
  messageCount: number
  diagnostics: DiagnosticCheck[]
}

export type BoundaryVisibility = 'absent' | 'partial' | 'full'

export interface CaptureContext {
  chatKey: string
  geometry: Geometry
  fingerprint: string
  scrollTop: number
  oldest: string | null
  newest: string | null
  containsBoundary: BoundaryVisibility
  passedEnd: boolean
  atBottom: boolean
  trimTop: number
  trimBottom: number
  trimReliable: boolean
  coverageWarning: string | null
  ambiguousCount: number
  leadingClear: boolean
  settled: boolean
}

export interface FrameDraft {
  jobId: string
  index: number
  capturedAt: string
  scrollTop: number
  viewHeight: number
  png: Blob
}

export interface StoredFrame {
  key: string
  jobId: string
  index: number
  capturedAt: string
  scrollTop: number
  viewHeight?: number
  png: Blob
}

export interface ArchiveMeta {
  archiveName: string
  chatTitle: string
  requestedStart: string
  requestedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  exportedAt: string
  complete: boolean
  incompleteReason: string | null
  warnings: string[]
  frameCount: number
}
