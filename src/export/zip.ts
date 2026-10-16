import JSZip from 'jszip'
import { frameFileName } from '../filenames'
import type { ArchiveMeta } from '../types'

export interface ZipFrame {
  index: number
  capturedAt: string
  scrollTop: number
  png: Uint8Array
}

export async function buildZip(input: {
  meta: ArchiveMeta
  frames: ZipFrame[]
  part: number
  parts: number
}): Promise<Uint8Array> {
  const zip = new JSZip()
  const manifest = {
    kind: 'whatsapp-chat-archive',
    version: 1,
    archiveName: input.meta.archiveName,
    chatTitle: input.meta.chatTitle,
    requestedPeriod: { start: input.meta.requestedStart, end: input.meta.requestedEnd },
    actualPeriod: { start: input.meta.actualStart, end: input.meta.actualEnd },
    exportedAt: input.meta.exportedAt,
    complete: input.meta.complete,
    incompleteReason: input.meta.incompleteReason,
    warnings: input.meta.warnings,
    part: input.part,
    parts: input.parts,
    layout: 'continuous',
    frames: input.frames.map((frame) => ({
      file: frameFileName(frame.index),
      index: frame.index,
      capturedAt: frame.capturedAt,
      scrollTop: frame.scrollTop,
    })),
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  for (const frame of input.frames) {
    zip.file(frameFileName(frame.index), frame.png, { compression: 'STORE' })
  }
  return zip.generateAsync({ type: 'uint8array' })
}
