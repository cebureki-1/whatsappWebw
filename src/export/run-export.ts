import { archiveBaseName, partSuffix } from '../filenames'
import { LIMITS } from '../limits'
import type { ArchiveMeta, JobCheckpoint, StoredFrame } from '../types'
import { composeContinuous } from './compose'
import { buildPdf } from './pdf'
import { buildZip } from './zip'

export interface ExportFile {
  filename: string
  mime: string
  bytes: Uint8Array
}

export async function exportJobFiles(input: {
  job: JobCheckpoint
  frames: StoredFrame[]
  fontRegular: Uint8Array
  fontBold: Uint8Array
  exportedAt: string
}): Promise<ExportFile[]> {
  if (input.frames.length === 0) {
    throw new Error('Нет сохранённых кадров для скачивания.')
  }
  const files: ExportFile[] = []
  const base = archiveBaseName(input.job.archiveName, input.job.incomplete || !input.job.captureComplete)
  if (input.job.format === 'pdf' || input.job.format === 'both') {
    const parts = chunk(input.frames, LIMITS.pdfFramesPerPart)
    for (let index = 0; index < parts.length; index++) {
      const partFrames = parts[index] ?? []
      const slices = await composeContinuous(partFrames)
      const bytes = await buildPdf({
        fontRegular: input.fontRegular,
        fontBold: input.fontBold,
        meta: metaFor(input.job, input.exportedAt, partFrames.length),
        frames: slices.map((slice) => ({ index: slice.index, png: slice.png })),
        part: index + 1,
        parts: parts.length,
      })
      files.push({
        filename: `${base}${partSuffix(index + 1, parts.length)}.pdf`,
        mime: 'application/pdf',
        bytes,
      })
    }
  }
  if (input.job.format === 'zip' || input.job.format === 'both') {
    const parts = chunk(input.frames, LIMITS.zipFramesPerPart)
    for (let index = 0; index < parts.length; index++) {
      const partFrames = parts[index] ?? []
      const slices = await composeContinuous(partFrames)
      const bytes = await buildZip({
        meta: metaFor(input.job, input.exportedAt, partFrames.length),
        frames: slices.map((slice) => ({
          index: slice.index,
          capturedAt: slice.capturedAt,
          scrollTop: slice.scrollTop,
          png: slice.png,
        })),
        part: index + 1,
        parts: parts.length,
      })
      files.push({
        filename: `${base}${partSuffix(index + 1, parts.length)}.zip`,
        mime: 'application/zip',
        bytes,
      })
    }
  }
  return files
}

function metaFor(job: JobCheckpoint, exportedAt: string, frameCount: number): ArchiveMeta {
  return {
    archiveName: job.archiveName,
    chatTitle: job.chatTitle,
    requestedStart: job.requestedStart,
    requestedEnd: job.requestedEnd,
    actualStart: job.actualStart,
    actualEnd: job.actualEnd,
    exportedAt,
    complete: job.captureComplete && !job.incomplete,
    incompleteReason: job.incomplete ? job.incompleteReason : null,
    warnings: job.warnings,
    frameCount,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const parts: T[][] = []
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size))
  return parts
}
