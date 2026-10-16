import type { CaptureContext, DiagnosticCheck, Geometry, PageStatus } from './types'

export type ContentRequest =
  | { type: 'STATUS' }
  | { type: 'READ_BOUNDARY' }
  | { type: 'SCROLL_UP'; start: string }
  | { type: 'ALIGN_START'; start: string; end: string | null }
  | {
      type: 'CAPTURE_CONTEXT'
      start: string
      end: string | null
      boundaryId: string
      trimLeading: boolean
    }
  | { type: 'SCROLL_DOWN' }
  | { type: 'PROBE' }

export type ContentResponse =
  | { ok: true; type: 'STATUS'; status: PageStatus }
  | {
      ok: true
      type: 'READ_BOUNDARY'
      boundaryId: string
      chatKey: string
      chatTitle: string
      geometry: Geometry
      oldest: string | null
      newest: string | null
      fingerprint: string
    }
  | {
      ok: true
      type: 'SCROLL_UP'
      reachedStart: boolean
      historyExhausted: boolean
      progressed: boolean
      oldest: string | null
      newest: string | null
      chatKey: string
      fingerprint: string
      ambiguousCount: number
      settled: boolean
    }
  | {
      ok: true
      type: 'ALIGN_START'
      chatKey: string
      fingerprint: string
      warning: string | null
      geometry: Geometry
      settled: boolean
    }
  | { ok: true; type: 'CAPTURE_CONTEXT'; context: CaptureContext }
  | { ok: true; type: 'SCROLL_DOWN'; progressed: boolean; fingerprint: string; chatKey: string; settled: boolean }
  | {
      ok: true
      type: 'PROBE'
      chatKey: string
      geometry: Geometry
      fingerprint: string
      visibility: 'visible' | 'hidden'
    }
  | { ok: false; errorCode: string; message: string; diagnostics?: DiagnosticCheck[] }

export interface CropMessage {
  source: 'wa-archive'
  target: 'offscreen'
  type: 'CROP'
  buffer: ArrayBuffer
  viewportWidth: number
  viewportHeight: number
  rect: { x: number; y: number; width: number; height: number }
  trimTop: number
  trimBottom: number
}

export type CropResponse =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; message: string; code?: string }
